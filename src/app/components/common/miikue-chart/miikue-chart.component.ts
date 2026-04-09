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

interface KeyValueTransformArgs {
  time: number;
  value: number;
  prevValue?: number;
  timePrev?: number;
  prevOrigValue?: number;
}

type KeyValueTransform = (args: KeyValueTransformArgs) => number;

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
  isWidgetExpanded = false;
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
  private keyToUnits = new Map<string, string>();
  private keyToDecimals = new Map<string, number>();
  private keyToValueTransform = new Map<string, KeyValueTransform>();
  private fetchSequence = 0;
  private readonly maxConcurrentChunkRequests = 8;
  private modeCache: Record<AggregationMode, ModeCache> = {
    seconds: this.createEmptyModeCache(),
    min: this.createEmptyModeCache(),
    hour: this.createEmptyModeCache()
  };

  get shouldRenderChart(): boolean {
    return this.resolveShowSmallGraph() || this.isWidgetExpanded;
  }

  async ngOnInit() {
    console.log('[MiikueChart] ngOnInit - loading data from API');
    if (this.ctx?.$scope) {
      this.ctx.$scope.miikueChartWidget = this;
    }

    this.updateExpandedState();
    this.selectedTimeWindow = this.getDefaultTimeWindow();
    this.initializeKeysAndLabels();
    this.prepareEngineCtx();

    if (!this.shouldRenderChart) {
      this.enterCollapsedIdleState();
      return;
    }

    await this.loadChartDataForCurrentWindow();
  }

  async onResize(): Promise<void> {
    const wasRenderable = this.shouldRenderChart;
    this.updateExpandedState();

    if (!this.shouldRenderChart && wasRenderable) {
      this.enterCollapsedIdleState();
      return;
    }

    if (this.shouldRenderChart && !wasRenderable) {
      await this.loadChartDataForCurrentWindow();
    }
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
    this.keyToUnits.clear();
    this.keyToDecimals.clear();
    this.keyToValueTransform.clear();

    const dataEntries = (this.ctx as any)?.data || [];
    for (const entry of dataEntries) {
      const key = entry?.dataKey?.name;
      if (!key || this.keyToLabel.has(key)) {
        continue;
      }
      const label = entry?.dataKey?.label || key;
      const color = entry?.dataKey?.color;
      const units = entry?.dataKey?.units;
      const decimals = Number(entry?.dataKey?.decimals);
      this.keys.push(key);
      this.labels.push(label);
      this.keyToLabel.set(key, label);
      if (color) {
        this.keyToColor.set(key, color);
      }
      if (typeof units === 'string' && units.trim().length) {
        this.keyToUnits.set(key, units);
      }
      if (Number.isFinite(decimals)) {
        this.keyToDecimals.set(key, decimals);
      }
      this.keyToValueTransform.set(key, this.createValueTransform(entry));
    }
  }

  private createValueTransform(entry: any): KeyValueTransform {
    const dataKey = entry?.dataKey || {};
    const settings = dataKey?.settings || {};
    const keyName = String(dataKey?.name || '');
    const keyLabel = String(dataKey?.label || keyName);

    const multiplier = this.firstFiniteNumber([
      settings?.valueMultiplier,
      settings?.multiplier,
      settings?.scaleFactor,
      dataKey?.valueMultiplier,
      dataKey?.multiplier
    ]);

    const divider = this.firstFiniteNumber([
      settings?.valueDivider,
      settings?.divider,
      settings?.divisor,
      settings?.divideBy,
      dataKey?.valueDivider,
      dataKey?.divider,
      dataKey?.divisor
    ]);

    const postProcessor = this.buildPostProcessor(dataKey, keyName, keyLabel);

    return ({ time, value: inputValue, prevValue, timePrev, prevOrigValue }: KeyValueTransformArgs): number => {
      let value = inputValue;

      if (multiplier != null) {
        value = value * multiplier;
      }

      if (divider != null && divider !== 0) {
        value = value / divider;
      }

      if (postProcessor) {
        value = postProcessor({
          time,
          value,
          prevValue,
          timePrev,
          prevOrigValue
        });
      }

      return value;
    };
  }

  private buildPostProcessor(dataKey: any, keyName: string, _keyLabel: string): KeyValueTransform | null {
    const usePostProcessing = Boolean(dataKey?.usePostProcessing);
    const postFuncBody = String(dataKey?.postFuncBody || '').trim();

    if (!usePostProcessing || !postFuncBody) {
      return null;
    }

    try {
      let postProcessFn: unknown;
      const looksLikeFunctionLiteral = /^\s*function\b/.test(postFuncBody)
        || /^\s*\(/.test(postFuncBody)
        || /^\s*[A-Za-z_$][\w$]*\s*=>/.test(postFuncBody);

      if (looksLikeFunctionLiteral) {
        postProcessFn = new Function(`return (${postFuncBody});`)();
      } else {
        postProcessFn = new Function('time', 'value', 'prevValue', 'timePrev', 'prevOrigValue', postFuncBody);
      }

      if (typeof postProcessFn !== 'function') {
        console.warn('[MiikueChart] postFuncBody did not produce a function for key', keyName);
        return null;
      }

      const typedPostProcessFn = postProcessFn as
        (time: number, value: number, prevValue?: number, timePrev?: number, prevOrigValue?: number) => unknown;

      return ({ time, value, prevValue, timePrev, prevOrigValue }: KeyValueTransformArgs): number => {
        try {
          const result = typedPostProcessFn(time, value, prevValue, timePrev, prevOrigValue);
          const numeric = Number(result);
          return Number.isFinite(numeric) ? numeric : value;
        } catch (error) {
          console.warn('[MiikueChart] postFuncBody runtime error for key', keyName, error);
          return value;
        }
      };
    } catch (error) {
      console.warn('[MiikueChart] postFuncBody compile error for key', keyName, error);
      return null;
    }
  }

  private firstFiniteNumber(values: any[]): number | null {
    for (const candidate of values) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  private async loadChartDataForCurrentWindow(): Promise<void> {
    if (!this.shouldRenderChart) {
      this.enterCollapsedIdleState();
      return;
    }

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

  private updateExpandedState(): void {
    const dashboard: any = this.ctx?.dashboard;

    if (typeof dashboard?.isWidgetExpanded === 'boolean') {
      this.isWidgetExpanded = dashboard.isWidgetExpanded;
      return;
    }

    this.isWidgetExpanded = false;
  }

  private resolveShowSmallGraph(): boolean {
    const value = (this.ctx as any)?.settings?.showSmallGraph;

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (!normalized) {
        return true;
      }
      if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
        return false;
      }
      return true;
    }

    if (typeof value === 'number') {
      return value !== 0;
    }

    return true;
  }

  private enterCollapsedIdleState(): void {
    this.resetLoading();
    this.chartData = [];
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
      const valueTransform = this.keyToValueTransform.get(baseKey);
      const transformedPoints: ChartDataPoint[] = [];
      let prevValue: number | undefined;
      let prevOrigValue: number | undefined;
      let timePrev: number | undefined;

      for (const item of keyData) {
        const ts = Number(item.ts);
        const numericValue = Number(item.value);

        if (!Number.isFinite(ts) || !Number.isFinite(numericValue)) {
          continue;
        }

        const transformedValue = valueTransform
          ? valueTransform({
              time: ts,
              value: numericValue,
              prevValue,
              timePrev,
              prevOrigValue
            })
          : numericValue;

        if (!Number.isFinite(transformedValue)) {
          continue;
        }

        transformedPoints.push({
          ts,
          value: transformedValue,
          name: seriesName,
          color: this.keyToColor.get(baseKey),
          units: this.keyToUnits.get(baseKey),
          decimals: this.keyToDecimals.get(baseKey)
        });

        prevValue = transformedValue;
        prevOrigValue = numericValue;
        timePrev = ts;
      }

      return transformedPoints;
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