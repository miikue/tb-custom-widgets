import { Component, AfterViewInit, ViewChild, ElementRef, ChangeDetectorRef, OnDestroy, Input, OnChanges, SimpleChanges } from '@angular/core';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, ToolboxComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { WidgetContext } from '@home/models/widget-component.models';

echarts.use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, ToolboxComponent, CanvasRenderer]);

export interface SpotrebaGrafKwhChartDataPoint {
  ts: number;
  value: number;
  name: string;
  color?: string;
}

interface MiikueSpotrebaGrafKwhEngineCtx extends Partial<WidgetContext> {
  chartData?: SpotrebaGrafKwhChartDataPoint[];
    aggregationMode?: 'hour' | 'day' | 'month';
  selectedTimeWindow?: {
    startTs: number;
    endTs: number;
  };
  color?: string;
}

type AggregationMode = 'hour' | 'day' | 'month';
type SeriesRole = 'spotreba' | 'export' | 'positiveBar';
type SeriesPoint = [number, number | null];

interface WorkerSeriesResult {
  name: string;
  color?: string;
  data: SeriesPoint[];
}

interface WorkerRenderResult {
  series: WorkerSeriesResult[];
  xRange: { minTs?: number; maxTs?: number };
}

interface WorkerMessage {
  type: 'ready' | 'result' | 'error';
  requestId: number;
  series?: WorkerSeriesResult[];
  xRange?: { minTs?: number; maxTs?: number };
  error?: string;
}

@Component({
  selector: 'tb-miikue-spotreba-graf-kwh-engine',
  templateUrl: './miikue-spotreba-graf-kwh-engine.component.html',
  styleUrls: ['./miikue-spotreba-graf-kwh-engine.component.scss'],
  standalone: false
})
export class MiikueSpotrebaGrafKwhEngineComponent implements AfterViewInit, OnChanges, OnDestroy {

  @ViewChild('chartContainer', { static: false }) chartContainer: ElementRef;

  @Input() ctx: MiikueSpotrebaGrafKwhEngineCtx;

  private chart: any = null;
  private resizeObserver: ResizeObserver | null = null;
  private windowResizeListener: (() => void) | null = null;
  private rawSeriesMap = new Map<string, SeriesPoint[]>();
  private seriesColorMap = new Map<string, string>();
  private fullRangeMinTs: number | null = null;
  private fullRangeMaxTs: number | null = null;
  private readonly maxPointsPerPixel = 1.25;
  private readonly exportZeroEpsilon = 1e-6;
  private chartWorker: Worker | null = null;
  private workerReady = false;
  private workerRequestSeq = 0;
  private latestRenderRequestId = 0;
  private zoomSelectionActive = false;
  private zoomHistory: Array<{ start: number; end: number }> = [{ start: 0, end: 100 }];
  private lastZoomRange = { start: 0, end: 100 };

  chartOption: any = {};

