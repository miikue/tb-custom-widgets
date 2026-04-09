import { Component, Input, OnInit, ViewChild } from '@angular/core';
import { WidgetContext } from '@home/models/widget-component.models';
import { ChartDataPoint, MiikueChartEngineComponent } from '../miikue-chart-engine/miikue-chart-engine.component';
import { TimeWindow } from '../miikue-time-window-selector/miikue-time-window-selector.component';
import { firstValueFrom } from 'rxjs';

type AggregationMode = 'seconds' | 'min' | 'hour';

interface ModeCache {
  coveredStartTs: number | null;
  coveredEndTs: number | null;
  pointsByKey: Map<string, ChartDataPoint>;
}

@Component({
  selector: 'tb-miikue-chart',
  templateUrl: './miikue-chart.component.html',
  styleUrls: ['./miikue-chart.component.scss'],
  standalone: false
})
export class MiikueChartComponent implements OnInit {

  @Input() ctx: WidgetContext;
  @ViewChild(MiikueChartEngineComponent) chartEngine?: MiikueChartEngineComponent;

  engineCtx: any = {};
  chartData: ChartDataPoint[] = [];
  selectedTimeWindow: TimeWindow;
  selectedAggregationMode: AggregationMode = 'min';
  isLoading = false;
  loadingProgressPercent = 0;
  loadingMessage = '';
  private loadingMessagePrefix = '';
  readonly aggregationModes: Array<{ value: AggregationMode; label: string }> = [
    { value: 'seconds', label: 'Surová data' },
    { value: 'min', label: 'Agregace min' },
    { value: 'hour', label: 'Agregace hour' }
  ];
  labels: string[] = [];
  keys: string[] = [];
  private keyToLabel = new Map<string, string>();
  private keyToColor = new Map<string, string>();
  private fetchSequence = 0;
  private readonly maxConcurrentChunkRequests = 8;
  private modeCache: Record<AggregationMode, ModeCache> = {
    seconds: this.createEmptyModeCache(),
    min: this.createEmptyModeCache(),
    hour: this.createEmptyModeCache()
  };

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

  onZoomSelectToggle(): void {
    this.chartEngine?.toggleZoomSelection();
  }

  onZoomBack(): void {
    this.chartEngine?.zoomBackOneStep();
  }

  onZoomOutFull(): void {
    this.chartEngine?.zoomOutToFullRange();
  }

  onSavePng(): void {
    this.chartEngine?.saveAsPng();
  }

  private initializeKeysAndLabels(): void {
    this.keys = [];
    this.labels = [];
    this.keyToLabel.clear();
    this.keyToColor.clear();

    const dataEntries = (this.ctx as any)?.data || [];
    for (const entry of dataEntries) {
      const key = entry?.dataKey?.name;
      if (!key || this.keyToLabel.has(key)) {
        continue;
      }
      const label = entry?.dataKey?.label || key;
      const color = entry?.dataKey?.color;
      this.keys.push(key);
      this.labels.push(label);
      this.keyToLabel.set(key, label);
      if (color) {
        this.keyToColor.set(key, color);
      }
    }
  }

