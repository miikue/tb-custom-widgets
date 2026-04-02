import { Component, Input, OnInit } from '@angular/core';
import { WidgetContext } from '@home/models/widget-component.models';
import { ChartDataPoint } from '../miikue-chart-engine/miikue-chart-engine.component';
import { TimeWindow } from '../miikue-time-window-selector/miikue-time-window-selector.component';
import { firstValueFrom } from 'rxjs';

type AggregationMode = 'seconds' | 'min' | 'hour';

@Component({
  selector: 'tb-miikue-chart',
  templateUrl: './miikue-chart.component.html',
  styleUrls: ['./miikue-chart.component.scss'],
  standalone: false
})
export class MiikueChartComponent implements OnInit {

  @Input() ctx: WidgetContext;

  engineCtx: any = {};
  chartData: ChartDataPoint[] = [];
  selectedTimeWindow: TimeWindow;
  selectedAggregationMode: AggregationMode = 'seconds';
  readonly aggregationModes: Array<{ value: AggregationMode; label: string }> = [
    { value: 'seconds', label: 'Surová data' },
    { value: 'min', label: 'Agregace min' },
    { value: 'hour', label: 'Agregace hour' }
  ];
  labels: string[] = [];
  keys: string[] = [];
  private keyToLabel = new Map<string, string>();
  private fetchSequence = 0;

  async ngOnInit() {
    console.log('[MiikueChart] ngOnInit - loading data from API');
    this.selectedTimeWindow = this.getDefaultTimeWindow();
    this.initializeKeysAndLabels();
    this.prepareEngineCtx();

    await this.loadChartDataForCurrentWindow();
  }


  async onTimeWindowChange(timeWindow: TimeWindow) {
    this.selectedTimeWindow = timeWindow;
    console.log('[MiikueChart] Selected time window:', {
      startTs: timeWindow?.startTs,
      endTs: timeWindow?.endTs,
      startIso: timeWindow?.startTs ? new Date(timeWindow.startTs).toISOString() : null,
      endIso: timeWindow?.endTs ? new Date(timeWindow.endTs).toISOString() : null
    });

    await this.loadChartDataForCurrentWindow();
  }

  async onAggregationModeChange(mode: AggregationMode): Promise<void> {
    if (this.selectedAggregationMode === mode) {
      return;
    }

    this.selectedAggregationMode = mode;
    // Reload data with new aggregation mode (different API keys)
    await this.loadChartDataForCurrentWindow();
  }

  private initializeKeysAndLabels(): void {
    this.keys = [];
    this.labels = [];
    this.keyToLabel.clear();

    const dataEntries = (this.ctx as any)?.data || [];
    for (const entry of dataEntries) {
      const key = entry?.dataKey?.name;
      if (!key || this.keyToLabel.has(key)) {
        continue;
      }
      const label = entry?.dataKey?.label || key;
      this.keys.push(key);
      this.labels.push(label);
      this.keyToLabel.set(key, label);
    }
  }

  private async loadChartDataForCurrentWindow(): Promise<void> {
    if (!this.selectedTimeWindow || !this.keys.length) {
      return;
    }

    const { startTs, endTs } = this.selectedTimeWindow;
    const fetchId = ++this.fetchSequence;

    const requests = this.keys.map((key) => this.apiGetTimeseriesData(key, startTs, endTs));
    const responseChunks = await Promise.all(requests);

    if (fetchId !== this.fetchSequence) {
      return;
    }

    this.chartData = responseChunks.flat();
    this.prepareEngineCtx();
    this.ctx?.detectChanges?.();
  }

  private resolvePrimaryDatasource(): { entityType: string; entityId: string } | null {
    const dsFromSub = (this.ctx as any)?.defaultSubscription?.datasources;
    const dsFromCtx = (this.ctx as any)?.datasources;
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
    const ctxHttp = (this.ctx as any)?.http;
    if (!ctxHttp?.get) {
      throw new Error('ctx.http.get is not available');
    }
    return firstValueFrom(ctxHttp.get(url));
  }

  private async apiGetTimeseriesData(baseKey: string, startTs: number, endTs: number): Promise<ChartDataPoint[]> {
    const source = this.resolvePrimaryDatasource();
    if (!source) {
      console.warn('[MiikueChart] Missing datasource entity info, cannot load API data');
      return [];
    }

    // Append aggregation suffix to the key based on selected mode
    const apiKey = this.getAggregatedKey(baseKey);

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
      // Use original baseKey as series name (without aggregation suffix)
      const seriesName = this.keyToLabel.get(baseKey) || baseKey;

      return keyData
        .map((item) => ({
          ts: Number(item.ts),
          value: Number(item.value),
          name: seriesName
        }))
        .filter((item) => Number.isFinite(item.ts) && Number.isFinite(item.value));
    } catch (error) {
      console.error('[MiikueChart] API error for key', apiKey, error);
      return [];
    }
  }


  private prepareEngineCtx() {
    this.engineCtx = {
      ...(this.ctx || {}),
      chartData: this.chartData,
      aggregationMode: this.selectedAggregationMode
    };
  }

  // Get API key with aggregation suffix based on selected mode
  private getAggregatedKey(baseKey: string): string {
    switch (this.selectedAggregationMode) {
      case 'min':
        return `${baseKey}_min`;
      case 'hour':
        return `${baseKey}_hour`;
      case 'seconds':
      default:
        return baseKey;
    }
  }

  // Default time window: last 24 hours
  private getDefaultTimeWindow(): TimeWindow {
    const endTs = Date.now();
    const startTs = endTs - (24 * 60 * 60 * 1000);
    return { startTs, endTs };
  }

}