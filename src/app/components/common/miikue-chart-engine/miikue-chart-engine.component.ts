import { Component, AfterViewInit, ViewChild, ElementRef, ChangeDetectorRef, OnDestroy, Input, OnChanges, SimpleChanges } from '@angular/core';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, ToolboxComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { WidgetContext } from '@home/models/widget-component.models';

echarts.use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, ToolboxComponent, CanvasRenderer]);

export interface ChartDataPoint {
  ts: number;
  value: number;
  name: string;
  color?: string;
  units?: string;
  decimals?: number;
}

interface MiikueChartEngineCtx extends Partial<WidgetContext> {
  chartData?: ChartDataPoint[];
  aggregationMode?: 'seconds' | 'min' | 'hour';
  selectedTimeWindow?: {
    startTs: number;
    endTs: number;
  };
  color?: string;
}

type AggregationMode = 'seconds' | 'min' | 'hour';
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
  selector: 'tb-miikue-chart-engine',
  templateUrl: './miikue-chart-engine.component.html',
  styleUrls: ['./miikue-chart-engine.component.scss'],
  standalone: false
})
export class MiikueChartEngineComponent implements AfterViewInit, OnChanges, OnDestroy {

  @ViewChild('chartContainer', { static: false }) chartContainer: ElementRef;

  @Input() ctx: MiikueChartEngineCtx;