  private async loadChartDataForCurrentWindow(): Promise<void> {
    if (!this.selectedTimeWindow || !this.keys.length) {
      return;
    }

    const mode = this.selectedAggregationMode;
    const { startTs, endTs } = this.selectedTimeWindow;
    const normalizedStartTs = Math.min(startTs, endTs);
    const normalizedEndTs = Math.max(startTs, endTs);
    const windowDurationMs = normalizedEndTs - normalizedStartTs;
    const fetchId = ++this.fetchSequence;
    const cache = this.modeCache[mode];

    const fetchStartTs = this.resolveFetchWindowStart(mode, normalizedStartTs, normalizedEndTs, windowDurationMs);
    this.loadingMessagePrefix = this.buildLoadingPrefix(mode, normalizedStartTs, normalizedEndTs, fetchStartTs);
    const missingRanges = this.resolveMissingRanges(cache, fetchStartTs, normalizedEndTs);
    const requestFactories: Array<() => Promise<ChartDataPoint[]>> = [];

    for (const range of missingRanges) {
      const chunks = this.buildTimeChunks(range.startTs, range.endTs, this.resolveChunkSizeMs(mode));
      for (const key of this.keys) {
        for (const chunk of chunks) {
          requestFactories.push(() => this.apiGetTimeseriesData(key, chunk.startTs, chunk.endTs, mode));
        }
      }
    }

    if (requestFactories.length) {
      this.startLoading(requestFactories.length);
      try {
        const responseChunks = await this.runWithConcurrencyLimit(
          requestFactories,
          this.maxConcurrentChunkRequests,
          (completed, total) => {
            if (fetchId === this.fetchSequence) {
              this.updateLoadingProgress(completed, total);
            }
          }
        );

        if (fetchId !== this.fetchSequence) {
          return;
        }

        const incomingPoints = this.mergeChartData(responseChunks.flat());
        this.appendToCache(cache, incomingPoints);
        for (const range of missingRanges) {
          this.expandCoveredRange(cache, range.startTs, range.endTs);
        }
      } finally {
        if (fetchId === this.fetchSequence) {
          this.finishLoading();
        }
      }
    } else {
      this.resetLoading();
    }

    if (fetchId !== this.fetchSequence) {
      return;
    }

    this.chartData = this.getCachedPointsInRange(cache, fetchStartTs, normalizedEndTs);
    this.prepareEngineCtx();
    this.ctx?.detectChanges?.();
  }

  private resolveChunkSizeMs(mode: AggregationMode): number {
    switch (mode) {
      case 'min':
        // Minute aggregations are chunked by day.
        return 24 * 60 * 60 * 1000;
      case 'hour':
        // Hour aggregations are chunked by week.
        return 7 * 24 * 60 * 60 * 1000;
      case 'seconds':
      default:
        // Raw samples are chunked by hour.
        return 60 * 60 * 1000;
    }
  }

  private resolveFetchWindowStart(mode: AggregationMode, startTs: number, endTs: number, windowDurationMs: number): number {
    const monthMs = 31 * 24 * 60 * 60 * 1000;
    const yearMs = 365 * 24 * 60 * 60 * 1000;

    switch (mode) {
      case 'seconds':
        return windowDurationMs > monthMs ? Math.max(startTs, endTs - monthMs + 1) : startTs;
      case 'min':
        return windowDurationMs > yearMs ? Math.max(startTs, endTs - yearMs + 1) : startTs;
      case 'hour':
      default:
        return startTs;
    }
  }

  private buildLoadingPrefix(mode: AggregationMode, fullStartTs: number, fullEndTs: number, fetchStartTs: number): string {
    const totalMs = Math.max(1, fullEndTs - fullStartTs + 1);
    const fetchedMs = Math.max(1, fullEndTs - fetchStartTs + 1);
    const fetchedPercent = Math.min(100, Math.max(1, Math.round((fetchedMs / totalMs) * 100)));

    if (fetchStartTs > fullStartTs) {
      return `Tahám v limitu (${fetchedPercent} % okna)`;
    }

    switch (mode) {
      case 'seconds':
        return 'Načítám raw data';
      case 'min':
        return 'Načítám minutová data';
      case 'hour':
      default:
        return 'Načítám hodinová data';
    }
  }

  private buildTimeChunks(startTs: number, endTs: number, chunkSizeMs: number): Array<{ startTs: number; endTs: number }> {
    const normalizedStart = Math.min(startTs, endTs);
    const normalizedEnd = Math.max(startTs, endTs);
    const chunks: Array<{ startTs: number; endTs: number }> = [];

    let currentStart = normalizedStart;
    while (currentStart <= normalizedEnd) {
      const currentEnd = Math.min(currentStart + chunkSizeMs - 1, normalizedEnd);
      chunks.push({ startTs: currentStart, endTs: currentEnd });
      currentStart = currentEnd + 1;
    }

    return chunks;
  }

  private createEmptyModeCache(): ModeCache {
    return {
      coveredStartTs: null,
      coveredEndTs: null,
      pointsByKey: new Map<string, ChartDataPoint>()
    };
  }

