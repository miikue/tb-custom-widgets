/// <reference lib="webworker" />

interface ChartDataPoint {
  ts: number;
  value: number;
  name: string;
  color?: string;
}

type AggregationMode = 'seconds' | 'min' | 'hour' | 'day';
type SeriesPoint = [number, number | null];
type SeriesRole = 'spotreba' | 'export' | 'positiveBar';

interface ChartTimeWindow {
  startTs: number;
  endTs: number;
}

interface ChartEngineSettings {
  rawGapBreakSeconds?: number;
  minGapBreakMinutes?: number;
  hourGapBreakHours?: number;
  dayGapBreakDays?: number;
}

interface SetDataMessage {
  type: 'setData';
  requestId: number;
  chartData: ChartDataPoint[];
  selectedTimeWindow?: ChartTimeWindow;
  aggregationMode: AggregationMode;
  settings?: ChartEngineSettings;
}

interface RenderMessage {
  type: 'render';
  requestId: number;
  viewWindow?: { minTs: number | null; maxTs: number | null };
  width: number;
  maxPointsPerPixel: number;
}

interface WorkerSeriesResult {
  name: string;
  color?: string;
  data: SeriesPoint[];
}

interface WorkerResultMessage {
  type: 'result';
  requestId: number;
  series: WorkerSeriesResult[];
  xRange: { minTs?: number; maxTs?: number };
}

interface WorkerReadyMessage {
  type: 'ready';
  requestId: number;
}

interface WorkerErrorMessage {
  type: 'error';
  requestId: number;
  error: string;
}

type WorkerInputMessage = SetDataMessage | RenderMessage;

interface SeriesState {
  points: SeriesPoint[];
  color?: string;
}

let seriesState = new Map<string, SeriesState>();
let selectedWindow: ChartTimeWindow | null = null;
let aggregationMode: AggregationMode = 'seconds';
let settings: ChartEngineSettings = {};
let fullRangeMinTs: number | null = null;
let fullRangeMaxTs: number | null = null;
const EXPORT_ZERO_EPSILON = 1e-6;

