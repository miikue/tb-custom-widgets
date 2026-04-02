import { Component, AfterViewInit, ViewChild, ElementRef, ChangeDetectorRef, OnDestroy, Input, OnChanges, SimpleChanges } from '@angular/core';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { WidgetContext } from '@home/models/widget-component.models';

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

export interface ChartDataPoint {
  ts: number;
  value: number;
  name: string;
}

interface MiikueChartEngineCtx extends Partial<WidgetContext> {
  chartData?: ChartDataPoint[];
  aggregationMode?: 'seconds' | 'min' | 'hour';
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

    // Handle window resize
    this.windowResizeListener = () => {
      if (this.chart) {
        this.chart.resize();
      }
    };
    window.addEventListener('resize', this.windowResizeListener);

    // Handle container resize with ResizeObserver
    this.resizeObserver = new ResizeObserver(() => {
      if (this.chart) {
        this.chart.resize();
      }
    });
    this.resizeObserver.observe(chartElement);
  }

  private updateChart() {
    const chartData = this.ctx?.chartData || [];

    if (!this.chart || !chartData.length) {
      console.log('[MiikueChartEngine] No data to display');
      return;
    }

    console.log('[MiikueChartEngine] updateChart - processing', chartData.length, 'data points');

    // Group data by name
    const seriesMap = new Map<string, Array<{ts: number; value: number}>>();
    
    for (const point of chartData) {
      if (!seriesMap.has(point.name)) {
        seriesMap.set(point.name, []);
      }
      seriesMap.get(point.name)!.push({ ts: point.ts, value: point.value });
    }

    // Sort each series by timestamp
    for (const series of seriesMap.values()) {
      series.sort((a, b) => a.ts - b.ts);
    }

    // Get unique sorted timestamps for X axis
    const allTs = new Set<number>();
    for (const point of chartData) {
      allTs.add(point.ts);
    }
    const xAxisData = Array.from(allTs).sort((a, b) => a - b);

    // Build echart series
    const echartsSeriesData: any[] = [];
    const colors = ['#2196f3', '#FFC107', '#FF5733', '#33FF57', '#FF9800'];
    let colorIndex = 0;

    for (const [name, dataPoints] of seriesMap.entries()) {
      const seriesValues = xAxisData.map(ts => {
        const point = dataPoints.find(p => p.ts === ts);
        return point ? point.value : null;
      });

      echartsSeriesData.push({
        name: name,
        type: 'line',
        data: seriesValues,
        smooth: false,
        lineStyle: { color: colors[colorIndex % colors.length] },
        itemStyle: { color: colors[colorIndex % colors.length] }
      });

      colorIndex++;
    }

    // Format X axis labels (timestamps to readable format)
    const xAxisLabels = xAxisData.map(ts => new Date(ts).toLocaleString('cs-CZ'));

    // Create chart option
    this.chartOption = {
      tooltip: {
        trigger: 'axis'
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
        type: 'category',
        data: xAxisLabels
      },
      yAxis: {
        type: 'value'
      },
      series: echartsSeriesData
    };

    // Set option
    this.chart.setOption(this.chartOption);
    console.log('[MiikueChartEngine] Chart option set');
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