import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import * as echarts from 'echarts/core';
import { HeatmapChart } from 'echarts/charts';
import { CalendarComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([HeatmapChart, CalendarComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

interface TimeseriesPoint {
  ts: number;
  value: number;
}

interface DailyAggregate {
  importValue: number;
  exportValue: number;
}

type CalendarDataValue = [string, number, number, number, number, number];

interface CalendarDataPoint {
  value: CalendarDataValue;
  itemStyle?: {
    color: string;
  };
}

@Component({
  selector: 'tb-miikue-kalendar',
  templateUrl: './miikue-kalendar.component.html',
  styleUrls: ['./miikue-kalendar.component.scss'],
  standalone: false
})
export class MiikueKalendarComponent implements OnInit, OnChanges, AfterViewInit, OnDestroy {

  @Input() ctx: any;
  @ViewChild('chartContainer', { static: false }) chartContainer?: ElementRef<HTMLElement>;

  importLabel = 'Import';
  exportLabel = 'Export';

  private chart: echarts.ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private windowResizeListener: (() => void) | null = null;
  private readonly dayMs = 24 * 60 * 60 * 1000;
  private readonly yearDays = 365;
  private readonly displayUnit = 'kW';
  private loadSequence = 0;

  ngOnInit(): void {
    if (this.ctx?.$scope) {
      this.ctx.$scope.miikueKalendarWidget = this;
    }

    this.onInit();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['ctx'] && this.ctx?.$scope) {
      this.ctx.$scope.miikueKalendarWidget = this;
    }

    if (changes['ctx']) {
      this.onDataUpdated();
    }
  }

  ngAfterViewInit(): void {
    if (!this.chartContainer?.nativeElement) {
      return;
    }

    this.chart = echarts.init(this.chartContainer.nativeElement, null, { renderer: 'canvas' });

    this.windowResizeListener = () => this.chart?.resize();
    window.addEventListener('resize', this.windowResizeListener);

    this.resizeObserver = new ResizeObserver(() => {
      this.chart?.resize();
    });
    this.resizeObserver.observe(this.chartContainer.nativeElement);

    this.onDataUpdated();
  }

  ngOnDestroy(): void {
    if (this.windowResizeListener) {
      window.removeEventListener('resize', this.windowResizeListener);
      this.windowResizeListener = null;
    }

    if (this.resizeObserver && this.chartContainer?.nativeElement) {
      this.resizeObserver.unobserve(this.chartContainer.nativeElement);
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.chart?.dispose();
    this.chart = null;
  }

  public onInit(): void {
    this.onDataUpdated();
  }

  public onDataUpdated(): void {
    void this.loadAndRenderYearHeatmap();
  }

  public onResize(): void {
    this.chart?.resize();
  }

  private async loadAndRenderYearHeatmap(): Promise<void> {
    const chart = this.chart;
    if (!chart) {
      return;
    }

    const runId = ++this.loadSequence;
    const keySelection = this.resolveImportExportKeys();

    if (!keySelection.importKey || !keySelection.exportKey) {
      this.importLabel = keySelection.importLabel || 'Import';
      this.exportLabel = keySelection.exportLabel || 'Export';
      this.renderInfoState('Nastav 2 datové klíče: import a export.');
      return;
    }

    this.importLabel = keySelection.importLabel;
    this.exportLabel = keySelection.exportLabel;

    const range = this.resolveYearRange();

    const [importSeries, exportSeries] = await Promise.all([
      this.apiGetTimeseriesData(keySelection.importKey, range.startTs, range.endTs),
      this.apiGetTimeseriesData(keySelection.exportKey, range.startTs, range.endTs)
    ]);

    if (runId !== this.loadSequence) {
      return;
    }

    const dailyMap = this.aggregateByDay(importSeries, exportSeries);
    const chartData = this.buildCalendarData(dailyMap, range.startTs, range.endTs);

    chart.setOption(this.buildChartOption(chartData, range.startTs, range.endTs), true);
  }

  private resolveImportExportKeys(): {
    importKey: string | null;
    exportKey: string | null;
    importLabel: string;
    exportLabel: string;
  } {
    const entries = Array.isArray(this.ctx?.data) ? this.ctx.data : [];
    const unique: Array<{ key: string; label: string }> = [];

    for (const entry of entries) {
      const key = String(entry?.dataKey?.name || '').trim();
      if (!key || unique.some((item) => item.key === key)) {
        continue;
      }

      unique.push({
        key,
        label: String(entry?.dataKey?.label || key)
      });
    }

    if (!unique.length) {
      return {
        importKey: null,
        exportKey: null,
        importLabel: 'Import',
        exportLabel: 'Export'
      };
    }

    const importCandidate = unique.find((item) => /import/i.test(item.key) || /import/i.test(item.label)) || unique[0];
    const exportCandidate = unique.find((item) => (/export/i.test(item.key) || /export/i.test(item.label)) && item.key !== importCandidate.key)
      || unique.find((item) => item.key !== importCandidate.key)
      || null;

    return {
      importKey: importCandidate?.key || null,
      exportKey: exportCandidate?.key || null,
      importLabel: importCandidate?.label || 'Import',
      exportLabel: exportCandidate?.label || 'Export'
    };
  }

  private resolveYearRange(): { startTs: number; endTs: number } {
    const endDay = this.startOfDay(Date.now());
    const startDay = endDay - (this.yearDays - 1) * this.dayMs;
    return { startTs: startDay, endTs: endDay + this.dayMs - 1 };
  }

  private aggregateByDay(importSeries: TimeseriesPoint[], exportSeries: TimeseriesPoint[]): Map<number, DailyAggregate> {
    const map = new Map<number, DailyAggregate>();

    for (const point of importSeries) {
      const dayTs = this.startOfDay(point.ts);
      const current = map.get(dayTs) || { importValue: 0, exportValue: 0 };
      current.importValue += Math.abs(point.value);
      map.set(dayTs, current);
    }

    for (const point of exportSeries) {
      const dayTs = this.startOfDay(point.ts);
      const current = map.get(dayTs) || { importValue: 0, exportValue: 0 };
      current.exportValue += Math.abs(point.value);
      map.set(dayTs, current);
    }

    return map;
  }

  private buildCalendarData(
    dailyMap: Map<number, DailyAggregate>,
    startTs: number,
    endTs: number
  ): CalendarDataPoint[] {
    const buckets: Array<{ dayTs: number; importValue: number; exportValue: number; total: number; imbalance: number }> = [];

    for (let dayTs = this.startOfDay(startTs); dayTs <= this.startOfDay(endTs); dayTs += this.dayMs) {
      const current = dailyMap.get(dayTs) || { importValue: 0, exportValue: 0 };
      const importValue = current.importValue;
      const exportValue = current.exportValue;
      const total = importValue + exportValue;
      const imbalance = Math.max(0, importValue - exportValue);

      buckets.push({ dayTs, importValue, exportValue, total, imbalance });
    }

    return buckets.map((bucket) => {
      const hasData = bucket.total > 0 ? 1 : 0;
      const directionalScore = hasData
        ? Math.max(-100, Math.min(100, Math.round(((bucket.exportValue - bucket.importValue) / bucket.total) * 100)))
        : 0;

      const value: CalendarDataValue = [
        this.formatDate(bucket.dayTs),
        directionalScore,
        bucket.importValue,
        bucket.exportValue,
        bucket.total,
        hasData
      ];

      if (!hasData) {
        return {
          value,
          itemStyle: {
            color: '#d1d5db'
          }
        };
      }

      return { value };
    });
  }

  private buildChartOption(
    seriesData: CalendarDataPoint[],
    startTs: number,
    endTs: number
  ): echarts.EChartsCoreOption {
    const startDate = this.formatDate(startTs);
    const endDate = this.formatDate(endTs);

    return {
      animation: false,
      backgroundColor: '#ffffff',
      tooltip: {
        position: 'top',
        confine: true,
        formatter: (params: any) => {
          const rawValue = params?.data?.value ?? params?.value;
          const value = Array.isArray(rawValue) ? rawValue : [];
          const date = value[0] || '-';
          const score = Number(value[1] ?? 0);
          const importValue = Number(value[2] ?? 0);
          const exportValue = Number(value[3] ?? 0);
          const total = Number(value[4] ?? 0);
          const hasData = Number(value[5] ?? 0) === 1;

          if (!hasData) {
            return [`<strong>${date}</strong>`, 'Bez dat'].join('<br/>');
          }

          return [
            `<strong>${date}</strong>`,
            `${this.importLabel}: ${this.formatNumber(importValue)} ${this.displayUnit}`,
            `${this.exportLabel}: ${this.formatNumber(exportValue)} ${this.displayUnit}`,
            `Denní energetický objem (import + export): ${this.formatNumber(total)} ${this.displayUnit}`,
            `Bilance: ${score}`
          ].join('<br/>');
        }
      },
      visualMap: {
        min: -100,
        max: 100,
        dimension: 1,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        top: 10,
        text: ['Export (zelená)', 'Import (červená)'],
        inRange: {
          color: ['#b71c1c', '#ef6c00', '#f6d365', '#9ccc65', '#2e7d32']
        }
      },
      calendar: {
        top: 64,
        left: 22,
        right: 22,
        bottom: 18,
        range: [startDate, endDate],
        cellSize: ['auto', 16],
        splitLine: {
          show: true,
          lineStyle: {
            color: '#ebebeb',
            width: 1
          }
        },
        itemStyle: {
          borderWidth: 1,
          borderColor: '#ffffff'
        },
        yearLabel: { show: false },
        monthLabel: {
          color: '#4f4f4f',
          margin: 10
        },
        dayLabel: {
          firstDay: 1,
          nameMap: ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'],
          color: '#6a6a6a'
        }
      },
      series: [
        {
          type: 'heatmap',
          coordinateSystem: 'calendar',
          data: seriesData,
          emphasis: {
            itemStyle: {
              shadowBlur: 8,
              shadowColor: 'rgba(0, 0, 0, 0.25)'
            }
          }
        }
      ]
    };
  }

  private renderInfoState(message: string): void {
    if (!this.chart) {
      return;
    }

    this.chart.setOption({
      animation: false,
      title: {
        text: message,
        left: 'center',
        top: 'middle',
        textStyle: {
          fontSize: 14,
          fontWeight: 600,
          color: '#6b7280'
        }
      },
      series: []
    }, true);
  }

  private async apiGetTimeseriesData(baseKey: string, startTs: number, endTs: number): Promise<TimeseriesPoint[]> {
    const source = this.resolvePrimaryDatasource();
    if (!source) {
      return [];
    }

    const apiKey = this.resolveApiKey(baseKey);
    const url = `/api/plugins/telemetry/${source.entityType}/${source.entityId}/values/timeseries`
      + `?keys=${encodeURIComponent(apiKey)}`
      + `&startTs=${startTs}`
      + `&endTs=${endTs}`
      + '&limit=100000'
      + '&orderBy=ASC'
      + '&useStrictDataTypes=true';

    try {
      const response = await this.apiGet<Record<string, Array<{ ts: number; value: any }>>>(url);
      const keyData = response?.[apiKey] || [];
      const output: TimeseriesPoint[] = [];

      for (const item of keyData) {
        const ts = Number(item?.ts);
        const value = Number(item?.value);
        if (!Number.isFinite(ts) || !Number.isFinite(value)) {
          continue;
        }

        output.push({ ts, value });
      }

      return output;
    } catch (error) {
      console.error('[MiikueKalendar] API error for key', apiKey, error);
      return [];
    }
  }

  private resolvePrimaryDatasource(): { entityType: string; entityId: string } | null {
    const dsFromSub = this.ctx?.defaultSubscription?.datasources;
    const dsFromCtx = this.ctx?.datasources;
    const datasource = (dsFromSub && dsFromSub.length ? dsFromSub[0] : dsFromCtx?.[0]) || null;

    if (!datasource?.entityType || !datasource?.entityId) {
      return null;
    }

    return {
      entityType: String(datasource.entityType).toUpperCase(),
      entityId: String(datasource.entityId)
    };
  }

  private async apiGet<T>(url: string): Promise<T> {
    const ctxHttp = this.ctx?.http;
    if (!ctxHttp?.get) {
      throw new Error('ctx.http.get is not available');
    }

    return firstValueFrom(ctxHttp.get(url));
  }

  private resolveApiKey(baseKey: string): string {
    return /_hour$/i.test(baseKey) ? baseKey : `${baseKey}_hour`;
  }

  private startOfDay(ts: number): number {
    const day = new Date(ts);
    day.setHours(0, 0, 0, 0);
    return day.getTime();
  }

  private formatDate(ts: number): string {
    const date = new Date(ts);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatNumber(value: number): string {
    return value.toLocaleString('cs-CZ', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    });
  }
}