self.addEventListener('message', (event: MessageEvent<WorkerInputMessage>) => {
  const message = event.data;

  try {
    if (message.type === 'setData') {
      handleSetData(message);
      postWorkerMessage<WorkerReadyMessage>({ type: 'ready', requestId: message.requestId });
      return;
    }

    if (message.type === 'render') {
      const rendered = handleRender(message);
      postWorkerMessage<WorkerResultMessage>({
        type: 'result',
        requestId: message.requestId,
        series: rendered.series,
        xRange: rendered.xRange
      });
    }
  } catch (error) {
    postWorkerMessage<WorkerErrorMessage>({
      type: 'error',
      requestId: message.requestId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

function handleSetData(message: SetDataMessage): void {
  seriesState = new Map<string, SeriesState>();
  selectedWindow = message.selectedTimeWindow || null;
  aggregationMode = message.aggregationMode || 'seconds';
  settings = message.settings || {};
  fullRangeMinTs = null;
  fullRangeMaxTs = null;

  const grouped = new Map<string, Array<{ ts: number; value: number; color?: string }>>();

  for (const point of message.chartData || []) {
    if (!grouped.has(point.name)) {
      grouped.set(point.name, []);
    }
    grouped.get(point.name)!.push({ ts: point.ts, value: point.value, color: point.color });
  }

  for (const [name, points] of grouped.entries()) {
    points.sort((a, b) => a.ts - b.ts);

    const color = points.find((point) => !!point.color)?.color;
    const withBreaks = buildSeriesWithGapBreaks(points);
    seriesState.set(name, { points: withBreaks, color });

    if (withBreaks.length) {
      const firstTs = withBreaks[0][0];
      const lastTs = withBreaks[withBreaks.length - 1][0];
      fullRangeMinTs = fullRangeMinTs == null ? firstTs : Math.min(fullRangeMinTs, firstTs);
      fullRangeMaxTs = fullRangeMaxTs == null ? lastTs : Math.max(fullRangeMaxTs, lastTs);
    }
  }
}

function handleRender(message: RenderMessage): { series: WorkerSeriesResult[]; xRange: { minTs?: number; maxTs?: number } } {
  const visibleRange = message.viewWindow || resolveFullRange();
  const series: WorkerSeriesResult[] = [];
  const fallbackColors = ['#2196f3', '#FFC107', '#FF5733', '#33FF57', '#FF9800'];
  let colorIndex = 0;
  const barSeriesData = new Map<string, SeriesPoint[]>();

  for (const [name, state] of seriesState.entries()) {
    const pointsInRange = filterByRange(state.points, visibleRange.minTs, visibleRange.maxTs);
    const color = state.color || fallbackColors[colorIndex % fallbackColors.length];

    if (getSeriesRole(name) === 'spotreba') {
      series.push({
        name,
        color,
        data: decimateForWidth(pointsInRange, message.width, message.maxPointsPerPixel)
      });
    } else {
      barSeriesData.set(name, toBarSeriesData(pointsInRange));
    }

    colorIndex++;
  }

  const alignedBarSeriesData = alignBarSeriesData(barSeriesData);
  const adjustedBarSeriesData = adjustFveSeriesByExport(alignedBarSeriesData);

  for (const [name, state] of seriesState.entries()) {
    if (getSeriesRole(name) === 'spotreba') {
      continue;
    }

    const color = state.color || fallbackColors[series.length % fallbackColors.length];
    const role = getSeriesRole(name);
      const isExport = role === 'export';
      series.push({
        name,
        color,
      data: toBarSeriesData(adjustedBarSeriesData.get(name) || [], isExport ? -1 : 1, isExport)
      });
  }

  return {
    series,
    xRange: resolveXAxisRange()
  };
}

function resolveXAxisRange(): { minTs?: number; maxTs?: number } {
  if (selectedWindow?.startTs != null && selectedWindow?.endTs != null) {
    return {
      minTs: Math.min(selectedWindow.startTs, selectedWindow.endTs),
      maxTs: Math.max(selectedWindow.startTs, selectedWindow.endTs)
    };
  }

  if (fullRangeMinTs == null || fullRangeMaxTs == null) {
    return {};
  }

  return { minTs: fullRangeMinTs, maxTs: fullRangeMaxTs };
}

function resolveFullRange(): { minTs: number | null; maxTs: number | null } {
  const xRange = resolveXAxisRange();
  return {
    minTs: xRange.minTs ?? null,
    maxTs: xRange.maxTs ?? null
  };
}

function filterByRange(points: SeriesPoint[], minTs: number | null, maxTs: number | null): SeriesPoint[] {
  if (minTs == null || maxTs == null) {
    return points;
  }
  return points.filter((point) => point[0] >= minTs && point[0] <= maxTs);
}

function normalizeSeriesName(seriesName: string): string {
  return String(seriesName || '')
    .toLocaleLowerCase('cs-CZ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getSeriesRole(seriesName: string): SeriesRole {
  const normalizedName = normalizeSeriesName(seriesName);

  if (normalizedName.includes('spotreba')) {
    return 'spotreba';
  }

  if (normalizedName.includes('export') || normalizedName.includes('pretok')) {
    return 'export';
  }

  return 'positiveBar';
}

function isImportSeries(seriesName: string): boolean {
  const normalizedName = normalizeSeriesName(seriesName);
  return normalizedName.includes('import') || normalizedName.includes('odber');
}

function toBarSeriesData(points: SeriesPoint[], valueMultiplier = 1, keepZeroNegative = false): SeriesPoint[] {
  return points
    .filter((point): point is [number, number] => point[1] != null)
    .map((point) => {
      const scaledValue = point[1] * valueMultiplier;
      if (keepZeroNegative && scaledValue === 0) {
        return [point[0], -EXPORT_ZERO_EPSILON];
      }
      return [point[0], scaledValue];
    });
}

function alignBarSeriesData(seriesMap: Map<string, SeriesPoint[]>): Map<string, SeriesPoint[]> {
  const timestamps = new Set<number>();
  const barSeriesMaps = new Map<string, Map<number, number>>();

  for (const [name, points] of seriesMap.entries()) {
    const pointMap = new Map<number, number>();
    for (const point of points) {
      timestamps.add(point[0]);
      pointMap.set(point[0], point[1] ?? 0);
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

function adjustFveSeriesByExport(seriesMap: Map<string, SeriesPoint[]>): Map<string, SeriesPoint[]> {
  const exportByTimestamp = new Map<number, number>();

  for (const [name, points] of seriesMap.entries()) {
    if (getSeriesRole(name) !== 'export') {
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
    if (getSeriesRole(name) === 'positiveBar' && !isImportSeries(name)) {
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

function decimateForWidth(points: SeriesPoint[], width: number, maxPointsPerPixel: number): SeriesPoint[] {
  if (points.length <= 2) {
    return points;
  }

  const safeWidth = Math.max(1, width || 1);
  const targetMaxPoints = Math.max(200, Math.floor(safeWidth * maxPointsPerPixel));

  const nullPoints: SeriesPoint[] = points.filter((point) => point[1] == null);
  const numericPoints: Array<[number, number]> = points.filter((point): point is [number, number] => point[1] != null);

  if (!numericPoints.length) {
    return nullPoints;
  }

  const decimatedNumeric = numericPoints.length <= targetMaxPoints
    ? numericPoints
    : minMaxDecimate(numericPoints, targetMaxPoints);

  const merged = [...decimatedNumeric, ...nullPoints] as SeriesPoint[];
  const deduped = new Map<string, SeriesPoint>();
  for (const point of merged) {
    deduped.set(`${point[0]}|${point[1]}`, point);
  }

  return Array.from(deduped.values()).sort((a, b) => a[0] - b[0]);
}

function buildSeriesWithGapBreaks(dataPoints: Array<{ ts: number; value: number }>): SeriesPoint[] {
  if (!dataPoints.length) {
    return [];
  }

  const result: SeriesPoint[] = [];
  const maxGapMs = resolveGapThresholdMs();
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

function resolveGapThresholdMs(): number {
  switch (aggregationMode) {
    case 'day':
      return Number.isFinite(settings.dayGapBreakDays) && (settings.dayGapBreakDays as number) > 0
        ? (settings.dayGapBreakDays as number) * 24 * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;
    case 'min':
      return Number.isFinite(settings.minGapBreakMinutes) && (settings.minGapBreakMinutes as number) > 0
        ? (settings.minGapBreakMinutes as number) * 60 * 1000
        : 60 * 1000;
    case 'hour':
      return Number.isFinite(settings.hourGapBreakHours) && (settings.hourGapBreakHours as number) > 0
        ? (settings.hourGapBreakHours as number) * 60 * 60 * 1000
        : 60 * 60 * 1000;
    case 'seconds':
    default:
      return Number.isFinite(settings.rawGapBreakSeconds) && (settings.rawGapBreakSeconds as number) > 0
        ? (settings.rawGapBreakSeconds as number) * 1000
        : 5000;
  }
}

function minMaxDecimate(points: Array<[number, number]>, targetMaxPoints: number): Array<[number, number]> {
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

function postWorkerMessage<T>(message: T): void {
  (self as any).postMessage(message);
}

export {};