  private chart: any = null;
  private resizeObserver: ResizeObserver | null = null;
  private windowResizeListener: (() => void) | null = null;
  private rawSeriesMap = new Map<string, SeriesPoint[]>();
  private seriesColorMap = new Map<string, string>();
  private seriesFormatMap = new Map<string, { units?: string; decimals?: number }>();
  private fullRangeMinTs: number | null = null;
  private fullRangeMaxTs: number | null = null;
  private readonly maxPointsPerPixel = 1.25;
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
      this.seriesFormatMap.clear();
      this.renderEmptyConfiguredWindow();
      if (this.chartWorker) {
        this.pushChartDataToWorker();
      }
      return;
    }

    this.updateSeriesFormats(chartData);

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

    for (const [name, points] of this.rawSeriesMap.entries()) {
      const seriesValues = this.decimateForCurrentWidth(points);
      const seriesColor = this.seriesColorMap.get(name) || colors[colorIndex % colors.length];

      echartsSeriesData.push({
        name: name,
        type: 'line',
        data: seriesValues,
        symbol: 'circle',
        showSymbol: true,
        symbolSize: 2,
        connectNulls: false,
        smooth: false,
        lineStyle: { color: seriesColor },
        itemStyle: {
          color: seriesColor,
          borderWidth: 0
        }
      });

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
            name: 'miikue-chart'
          }
        }
      },
      legend: this.buildLegendOption(legendData),
      grid: {
        left: 24,
        right: 16,
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

  private resolveConfiguredXAxisRange(chartData: ChartDataPoint[]): { minTs?: number; maxTs?: number } {
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
    link.download = 'miikue-chart.png';
    link.click();
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

    for (const [name, points] of this.rawSeriesMap.entries()) {
      const inRange = this.filterByRange(points, visible.minTs, visible.maxTs);
      const decimated = this.decimateForCurrentWidth(inRange);
      const seriesColor = this.seriesColorMap.get(name) || colors[colorIndex % colors.length];
      updatedSeries.push({
        name,
        type: 'line',
        data: decimated,
        symbol: 'circle',
        showSymbol: true,
        symbolSize: 2,
        connectNulls: false,
        smooth: false,
        lineStyle: { color: seriesColor },
        itemStyle: {
          color: seriesColor,
          borderWidth: 0
        }
      });
      colorIndex++;
    }

    this.chart.setOption({ series: updatedSeries, animation: false }, { replaceMerge: ['series'], lazyUpdate: true });
  }

  private initializeWorker(): void {
    if (typeof Worker === 'undefined') {
      return;
    }

    const workerUrl = this.resolveWorkerUrl('./miikue-chart-engine.worker');
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
      aggregationMode: this.ctx?.aggregationMode || 'seconds',
      settings: {
        rawGapBreakSeconds: Number((this.ctx as any)?.settings?.rawGapBreakSeconds),
        minGapBreakMinutes: Number((this.ctx as any)?.settings?.minGapBreakMinutes),
        hourGapBreakHours: Number((this.ctx as any)?.settings?.hourGapBreakHours)
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

    const colors = ['#2196f3', '#FFC107', '#FF5733', '#33FF57', '#FF9800'];
    const echartsSeriesData = result.series.map((series, index) => {
      const seriesColor = series.color || colors[index % colors.length];
      return {
        name: series.name,
        type: 'line',
        data: series.data,
        symbol: 'circle',
        showSymbol: true,
        symbolSize: 6,
        connectNulls: false,
        smooth: false,
        lineStyle: { color: seriesColor },
        itemStyle: {
          color: seriesColor,
          borderWidth: 0
        }
      };
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
      ? new Date(ts).toLocaleString('cs-CZ')
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
      return `${marker}${name}: ${this.formatSeriesValue(name, value)}`;
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

    return date.toLocaleString('cs-CZ', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  private formatYAxisLabel(value: number): string {
    return this.formatNumericValue(value, 1, this.resolveDefaultUnits());
  }

  private formatSeriesValue(seriesName: string, value: any): string {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return String(value ?? '');
    }

    const format = this.seriesFormatMap.get(seriesName);
    const decimals = Number.isFinite(Number(format?.decimals))
      ? Number(format?.decimals)
      : this.resolveDefaultDecimals();
    const units = (format?.units && String(format.units).trim().length)
      ? String(format.units)
      : this.resolveDefaultUnits();

    return this.formatNumericValue(numeric, decimals, units);
  }

  private formatNumericValue(value: number, decimals?: number, units?: string): string {
    const useDecimals = Number.isFinite(Number(decimals))
      ? Math.max(0, Math.min(20, Number(decimals)))
      : undefined;
    const formatter = new Intl.NumberFormat('cs-CZ', {
      minimumFractionDigits: useDecimals,
      maximumFractionDigits: useDecimals
    });
    const formatted = formatter.format(value);
    return units ? `${formatted} ${units}` : formatted;
  }

  private resolveDefaultDecimals(): number | undefined {
    const value = Number((this.ctx as any)?.decimals);
    return Number.isFinite(value) ? value : 3;
  }

  private resolveDefaultUnits(): string | undefined {
    const value = (this.ctx as any)?.units;
    return typeof value === 'string' && value.trim().length ? value : undefined;
  }

  private updateSeriesFormats(chartData: ChartDataPoint[]): void {
    this.seriesFormatMap.clear();
    for (const point of chartData) {
      const decimals = Number(point?.decimals);
      const units = typeof point?.units === 'string' ? point.units : undefined;
      this.seriesFormatMap.set(point.name, {
        units: units && units.trim().length ? units : undefined,
        decimals: Number.isFinite(decimals) ? decimals : undefined
      });
    }
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
    const mode: AggregationMode = this.ctx?.aggregationMode || 'seconds';
    const rawGapBreakSeconds = Number((this.ctx as any)?.settings?.rawGapBreakSeconds);
    const minGapBreakMinutes = Number((this.ctx as any)?.settings?.minGapBreakMinutes);
    const hourGapBreakHours = Number((this.ctx as any)?.settings?.hourGapBreakHours);
    switch (mode) {
      case 'min':
        return Number.isFinite(minGapBreakMinutes) && minGapBreakMinutes > 0
          ? minGapBreakMinutes * 60 * 1000
          : 60 * 1000;
      case 'hour':
        return Number.isFinite(hourGapBreakHours) && hourGapBreakHours > 0
          ? hourGapBreakHours * 60 * 60 * 1000
          : 60 * 60 * 1000;
      case 'seconds':
      default:
        // Raw data is naturally jittery; default to 5s to avoid overly aggressive breaks.
        return Number.isFinite(rawGapBreakSeconds) && rawGapBreakSeconds > 0
          ? rawGapBreakSeconds * 1000
          : 5000;
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