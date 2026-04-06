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
}

interface MiikueChartEngineCtx extends Partial<WidgetContext> {
  chartData?: ChartDataPoint[];
  aggregationMode?: 'seconds' | 'min' | 'hour';
  selectedTimeWindow?: {
    startTs: number;
    endTs: number;
  };
}

type AggregationMode = 'seconds' | 'min' | 'hour';
type SeriesPoint = [number, number | null];

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
  private fullRangeMinTs: number | null = null;
  private fullRangeMaxTs: number | null = null;
  private readonly maxPointsPerPixel = 1.25;

  chartOption: any = {};

  constructor(private cdr: ChangeDetectorRef) {
    //console.log('[MiikueChartEngine] Constructor called');
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['ctx'] && this.chart) {
      console.log('[MiikueChartEngine] ctx changed, updating...');
      this.updateChart();
    }
  }

  ngAfterViewInit() {
    //console.log('[MiikueChartEngine] ngAfterViewInit - initializing chart');
    this.initializeChart();
    this.cdr.detectChanges();
    console.log(this.ctx);
  }

  private initializeChart() {
    if (!this.chartContainer) {
      console.error('[MiikueChartEngine] chartContainer ref not found');
      return;
    }

    const chartElement = this.chartContainer.nativeElement;
    //console.log('[MiikueChartEngine] Chart element:', chartElement);

    // Initialize echarts
    this.chart = echarts.init(chartElement, null, { renderer: 'canvas' });
    //console.log('[MiikueChartEngine] Chart instance created:', this.chart);

    // Set initial options
    this.updateChart();

    this.chart.on('dataZoom', () => {
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

    const xRange = this.resolveConfiguredXAxisRange(chartData);

    console.log('[MiikueChartEngine] updateChart - processing', chartData.length, 'data points');

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

    this.rawSeriesMap.clear();
    this.seriesColorMap.clear();
    this.fullRangeMinTs = null;
    this.fullRangeMaxTs = null;

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

    // Create chart option
    this.chartOption = {
      tooltip: {
        trigger: 'axis'
      },
      toolbox: {
        show: true,
        right: 8,
        top: 8,
        itemSize: 16,
        feature: {
          dataZoom: {
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
            backgroundColor: '#ffffff',
            name: 'miikue-chart'
          }
        }
      },
      legend: {
        data: Array.from(seriesMap.keys())
      },
      grid: {
        left: 48,
        right: 16,
        top: 44,
        bottom: 40,
        containLabel: true
      },
      xAxis: {
        type: 'time',
        min: xRange.minTs,
        max: xRange.maxTs,
        axisLabel: {
          formatter: (value: number) => new Date(value).toLocaleString('cs-CZ')
        }
      },
      yAxis: {
        type: 'value'
      },
      dataZoom: [
        {
          type: 'inside',
          realtime: true,
          filterMode: 'none'
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
    console.log('[MiikueChartEngine] Chart option set');
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

  private zoomOutToFullRange(): void {
    if (!this.chart) {
      return;
    }

    this.chart.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
    this.applyDecimatedSeriesForCurrentView();
  }

  private applyDecimatedSeriesForCurrentView(): void {
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

    this.chart.setOption({ series: updatedSeries }, { replaceMerge: ['series'], lazyUpdate: true });
  }

  private resolveVisibleRange(): { minTs: number | null; maxTs: number | null } {
    if (this.fullRangeMinTs == null || this.fullRangeMaxTs == null) {
      return { minTs: null, maxTs: null };
    }

    const option = this.chart?.getOption?.() || {};
    const dataZoom = Array.isArray(option.dataZoom) && option.dataZoom.length ? option.dataZoom[0] : null;
    const start = Number(dataZoom?.start);
    const end = Number(dataZoom?.end);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return { minTs: this.fullRangeMinTs, maxTs: this.fullRangeMaxTs };
    }

    const minPercent = Math.max(0, Math.min(100, Math.min(start, end)));
    const maxPercent = Math.max(0, Math.min(100, Math.max(start, end)));
    const span = this.fullRangeMaxTs - this.fullRangeMinTs;

    return {
      minTs: this.fullRangeMinTs + (span * minPercent) / 100,
      maxTs: this.fullRangeMinTs + (span * maxPercent) / 100
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