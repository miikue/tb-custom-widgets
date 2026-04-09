/// <reference lib="webworker" />

interface ChartDataPoint {
  ts: number;
  value: number;
  name: string;
  color?: string;
  units?: string;
  decimals?: number;
}

type AggregationMode = 'seconds' | 'min' | 'hour';
type SeriesPoint = [number, number | null];

interface ChartTimeWindow {
  startTs: number;
  endTs: number;
}

interface ChartEngineSettings {
  rawGapBreakSeconds?: number;
  minGapBreakMinutes?: number;
  hourGapBreakHours?: number;
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

  for (const [name, state] of seriesState.entries()) {
    const pointsInRange = filterByRange(state.points, visibleRange.minTs, visibleRange.maxTs);
    const decimated = decimateForWidth(pointsInRange, message.width, message.maxPointsPerPixel);
    const color = state.color || fallbackColors[colorIndex % fallbackColors.length];
    series.push({
      name,
      color,
      data: decimated
    });
    colorIndex++;
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