  private resolveMissingRanges(cache: ModeCache, startTs: number, endTs: number): Array<{ startTs: number; endTs: number }> {
    if (cache.coveredStartTs == null || cache.coveredEndTs == null) {
      return [{ startTs, endTs }];
    }

    const missing: Array<{ startTs: number; endTs: number }> = [];

    if (startTs < cache.coveredStartTs) {
      missing.push({
        startTs,
        endTs: Math.min(endTs, cache.coveredStartTs - 1)
      });
    }

    if (endTs > cache.coveredEndTs) {
      missing.push({
        startTs: Math.max(startTs, cache.coveredEndTs + 1),
        endTs
      });
    }

    return missing.filter((range) => range.startTs <= range.endTs);
  }

  private appendToCache(cache: ModeCache, points: ChartDataPoint[]): void {
    for (const point of points) {
      cache.pointsByKey.set(`${point.name}|${point.ts}`, point);
    }
  }

  private expandCoveredRange(cache: ModeCache, startTs: number, endTs: number): void {
    if (cache.coveredStartTs == null || cache.coveredEndTs == null) {
      cache.coveredStartTs = startTs;
      cache.coveredEndTs = endTs;
      return;
    }

    cache.coveredStartTs = Math.min(cache.coveredStartTs, startTs);
    cache.coveredEndTs = Math.max(cache.coveredEndTs, endTs);
  }

  private getCachedPointsInRange(cache: ModeCache, startTs: number, endTs: number): ChartDataPoint[] {
    const points: ChartDataPoint[] = [];
    for (const point of cache.pointsByKey.values()) {
      if (point.ts >= startTs && point.ts <= endTs) {
        points.push(point);
      }
    }
    return points.sort((a, b) => a.ts - b.ts);
  }

  private async runWithConcurrencyLimit<T>(
    requestFactories: Array<() => Promise<T>>,
    limit: number,
    onProgress?: (completed: number, total: number) => void
  ): Promise<T[]> {
    if (!requestFactories.length) {
      return [];
    }

    const results: T[] = [];
    let index = 0;
    let completed = 0;
    const total = requestFactories.length;

    const workers = Array.from({ length: Math.min(limit, requestFactories.length) }, async () => {
      while (index < requestFactories.length) {
        const current = index++;
        results[current] = await requestFactories[current]();
        completed += 1;
        onProgress?.(completed, total);
      }
    });

    await Promise.all(workers);
    return results;
  }

  private mergeChartData(points: ChartDataPoint[]): ChartDataPoint[] {
    const uniquePoints = new Map<string, ChartDataPoint>();

    for (const point of points) {
      uniquePoints.set(`${point.name}|${point.ts}`, point);
    }

    return Array.from(uniquePoints.values()).sort((a, b) => a.ts - b.ts);
  }

  private startLoading(totalRequests: number): void {
    this.isLoading = true;
    this.loadingProgressPercent = 0;
    this.loadingMessage = `${this.loadingMessagePrefix} (0 % requestů)`;
    this.ctx?.detectChanges?.();
  }

  private updateLoadingProgress(completed: number, total: number): void {
    const safeTotal = Math.max(1, total);
    this.loadingProgressPercent = Math.min(100, Math.round((completed / safeTotal) * 100));
    this.loadingMessage = `${this.loadingMessagePrefix} (${this.loadingProgressPercent} % requestů)`;
    this.ctx?.detectChanges?.();
  }

  private finishLoading(): void {
    this.loadingProgressPercent = 100;
    this.loadingMessage = `${this.loadingMessagePrefix} (100 % requestů)`;
    this.isLoading = false;
    this.ctx?.detectChanges?.();
  }

  private resetLoading(): void {
    this.isLoading = false;
    this.loadingProgressPercent = 0;
    this.loadingMessage = '';
    this.loadingMessagePrefix = '';
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

  private async apiGetTimeseriesData(baseKey: string, startTs: number, endTs: number, mode: AggregationMode): Promise<ChartDataPoint[]> {
    const source = this.resolvePrimaryDatasource();
    if (!source) {
      console.warn('[MiikueChart] Missing datasource entity info, cannot load API data');
      return [];
    }

    // Append aggregation suffix to the key based on selected mode
    const apiKey = this.getAggregatedKey(baseKey, mode);

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
          name: seriesName,
          color: this.keyToColor.get(baseKey)
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
      aggregationMode: this.selectedAggregationMode,
      selectedTimeWindow: this.selectedTimeWindow
    };
  }

  // Get API key with aggregation suffix based on selected mode
  private getAggregatedKey(baseKey: string, mode: AggregationMode): string {
    switch (mode) {
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