  constructor(private cdr: ChangeDetectorRef) {
    //console.log('[MiikueChartEngine] Constructor called');
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['ctx'] && this.chart) {
      this.updateChart();
    }
  }

  ngAfterViewInit() {
    //console.log('[MiikueChartEngine] ngAfterViewInit - initializing chart');
    this.initializeChart();
    this.cdr.detectChanges();
  }

  private initializeChart() {
    if (!this.chartContainer) {
      console.error('[MiikueChartEngine] chartContainer ref not found');
      return;
    }

    const chartElement = this.chartContainer.nativeElement;
    // Let ECharts fully manage touch gestures on the chart surface.
    chartElement.style.touchAction = 'none';
    //console.log('[MiikueChartEngine] Chart element:', chartElement);

    // Initialize echarts
    this.chart = echarts.init(chartElement, null, { renderer: 'canvas' });
    //console.log('[MiikueChartEngine] Chart instance created:', this.chart);

    this.initializeWorker();

    // Set initial options
    this.updateChart();

    this.chart.on('dataZoom', () => {
      this.trackZoomHistory();
      this.applyDecimatedSeriesForCurrentView();
    });

    // Handle window resize
    this.windowResizeListener = () => {
      if (this.chart) {
        this.chart.resize();
        this.applyDecimatedSeriesForCurrentView();
      }
    };
    window.addEventListener('resize', this.windowResizeListener);

    // Handle container resize with ResizeObserver
    this.resizeObserver = new ResizeObserver(() => {
      if (this.chart) {
        this.chart.resize();
        this.applyDecimatedSeriesForCurrentView();
      }
    });
    this.resizeObserver.observe(chartElement);
  }

  private updateChart() {
    const chartData = this.ctx?.chartData || [];

    if (!this.chart) {
      return;
    }

    if (!chartData.length) {
      this.renderEmptyConfiguredWindow();
      if (this.chartWorker) {
        this.pushChartDataToWorker();
      }
      return;
    }

    if (this.chartWorker) {
      this.pushChartDataToWorker();
      return;
    }

    const xRange = this.resolveConfiguredXAxisRange(chartData);
    const chartBackground = this.resolveChartBackground();

    this.rawSeriesMap.clear();
    this.seriesColorMap.clear();
    this.fullRangeMinTs = null;
    this.fullRangeMaxTs = null;

    if (chartData.length) {
      // Group data by name
      const seriesMap = new Map<string, Array<{ts: number; value: number}>>();
      
      for (const point of chartData) {
        if (!seriesMap.has(point.name)) {
          seriesMap.set(point.name, []);
        }
        seriesMap.get(point.name)!.push({ ts: point.ts, value: point.value });
        if (point.color && !this.seriesColorMap.has(point.name)) {
          this.seriesColorMap.set(point.name, point.color);
        }
      }

      // Sort each series by timestamp
      for (const series of seriesMap.values()) {
        series.sort((a, b) => a.ts - b.ts);
      }

      for (const point of chartData) {
        if (point.color && !this.seriesColorMap.has(point.name)) {
          this.seriesColorMap.set(point.name, point.color);
        }
      }

      for (const [name, dataPoints] of seriesMap.entries()) {
        const points: SeriesPoint[] = this.buildSeriesWithGapBreaks(dataPoints);
        this.rawSeriesMap.set(name, points);
        if (points.length) {
          const firstTs = points[0][0];
          const lastTs = points[points.length - 1][0];
          this.fullRangeMinTs = this.fullRangeMinTs == null ? firstTs : Math.min(this.fullRangeMinTs, firstTs);
          this.fullRangeMaxTs = this.fullRangeMaxTs == null ? lastTs : Math.max(this.fullRangeMaxTs, lastTs);
        }
      }
    }

    // Build initial decimated series for current canvas size.
    const echartsSeriesData: any[] = [];
    const colors = ['#2196f3', '#FFC107', '#FF5733', '#33FF57', '#FF9800'];
    let colorIndex = 0;
    const barSeriesData = new Map<string, SeriesPoint[]>();

    for (const [name, points] of this.rawSeriesMap.entries()) {
      if (this.getSeriesRole(name) === 'spotreba') {
        continue;
      }

      barSeriesData.set(name, this.toBarSeriesData(points));
    }

    const alignedBarSeriesData = this.alignBarSeriesData(barSeriesData);
    const adjustedBarSeriesData = this.adjustFveSeriesByExport(alignedBarSeriesData);
    const barSlotCount = this.resolveBarSlotCountFromWindow();

    for (const [name, points] of this.rawSeriesMap.entries()) {
      const seriesColor = this.seriesColorMap.get(name) || colors[colorIndex % colors.length];

      if (this.getSeriesRole(name) === 'spotreba') {
        echartsSeriesData.push(this.buildSeriesOption(name, this.decimateForCurrentWidth(points), seriesColor, 2, barSlotCount));
      } else {
        echartsSeriesData.push(this.buildSeriesOption(name, adjustedBarSeriesData.get(name) || [], seriesColor, 2, barSlotCount));
      }

      colorIndex++;
    }

    const legendData = Array.from(this.rawSeriesMap.keys());

    // Create chart option
    this.chartOption = {
      backgroundColor: chartBackground,
      darkMode: false,
      tooltip: this.buildTooltipOption(),
      toolbox: {
        show: true,
        left: -1000,
        top: -1000,
        itemSize: 1,
        feature: {
          dataZoom: {
            xAxisIndex: [0],
            yAxisIndex: 'none'
          },
          myZoomOutAll: {
            show: true,
            title: 'Zoom out full',
            icon: 'path://M128 480h768v64H128zM256 320h512v64H256zM384 160h256v64H384z',
            onclick: () => this.zoomOutToFullRange()
          },
          saveAsImage: {
            type: 'png',
            pixelRatio: 2,
            backgroundColor: chartBackground === 'transparent' ? '#ffffff' : chartBackground,
            name: 'miikue-spotreba-graf-kwh'
          }
        }
      },
      legend: this.buildLegendOption(legendData),
      grid: {
        left: 24,
        right: 6,
        top: 30,
        bottom: 40,
        containLabel: true
      },
      xAxis: {
        type: 'time',
        min: xRange.minTs,
        max: xRange.maxTs,
        axisLabel: {
          formatter: (value: number) => this.formatXAxisLabel(value)
        }
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          formatter: (value: number) => this.formatYAxisLabel(value)
        }
      },
      dataZoom: [
        {
          type: 'inside',
          realtime: true,
          filterMode: 'none',
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          moveOnMouseWheel: true,
          preventDefaultMouseMove: true,
          throttle: 30
        },
        {
          type: 'slider',
          show: false,
          realtime: true,
          filterMode: 'none'
        }
      ],
      series: echartsSeriesData
    };

    // Set option
    this.chart.setOption(this.chartOption, { notMerge: true });
    this.resetZoomTracking();
  }

  private renderEmptyConfiguredWindow(): void {
    if (!this.chart) {
      return;
    }

    const xRange = this.resolveConfiguredXAxisRange([]);
    const chartBackground = this.resolveChartBackground();
    const chartOption = {
      backgroundColor: chartBackground,
      darkMode: false,
      tooltip: this.buildTooltipOption(),
      toolbox: this.chartOption.toolbox,
      legend: this.buildLegendOption([]),
      grid: this.chartOption.grid,
      xAxis: {
        type: 'time',
        min: xRange.minTs,
        max: xRange.maxTs,
        axisLabel: {
          formatter: (value: number) => this.formatXAxisLabel(value)
        }
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          formatter: (value: number) => this.formatYAxisLabel(value)
        }
      },
      dataZoom: this.chartOption.dataZoom,
      series: []
    };

    this.chartOption = chartOption;
    this.chart.setOption(this.chartOption, { notMerge: true });
    this.resetZoomTracking();
  }

  private resolveConfiguredXAxisRange(chartData: SpotrebaGrafKwhChartDataPoint[]): { minTs?: number; maxTs?: number } {
    const selectedWindow = this.ctx?.selectedTimeWindow;
    const startTs = Number(selectedWindow?.startTs);
    const endTs = Number(selectedWindow?.endTs);

    if (Number.isFinite(startTs) && Number.isFinite(endTs)) {
      return {
        minTs: Math.min(startTs, endTs),
        maxTs: Math.max(startTs, endTs)
      };
    }

    if (!chartData.length) {
      return {};
    }

    let minTs = chartData[0].ts;
    let maxTs = chartData[0].ts;
    for (const point of chartData) {
      minTs = Math.min(minTs, point.ts);
      maxTs = Math.max(maxTs, point.ts);
    }

    return { minTs, maxTs };
  }

  public zoomOutToFullRange(): void {
    if (!this.chart) {
      return;
    }

    this.chart.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
    this.lastZoomRange = { start: 0, end: 100 };
    if (!this.zoomHistory.length || this.zoomHistory[this.zoomHistory.length - 1].start !== 0 || this.zoomHistory[this.zoomHistory.length - 1].end !== 100) {
      this.zoomHistory.push({ start: 0, end: 100 });
    }
    this.applyDecimatedSeriesForCurrentView();
  }

  public zoomBackOneStep(): void {
    if (!this.chart) {
      return;
    }

    if (this.zoomHistory.length <= 1) {
      this.zoomOutToFullRange();
      return;
    }

    this.zoomHistory.pop();
    const previous = this.zoomHistory[this.zoomHistory.length - 1] || { start: 0, end: 100 };
    this.lastZoomRange = { start: previous.start, end: previous.end };
    this.chart.dispatchAction({ type: 'dataZoom', start: previous.start, end: previous.end });
    this.applyDecimatedSeriesForCurrentView();
  }

  public toggleZoomSelection(): void {
    if (!this.chart) {
      return;
    }

    this.zoomSelectionActive = !this.zoomSelectionActive;
    this.chart.dispatchAction({
      type: 'takeGlobalCursor',
      key: 'dataZoomSelect',
      dataZoomSelectActive: this.zoomSelectionActive
    });

    this.chart.getZr().setCursorStyle(this.zoomSelectionActive ? 'crosshair' : 'default');
  }

  public saveAsPng(): void {
    if (!this.chart) {
      return;
    }

    const dataUrl = this.chart.getDataURL({
      type: 'png',
      pixelRatio: 2,
      backgroundColor: '#ffffff'
    });

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = 'miikue-spotreba-graf-kwh.png';
    link.click();
  }

  private normalizeSeriesName(seriesName: string): string {
    return String(seriesName || '')
      .toLocaleLowerCase('cs-CZ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private getSeriesRole(seriesName: string): SeriesRole {
    const normalizedName = this.normalizeSeriesName(seriesName);

    if (normalizedName.includes('spotreba')) {
      return 'spotreba';
    }

    if (normalizedName.includes('export') || normalizedName.includes('pretok')) {
      return 'export';
    }

    return 'positiveBar';
  }

  private isImportSeries(seriesName: string): boolean {
    const normalizedName = this.normalizeSeriesName(seriesName);
    return normalizedName.includes('import') || normalizedName.includes('odber');
  }

  private toBarSeriesData(points: SeriesPoint[], valueMultiplier = 1, keepZeroNegative = false): SeriesPoint[] {
    // Stacked bars should contain only numeric points.
    return points
      .filter((point): point is [number, number] => point[1] != null)
      .map((point) => {
        const scaledValue = point[1] * valueMultiplier;
        if (keepZeroNegative && scaledValue === 0) {
          return [point[0], -this.exportZeroEpsilon];
        }
        return [point[0], scaledValue];
      });
  }

  private alignBarSeriesData(seriesMap: Map<string, SeriesPoint[]>): Map<string, SeriesPoint[]> {
    const timestamps = new Set<number>();
    const barSeriesMaps = new Map<string, Map<number, number>>();

    for (const [name, points] of seriesMap.entries()) {
      const pointMap = new Map<number, number>();
      for (const point of points) {
        if (point[1] == null) {
          continue;
        }
        timestamps.add(point[0]);
        pointMap.set(point[0], point[1]);
      }
      barSeriesMaps.set(name, pointMap);
    }

    const sortedTimestamps = Array.from(timestamps.values()).sort((a, b) => a - b);
    const aligned = new Map<string, SeriesPoint[]>();

    for (const [name, pointMap] of barSeriesMaps.entries()) {
      aligned.set(
        name,
        sortedTimestamps.map((ts) => [ts, pointMap.get(ts) ?? 0])
      );
    }

    return aligned;
  }

  private adjustFveSeriesByExport(seriesMap: Map<string, SeriesPoint[]>): Map<string, SeriesPoint[]> {
    const exportByTimestamp = new Map<number, number>();

    for (const [name, points] of seriesMap.entries()) {
      if (this.getSeriesRole(name) !== 'export') {
        continue;
      }

      for (const point of points) {
        const value = point[1] ?? 0;
        exportByTimestamp.set(point[0], (exportByTimestamp.get(point[0]) ?? 0) + value);
      }
    }

    if (!exportByTimestamp.size) {
      return seriesMap;
    }

    const adjusted = new Map<string, SeriesPoint[]>();
    for (const [name, points] of seriesMap.entries()) {
      if (this.getSeriesRole(name) === 'positiveBar' && !this.isImportSeries(name)) {
        adjusted.set(
          name,
          points.map((point) => {
            const value = point[1] ?? 0;
            const exportValue = exportByTimestamp.get(point[0]) ?? 0;
            return [point[0], Math.max(0, value - exportValue)];
          })
        );
      } else {
        adjusted.set(name, points);
      }
    }

    return adjusted;
  }

  private buildSeriesOption(
    name: string,
    data: SeriesPoint[],
    seriesColor: string,
    lineSymbolSize: number,
    barSlotCount = 0
  ): any {
    const role = this.getSeriesRole(name);

    if (role !== 'spotreba') {
      const isExport = role === 'export';
      const barSign = isExport ? -1 : 1;
      const barStyle = this.resolveBarStyle(barSlotCount);
      const fillColor = this.withAlpha(seriesColor, 0.45);
      return {
        name,
        type: 'bar',
        data: this.toBarSeriesData(data, barSign, isExport),
        stack: 'net-energy-bars',
        barWidth: barStyle.widthPx,
        barMinWidth: barStyle.minWidthPx,
        barGap: '0%',
        barCategoryGap: barStyle.categoryGap,
        emphasis: {
          focus: 'series'
        },
        itemStyle: {
          color: fillColor,
          borderColor: seriesColor,
          borderWidth: 1
        }
      };
    }

    return {
      name,
      type: 'line',
      data,
      symbol: 'circle',
      showSymbol: true,
      symbolSize: lineSymbolSize,
      z: 20,
      zlevel: 1,
      connectNulls: false,
      smooth: false,
      lineStyle: {
        width: 2.5,
        color: seriesColor
      },
      itemStyle: {
        color: seriesColor,
        borderWidth: 0
      }
    };
  }

  private applyDecimatedSeriesForCurrentView(): void {
    if (this.chartWorker) {
      this.requestWorkerRender();
      return;
    }

    if (!this.chart || !this.rawSeriesMap.size) {
      return;
    }

    const visible = this.resolveVisibleRange();
    const updatedSeries: any[] = [];
    const colors = ['#2196f3', '#FFC107', '#FF5733', '#33FF57', '#FF9800'];
    let colorIndex = 0;
    const barSeriesData = new Map<string, SeriesPoint[]>();

    for (const [name, points] of this.rawSeriesMap.entries()) {
      if (this.getSeriesRole(name) === 'spotreba') {
        continue;
      }

      const inRange = this.filterByRange(points, visible.minTs, visible.maxTs);
      barSeriesData.set(name, this.toBarSeriesData(inRange));
    }

    const alignedBarSeriesData = this.alignBarSeriesData(barSeriesData);
    const adjustedBarSeriesData = this.adjustFveSeriesByExport(alignedBarSeriesData);
    const barSlotCount = this.resolveBarSlotCountFromWindow();

    for (const [name, points] of this.rawSeriesMap.entries()) {
      const seriesColor = this.seriesColorMap.get(name) || colors[colorIndex % colors.length];

      if (this.getSeriesRole(name) === 'spotreba') {
        const inRange = this.filterByRange(points, visible.minTs, visible.maxTs);
        const decimated = this.decimateForCurrentWidth(inRange);
        updatedSeries.push(this.buildSeriesOption(name, decimated, seriesColor, 2, barSlotCount));
      } else {
        updatedSeries.push(this.buildSeriesOption(name, adjustedBarSeriesData.get(name) || [], seriesColor, 2, barSlotCount));
      }

      colorIndex++;
    }

    this.chart.setOption({ series: updatedSeries, animation: false }, { replaceMerge: ['series'], lazyUpdate: true });
  }

  private initializeWorker(): void {
    if (typeof Worker === 'undefined') {
      return;
    }

    const workerUrl = this.resolveWorkerUrl('./miikue-spotreba-graf-kwh-engine.worker');
    if (!workerUrl) {
      this.disposeWorker();
      return;
    }

    try {
      this.chartWorker = new Worker(workerUrl, { type: 'module' });
      this.chartWorker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        this.handleWorkerMessage(event.data);
      };
      this.chartWorker.onerror = () => {
        this.disposeWorker();
      };
    } catch {
      this.disposeWorker();
    }
  }

  private resolveWorkerUrl(relativePath: string): URL | null {
    try {
      return new URL(relativePath, import.meta.url);
    } catch {
      return null;
    }
  }

  private pushChartDataToWorker(): void {
    if (!this.chartWorker) {
      return;
    }

    const requestId = ++this.workerRequestSeq;
    this.workerReady = false;
    this.latestRenderRequestId = requestId;
    this.chartWorker.postMessage({
      type: 'setData',
      requestId,
      chartData: this.ctx?.chartData || [],
      selectedTimeWindow: this.ctx?.selectedTimeWindow,
      aggregationMode: this.ctx?.aggregationMode || 'hour',
      settings: {
        hourGapBreakHours: Number((this.ctx as any)?.settings?.hourGapBreakHours),
        dayGapBreakDays: Number((this.ctx as any)?.settings?.dayGapBreakDays),
        monthGapBreakMonths: Number((this.ctx as any)?.settings?.monthGapBreakMonths)
      }
    });
  }

  private requestWorkerRender(): void {
    if (!this.chartWorker || !this.workerReady) {
      return;
    }

    const requestId = ++this.workerRequestSeq;
    this.latestRenderRequestId = requestId;
    this.chartWorker.postMessage({
      type: 'render',
      requestId,
      viewWindow: this.resolveVisibleRange(),
      width: Math.max(1, this.chart?.getWidth?.() || this.chartContainer?.nativeElement?.clientWidth || 1),
      maxPointsPerPixel: this.maxPointsPerPixel
    });
  }

  private handleWorkerMessage(message: WorkerMessage): void {
    if (message.type === 'ready') {
      this.workerReady = true;
      this.requestWorkerRender();
      return;
    }

    if (message.requestId < this.latestRenderRequestId) {
      return;
    }

    if (message.type === 'error') {
      console.warn('[MiikueChartEngine] Worker error, falling back to sync mode', message.error);
      this.disposeWorker();
      this.updateChart();
      return;
    }

    if (message.type !== 'result' || !message.series) {
      return;
    }

    this.applyWorkerRenderResult({ series: message.series, xRange: message.xRange || {} });
  }

  private applyWorkerRenderResult(result: WorkerRenderResult): void {
    if (!this.chart) {
      return;
    }

    const barSlotCount = this.resolveBarSlotCountFromWindow();
    const colors = ['#2196f3', '#FFC107', '#FF5733', '#33FF57', '#FF9800'];
    const echartsSeriesData = result.series.map((series, index) => {
      const seriesColor = series.color || colors[index % colors.length];
      return this.buildSeriesOption(series.name, series.data, seriesColor, 6, barSlotCount);
    });

    const chartBackground = this.resolveChartBackground();
    this.chartOption = {
      backgroundColor: chartBackground,
      darkMode: false,
      tooltip: this.buildTooltipOption(),
      toolbox: this.chartOption.toolbox,
      legend: this.buildLegendOption(result.series.map((series) => series.name)),
      grid: this.chartOption.grid,
      xAxis: {
        type: 'time',
        min: result.xRange?.minTs,
        max: result.xRange?.maxTs,
        axisLabel: {
          formatter: (value: number) => this.formatXAxisLabel(value)
        }
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          formatter: (value: number) => this.formatYAxisLabel(value)
        }
      },
      dataZoom: this.chartOption.dataZoom,
      series: echartsSeriesData
    };

    this.chart.setOption(this.chartOption, { replaceMerge: ['series'], lazyUpdate: true, animation: false });
  }

  private buildLegendOption(data: string[]): any {
    return {
      type: 'scroll',
      orient: 'horizontal',
      top: 0,
      left: 8,
      right: 8,
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 10,
      pageIconColor: '#1976d2',
      pageIconInactiveColor: 'rgba(0, 0, 0, 0.28)',
      pageTextStyle: {
        color: 'rgba(0, 0, 0, 0.65)',
        fontSize: 11
      },
      textStyle: {
        color: 'rgba(0, 0, 0, 0.78)',
        fontSize: 11
      },
      formatter: (name: string) => this.truncateLegendLabel(name),
      data
    };
  }

  private buildTooltipOption(): any {
    return {
      trigger: 'axis',
      confine: true,
      formatter: (params: any) => this.formatTooltip(params)
    };
  }

  private formatTooltip(params: any): string {
    const items = Array.isArray(params) ? params : [params];
    if (!items.length) {
      return '';
    }

    const firstValue = Array.isArray(items[0]?.value) ? items[0].value[0] : items[0]?.axisValue;
    const ts = Number(firstValue);
    const header = Number.isFinite(ts)
      ? this.formatTimeBucketLabel(ts)
      : String(firstValue ?? '');

    const validItems = items.filter((item: any) => {
      const value = Array.isArray(item?.value) ? item.value[1] : item?.value;
      return value !== null && value !== undefined && value !== '-';
    });

    if (!validItems.length) {
      return `${header}<br/>Bez dat`;
    }

    const lines = validItems.map((item: any) => {
      const marker = item?.marker || '';
      const name = item?.seriesName || '';
      const value = Array.isArray(item?.value) ? item.value[1] : item?.value;
      return `${marker}${name}: ${this.formatPowerValue(value)}`;
    });

    return [header, ...lines].join('<br/>');
  }

  private truncateLegendLabel(value: string, maxLength = 22): string {
    const text = String(value || '');
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
  }

  private formatXAxisLabel(value: number): string {
    const date = new Date(Number(value));
    if (isNaN(date.getTime())) {
      return String(value ?? '');
    }

    return this.formatTimeBucketLabel(date.getTime());
  }

  private formatTimeBucketLabel(timestamp: number): string {
    const mode = this.getAggregationMode();
    const numericTimestamp = Number(timestamp);
    const range = this.resolveBucketRangeFromStart(numericTimestamp, mode);
    if (!range) {
      return String(timestamp ?? '');
    }

    if (mode === 'hour') {
      const start = new Date(range.startTs);
      const end = new Date(range.endTs);
      const from = this.formatHourMinute(start);
      const to = this.formatHourMinute(end);
      return `${from}-${to}`;
    }

    if (mode === 'day') {
      const start = new Date(range.startTs);
      return this.formatDayMonth(start);
    }

    if (mode === 'month') {
      return this.formatMonthYear(new Date(range.startTs));
    }

    const start = new Date(range.startTs);

    return start.toLocaleString('cs-CZ', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  private resolveBucketRangeFromStart(
    timestamp: number,
    mode: AggregationMode
  ): { startTs: number; endTs: number } | null {
    if (!Number.isFinite(timestamp)) {
      return null;
    }

    if (mode === 'day') {
      const start = new Date(timestamp);
      if (isNaN(start.getTime())) {
        return null;
      }
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { startTs: start.getTime(), endTs: end.getTime() };
    }

    if (mode === 'month') {
      const start = new Date(timestamp);
      if (isNaN(start.getTime())) {
        return null;
      }
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      return { startTs: start.getTime(), endTs: end.getTime() };
    }

    const bucketMs = this.getBucketSizeMs(mode);
    if (!Number.isFinite(bucketMs) || bucketMs <= 0) {
      return null;
    }

    const startTs = Math.floor(timestamp / bucketMs) * bucketMs;
    return {
      startTs,
      endTs: startTs + bucketMs
    };
  }

  private getBucketSizeMs(mode: AggregationMode): number {
    switch (mode) {
      case 'month':
        return 30 * 24 * 60 * 60 * 1000;
      case 'day':
        return 24 * 60 * 60 * 1000;
      case 'hour':
      default:
        return 60 * 60 * 1000;
    }
  }

  private formatHourMinute(date: Date): string {
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${hour}:${minute}`;
  }

  private formatDayMonth(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}`;
  }

  private formatMonthYear(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear());
    return `${month}.${year}`;
  }

  private withAlpha(color: string, alpha: number): string {
    const normalizedAlpha = Math.max(0, Math.min(1, alpha));
    const input = String(color || '').trim();
    if (!input) {
      return `rgba(0, 0, 0, ${normalizedAlpha})`;
    }

    const hex = input.startsWith('#') ? input.slice(1) : '';
    if (hex.length === 3 || hex.length === 6) {
      const normalizedHex = hex.length === 3 ? hex.split('').map((ch) => ch + ch).join('') : hex;
      const parsed = Number.parseInt(normalizedHex, 16);
      if (!Number.isNaN(parsed)) {
        const r = (parsed >> 16) & 255;
        const g = (parsed >> 8) & 255;
        const b = parsed & 255;
        return `rgba(${r}, ${g}, ${b}, ${normalizedAlpha})`;
      }
    }

    const rgbMatch = input.match(/^rgba?\(([^)]+)\)$/i);
    if (rgbMatch) {
      const parts = rgbMatch[1].split(',').map((part) => Number(part.trim()));
      if (parts.length >= 3 && parts.slice(0, 3).every((part) => Number.isFinite(part))) {
        const r = Math.max(0, Math.min(255, Math.round(parts[0])));
        const g = Math.max(0, Math.min(255, Math.round(parts[1])));
        const b = Math.max(0, Math.min(255, Math.round(parts[2])));
        return `rgba(${r}, ${g}, ${b}, ${normalizedAlpha})`;
      }
    }

    return color;
  }

  private resolveBarStyle(slotCount: number): { widthPx?: number; minWidthPx: number; categoryGap: string } {
    if (!this.chart || slotCount <= 0) {
      return {
        widthPx: undefined,
        minWidthPx: 4,
        categoryGap: '0%'
      };
    }

    const chartWidth = Math.max(1, this.chart.getWidth?.() || this.chartContainer?.nativeElement?.clientWidth || 1);
    const plotWidth = Math.max(1, chartWidth - 40);
    const slotWidthPx = plotWidth / Math.max(1, slotCount);
    const widthPx = Math.floor(Math.max(1, slotWidthPx * 0.5));
    return {
      widthPx: Math.max(3, widthPx),
      minWidthPx: 3,
      categoryGap: '0%'
    };
  }

  private resolveBarSlotCountFromWindow(): number {
    const startTs = Number(this.ctx?.selectedTimeWindow?.startTs);
    const endTs = Number(this.ctx?.selectedTimeWindow?.endTs);
    if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) {
      return 0;
    }

    const mode = this.getAggregationMode();
    if (mode === 'month') {
      const start = new Date(Math.min(startTs, endTs));
      const end = new Date(Math.max(startTs, endTs));
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return 0;
      }
      const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
      return Math.max(1, months);
    }

    const rangeMs = Math.max(1, Math.abs(endTs - startTs));
    const bucketMs = this.getBucketSizeMs(mode);
    if (!Number.isFinite(bucketMs) || bucketMs <= 0) {
      return 0;
    }

    return Math.max(1, Math.ceil(rangeMs / bucketMs));
  }

  private getAggregationMode(): AggregationMode {
    const mode = this.ctx?.aggregationMode;
    if (mode === 'hour' || mode === 'day' || mode === 'month') {
      return mode;
    }
    return 'hour';
  }

  private formatYAxisLabel(value: number): string {
    return this.formatPowerValue(value, 1);
  }

  private formatPowerValue(value: unknown, decimals = 3): string {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) {
      return String(value ?? '');
    }

    const normalized = Math.abs(numeric) < this.exportZeroEpsilon * 10 ? 0 : numeric;
    const precisionFactor = Math.pow(10, decimals);
    const rounded = Math.round(normalized * precisionFactor) / precisionFactor;
    const safeRounded = Object.is(rounded, -0) ? 0 : rounded;
    return `${safeRounded.toFixed(decimals)} kW`;
  }

  private getCurrentZoomRange(): { start: number; end: number } {
    const option = this.chart?.getOption?.() || {};
    const dataZoom = Array.isArray(option.dataZoom) && option.dataZoom.length ? option.dataZoom[0] : null;
    const start = Number(dataZoom?.start);
    const end = Number(dataZoom?.end);
    return {
      start: Number.isFinite(start) ? start : 0,
      end: Number.isFinite(end) ? end : 100
    };
  }

  private trackZoomHistory(): void {
    const current = this.getCurrentZoomRange();
    if (current.start === this.lastZoomRange.start && current.end === this.lastZoomRange.end) {
      return;
    }

    this.lastZoomRange = { start: current.start, end: current.end };
    const last = this.zoomHistory[this.zoomHistory.length - 1];
    if (!last || last.start !== current.start || last.end !== current.end) {
      this.zoomHistory.push({ start: current.start, end: current.end });
      if (this.zoomHistory.length > 30) {
        this.zoomHistory.shift();
      }
    }
  }

  private resetZoomTracking(): void {
    this.zoomHistory = [{ start: 0, end: 100 }];
    this.lastZoomRange = { start: 0, end: 100 };
    this.zoomSelectionActive = false;
    if (this.chart) {
      this.chart.dispatchAction({
        type: 'takeGlobalCursor',
        key: 'dataZoomSelect',
        dataZoomSelectActive: false
      });
      this.chart.getZr().setCursorStyle('default');
    }
  }

  private disposeWorker(): void {
    if (this.chartWorker) {
      this.chartWorker.terminate();
      this.chartWorker = null;
    }
    this.workerReady = false;
  }

  private resolveChartBackground(): string {
    return '#ffffff';
  }

  private resolveVisibleRange(): { minTs: number | null; maxTs: number | null } {
    const selectedWindow = this.ctx?.selectedTimeWindow;
    const selectedStart = Number(selectedWindow?.startTs);
    const selectedEnd = Number(selectedWindow?.endTs);

    let baseMinTs: number | null = null;
    let baseMaxTs: number | null = null;

    if (Number.isFinite(selectedStart) && Number.isFinite(selectedEnd)) {
      baseMinTs = Math.min(selectedStart, selectedEnd);
      baseMaxTs = Math.max(selectedStart, selectedEnd);
    } else if (this.fullRangeMinTs != null && this.fullRangeMaxTs != null) {
      baseMinTs = this.fullRangeMinTs;
      baseMaxTs = this.fullRangeMaxTs;
    }

    if (baseMinTs == null || baseMaxTs == null) {
      return { minTs: null, maxTs: null };
    }

    const option = this.chart?.getOption?.() || {};
    const dataZoom = Array.isArray(option.dataZoom) && option.dataZoom.length ? option.dataZoom[0] : null;
    const start = Number(dataZoom?.start);
    const end = Number(dataZoom?.end);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return { minTs: baseMinTs, maxTs: baseMaxTs };
    }

    const minPercent = Math.max(0, Math.min(100, Math.min(start, end)));
    const maxPercent = Math.max(0, Math.min(100, Math.max(start, end)));
    const span = baseMaxTs - baseMinTs;

    return {
      minTs: baseMinTs + (span * minPercent) / 100,
      maxTs: baseMinTs + (span * maxPercent) / 100
    };
  }

  private filterByRange(points: SeriesPoint[], minTs: number | null, maxTs: number | null): SeriesPoint[] {
    if (minTs == null || maxTs == null) {
      return points;
    }
    return points.filter((point) => point[0] >= minTs && point[0] <= maxTs);
  }

  private decimateForCurrentWidth(points: SeriesPoint[]): SeriesPoint[] {
    if (points.length <= 2) {
      return points;
    }

    const width = Math.max(1, this.chart?.getWidth?.() || this.chartContainer?.nativeElement?.clientWidth || 1);
    const targetMaxPoints = Math.max(200, Math.floor(width * this.maxPointsPerPixel));

    const nullPoints: SeriesPoint[] = points.filter((point) => point[1] == null);
    const numericPoints: Array<[number, number]> = points
      .filter((point): point is [number, number] => point[1] != null);

    if (!numericPoints.length) {
      return nullPoints;
    }

    const decimatedNumeric = numericPoints.length <= targetMaxPoints
      ? numericPoints
      : this.minMaxDecimate(numericPoints, targetMaxPoints);

    const merged = [...decimatedNumeric, ...nullPoints] as SeriesPoint[];
    const deduped = new Map<string, SeriesPoint>();
    for (const point of merged) {
      deduped.set(`${point[0]}|${point[1]}`, point);
    }

    return Array.from(deduped.values()).sort((a, b) => a[0] - b[0]);
  }

  private buildSeriesWithGapBreaks(dataPoints: Array<{ts: number; value: number}>): SeriesPoint[] {
    if (!dataPoints.length) {
      return [];
    }

    const result: SeriesPoint[] = [];
    const maxGapMs = this.resolveGapThresholdMs();
    let prevTs: number | null = null;

    for (const point of dataPoints) {
      if (prevTs !== null && maxGapMs > 0 && point.ts - prevTs > maxGapMs) {
        const breakTs = Math.max(prevTs + 1, point.ts - 1);
        result.push([breakTs, null]);
      }

      result.push([point.ts, point.value]);
      prevTs = point.ts;
    }

    return result;
  }

  private resolveGapThresholdMs(): number {
    const mode: AggregationMode = this.ctx?.aggregationMode || 'hour';
    const hourGapBreakHours = Number((this.ctx as any)?.settings?.hourGapBreakHours);
    const dayGapBreakDays = Number((this.ctx as any)?.settings?.dayGapBreakDays);
    const monthGapBreakMonths = Number((this.ctx as any)?.settings?.monthGapBreakMonths);
    switch (mode) {
      case 'month':
        return Number.isFinite(monthGapBreakMonths) && monthGapBreakMonths > 0
          ? monthGapBreakMonths * 30 * 24 * 60 * 60 * 1000
          : 30 * 24 * 60 * 60 * 1000;
      case 'day':
        return Number.isFinite(dayGapBreakDays) && dayGapBreakDays > 0
          ? dayGapBreakDays * 24 * 60 * 60 * 1000
          : 24 * 60 * 60 * 1000;
      case 'hour':
      default:
        return Number.isFinite(hourGapBreakHours) && hourGapBreakHours > 0
          ? hourGapBreakHours * 60 * 60 * 1000
          : 60 * 60 * 1000;
    }
  }

  private minMaxDecimate(points: Array<[number, number]>, targetMaxPoints: number): Array<[number, number]> {
    if (points.length <= targetMaxPoints) {
      return points;
    }

    const bucketSize = Math.ceil(points.length / targetMaxPoints);
    const reduced: Array<[number, number]> = [];

    for (let i = 0; i < points.length; i += bucketSize) {
      const bucket = points.slice(i, Math.min(i + bucketSize, points.length));
      if (!bucket.length) {
        continue;
      }

      let minPoint = bucket[0];
      let maxPoint = bucket[0];

      for (const point of bucket) {
        if (point[1] < minPoint[1]) {
          minPoint = point;
        }
        if (point[1] > maxPoint[1]) {
          maxPoint = point;
        }
      }

      if (minPoint[0] <= maxPoint[0]) {
        reduced.push(minPoint, maxPoint);
      } else {
        reduced.push(maxPoint, minPoint);
      }
    }

    const deduped = new Map<string, [number, number]>();
    for (const point of reduced) {
      deduped.set(`${point[0]}|${point[1]}`, point);
    }

    return Array.from(deduped.values()).sort((a, b) => a[0] - b[0]);
  }

  ngOnDestroy() {
    // Clean up resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Clean up window resize listener
    if (this.windowResizeListener) {
      window.removeEventListener('resize', this.windowResizeListener);
      this.windowResizeListener = null;
    }

    // Dispose chart
    if (this.chart) {
      this.chart.dispose();
      this.chart = null;
    }
  }

}