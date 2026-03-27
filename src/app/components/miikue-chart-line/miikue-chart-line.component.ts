import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  OnInit,
  Renderer2,
  SecurityContext,
  TemplateRef,
  ViewChild
} from '@angular/core';
import * as echarts from 'echarts/core';
import { EChartsOption, SeriesOption } from 'echarts';
import { WidgetContext } from '@home/models/widget-component.models';
import { BarChart, CustomChart, LineChart, PieChart, RadarChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  MarkLineComponent,
  PolarComponent,
  RadarComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent
} from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';
import { LegendConfig, LegendData, LegendKey, ValueFormatProcessor, WidgetTimewindow } from '@shared/public-api';
import { CallbackDataParams, XAXisOption, YAXisOption } from 'echarts/types/dist/shared';
import { WidgetComponent } from '@home/components/widget/widget.component';
import { DomSanitizer } from '@angular/platform-browser';
import { isDefinedAndNotNull } from '@core/public-api';
import { calculateAxisSize, measureAxisNameSize } from '@home/components/public-api';
import { ECharts } from '@home/components/widget/lib/chart/echarts-widget.models';

type DataDisplayMode = 'seconds' | 'min' | 'hour';

@Component({
  selector: 'tb-miikue-chart-line',
  templateUrl: './miikue-chart-line.component.html',
  styleUrls: ['./miikue-chart-line.component.scss'],
  standalone: false
})
export class MiikueChartLineComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('echartContainer', {static: false}) echartContainer: ElementRef<HTMLElement>;

  @Input() ctx: WidgetContext;

  @Input() showSmallGraph: boolean = true;
  @Input() fullscreen: boolean = false;
  @Input() maxConnectedGapSeconds: number = 0;
  @Input() widgetTitlePanel: TemplateRef<any>;

  private myChart: ECharts;
  private shapeResize$: ResizeObserver;
  private xAxis: XAXisOption;
  private yAxis: YAXisOption;
  private option: EChartsOption;
  private latestSeriesData: any[][] = [];
  private hiddenSeriesIndexes = new Set<number>();
  private aggregationSubscription: any = null;
  private aggregationEntries: Array<any> = [];

  private valueFormatter: ValueFormatProcessor;

  public legendConfig: LegendConfig;
  public legendClass: string;
  public legendData: LegendData;
  public legendKeys: Array<LegendKey>;
  public showLegend: boolean;
  public selectedDataDisplayMode: DataDisplayMode = 'seconds';
  public readonly dataDisplayModes: Array<{ value: DataDisplayMode; label: string }> = [
    { value: 'seconds', label: 'Sekundy' },
    { value: 'min', label: 'Min agr' },
    { value: 'hour', label: 'Hour agr' }
  ];

  constructor(
    private renderer: Renderer2,
    private sanitizer: DomSanitizer,
    public widgetComponent: WidgetComponent,
  ) {}

  //Core logic
  ngOnInit(): void {
    this.ctx.$scope.miikueChartLineWidget = this;
    this.selectedDataDisplayMode = this.resolveInitialDataDisplayMode();
    this.prepareValueFormat();
    this.initEchart();
    this.initLegend();
    this.applyDataDisplayModeSubscription();
  }

  ngOnDestroy(): void {
    this.destroyAggregationSubscription();
    this.shapeResize$?.disconnect();
  }

  public onDataDisplayModeChange(mode: DataDisplayMode): void {
    if (this.selectedDataDisplayMode === mode) {
      return;
    }

    this.selectedDataDisplayMode = mode;
    this.hiddenSeriesIndexes.clear();
    this.latestSeriesData = [];
    this.applyDataDisplayModeSubscription();

    if (this.myChart && this.selectedDataDisplayMode === 'seconds') {
      this.onDataUpdated();
    }
  }

  ngAfterViewInit(): void {
    this.initChart();
  }

  private initChart(): void {
    this.myChart = echarts.init(this.echartContainer.nativeElement, null, {
      renderer: 'canvas'
    });
    this.initResize();

    this.xAxis = this.setupXAxis();
    this.yAxis = this.setupYAxis();
    this.option = {
      ...this.setupAnimationSettings(),
      formatter: (params: CallbackDataParams[]) => this.setupTooltipElement(params),
      backgroundColor: "transparent",
      darkMode: false,
      toolbox: this.setupToolbox(),
      tooltip: {
        show: true,
        trigger: 'axis',
        confine: true,
        padding: [8, 12],
        appendTo: 'body',
        textStyle: {
          fontFamily: 'Roboto',
          fontSize: 12,
          fontWeight: 'normal',
          lineHeight: 16
        }
      },
      grid: [{
        backgroundColor: null,
        borderColor: "#ccc",
        borderWidth: 1,
        bottom: 45,
        left: 5,
        right: 5,
        show: false,
        top: 10
      }],
      xAxis: [this.xAxis],
      yAxis: [this.yAxis],
      series: this.setupChartLines(),
      dataZoom: [
        {
          type: 'inside',
          disabled: false,
          realtime: true,
          filterMode: 'none'
        },
        {
          type: 'slider',
          show: false,
          showDetail: false,
          realtime: true,
          filterMode: 'none',
          bottom: 5
        }
      ]
    }

    this.myChart.setOption(this.option);
    this.updateAxisOffset(false);
  }

  public onDataUpdated() {
    if (!this.myChart) {
      return;
    }
    const activeTimeWindow = this.getActiveTimeWindow();
    const seriesEntries = this.getSeriesEntries();
    const newData = [];
    const maxGapMs = this.resolveMaxGapMs();
    this.onResize();
    if (activeTimeWindow) {
      this.updateXAxisTimeWindow(this.xAxis, activeTimeWindow);
    }

    for (const key in seriesEntries) {
      newData[key] = [];
      const sourceData = seriesEntries[key].data || [];
      const sortedData = this.isSortedByTimestamp(sourceData) ? sourceData : [...sourceData].sort((a, b) => a[0] - b[0]);
      let lastTs: number = null;

      for (const [ts, value] of sortedData) {
        if (maxGapMs > 0 && isDefinedAndNotNull(lastTs) && ts - lastTs > maxGapMs) {
          newData[key].push({
            name: ts,
            value: [ts - 1, null]
          });
        }

        newData[key].push({
          name: ts,
          value: [
            ts,
            this.valueFormatter.format(value)
          ]
        });

        lastTs = ts;
      }
    }

    this.latestSeriesData = newData;

    this.option.series = this.buildVisibleSeries();

    this.myChart.setOption({
      xAxis: this.xAxis,
      series: this.option.series
    });
    this.updateAxisOffset();
  }

  public toggleLegendSeries(legendKey: LegendKey): void {
    const index = legendKey.dataIndex;
    if (this.hiddenSeriesIndexes.has(index)) {
      this.hiddenSeriesIndexes.delete(index);
    } else {
      this.hiddenSeriesIndexes.add(index);
    }

    if (!this.myChart) {
      return;
    }

    this.option.series = this.buildVisibleSeries();
    this.myChart.setOption({series: this.option.series});
    this.ctx.detectChanges();
  }

  public isLegendSeriesHidden(legendKey: LegendKey): boolean {
    return this.hiddenSeriesIndexes.has(legendKey.dataIndex);
  }

  private buildVisibleSeries(): SeriesOption[] {
    const baseSeries = this.setupChartLines();
    return baseSeries.map((series, index) => ({
      ...series,
      data: this.hiddenSeriesIndexes.has(index) ? [] : (this.latestSeriesData[index] || [])
    }));
  }

  //Support logic
  private updateAxisOffset(lazy = true): void {
    const leftOffset = calculateAxisSize(this.myChart, this.yAxis.mainType,  this.yAxis.id as string);
    const leftNameSize = measureAxisNameSize(this.myChart, this.yAxis.mainType, this.yAxis.id as string, this.yAxis.name);
    const bottomOffset = calculateAxisSize(this.myChart, this.xAxis.mainType,  this.xAxis.id as string);
    const bottomNameSize = measureAxisNameSize(this.myChart, this.yAxis.mainType, this.yAxis.id as string, this.yAxis.name);
    const newGridLeft = leftOffset + leftNameSize;
    const newGridBottom = bottomOffset + bottomNameSize + 35;
    if (this.option.grid[0].left !== newGridLeft || this.option.grid[0].bottom !== newGridBottom) {
      this.option.grid[0].left = newGridLeft;
      this.yAxis.nameGap = leftOffset;
      this.option.grid[0].bottom = newGridBottom;
      this.xAxis.nameGap = bottomOffset;
      this.myChart.setOption(this.option, {replaceMerge: ['yAxis', 'xAxis', 'grid'], lazyUpdate: lazy});
    }
  }

  private updateXAxisTimeWindow = (option: XAXisOption,
                                   timeWindow: WidgetTimewindow) => {
    option.min = timeWindow.minTime;
    option.max = timeWindow.maxTime;
  };

  private getActiveTimeWindow(): WidgetTimewindow | undefined {
    return this.ctx?.defaultSubscription?.timeWindow || this.ctx?.timeWindow;
  }

  private getSeriesEntries(): Array<any> {
    if (this.selectedDataDisplayMode !== 'seconds') {
      return this.aggregationEntries;
    }
    return Object.values(this.ctx?.data || {}) as any[];
  }

  private applyDataDisplayModeSubscription(): void {
    if (this.selectedDataDisplayMode === 'seconds') {
      this.destroyAggregationSubscription();
      this.aggregationEntries = [];
      return;
    }

    this.ensureAggregationSubscription();
  }

  private ensureAggregationSubscription(): void {
    const suffix = this.resolveAggregationSuffix(this.selectedDataDisplayMode);
    const baseDatasources = this.ctx?.defaultSubscription?.datasources;
    if (!Array.isArray(baseDatasources) || !baseDatasources.length || !this.ctx?.subscriptionApi) {
      this.aggregationEntries = [];
      return;
    }

    this.destroyAggregationSubscription();

    const datasources = baseDatasources.map((datasource: any) => ({
      ...datasource,
      dataKeys: (datasource?.dataKeys || []).map((dataKey: any) => {
        const baseName = this.stripAggregationSuffix(dataKey?.name);
        return {
          ...dataKey,
          name: `${baseName}${suffix}`,
          label: dataKey?.label || baseName
        };
      })
    }));

    const originalSnapshot = this.buildDatasourceSnapshot(baseDatasources);
    const newSnapshot = this.buildDatasourceSnapshot(datasources);
    const baseSubscriptionOptions = this.ctx?.defaultSubscription?.options || {};
    const customTimeWindowConfig = this.resolveCustomTimeWindowConfig(baseSubscriptionOptions);
    console.log('[miikue-chart-line] Subscription switch snapshots', {
      mode: this.selectedDataDisplayMode,
      suffix,
      originalSubscriptionDatasources: originalSnapshot,
      newSubscriptionDatasources: newSnapshot,
      defaultSubscriptionTimeWindow: this.ctx?.defaultSubscription?.timeWindow,
      customTimeWindowConfig
    });

    const options: any = {
      ...baseSubscriptionOptions,
      type: this.resolveSubscriptionType(),
      datasources,
      useDashboardTimewindow: false,
      displayTimewindow: true,
      callbacks: {
        onDataUpdated: () => this.onAggregationSubscriptionDataUpdated(),
        onDataUpdateError: (_subscription: any, e: any) => {
          console.error('[miikue-chart-line] Custom subscription data update error', {
            mode: this.selectedDataDisplayMode,
            error: e,
            selectedSuffix: suffix,
            timeWindowConfig: options.timeWindowConfig
          });
        },
        onSubscriptionMessage: (_subscription: any, message: any) => {
          console.log('[miikue-chart-line] Custom subscription message', {
            mode: this.selectedDataDisplayMode,
            message
          });
        },
        timeWindowUpdated: (_subscription: any, timeWindowConfig: any) => {
          console.log('[miikue-chart-line] Custom subscription timewindow updated', {
            mode: this.selectedDataDisplayMode,
            timeWindowConfig
          });
        }
      }
    };

    if (customTimeWindowConfig) {
      options.timeWindowConfig = customTimeWindowConfig;
    }

    console.log('[miikue-chart-line] New custom subscription options', {
      type: options.type,
      useDashboardTimewindow: options.useDashboardTimewindow,
      displayTimewindow: options.displayTimewindow,
      timeWindowConfig: options.timeWindowConfig,
      selectedSuffix: suffix,
      datasources: newSnapshot
    });

    this.ctx.subscriptionApi.createSubscription(options, true).subscribe((subscription: any) => {
      this.aggregationSubscription = subscription;

      const activeTimeWindow = this.getActiveTimeWindow();
      if (activeTimeWindow?.minTime && activeTimeWindow?.maxTime && subscription?.onUpdateTimewindow) {
        const interval = activeTimeWindow.interval;
        console.log('[miikue-chart-line] Forcing custom subscription timewindow refresh', {
          mode: this.selectedDataDisplayMode,
          startTimeMs: activeTimeWindow.minTime,
          endTimeMs: activeTimeWindow.maxTime,
          interval
        });
        subscription.onUpdateTimewindow(activeTimeWindow.minTime, activeTimeWindow.maxTime, interval);
      }

      this.onAggregationSubscriptionDataUpdated();
    });
  }

  private onAggregationSubscriptionDataUpdated(): void {
    const baseEntries = Object.values(this.ctx?.data || {}) as any[];
    const incoming = this.normalizeSubscriptionData(this.aggregationSubscription?.data);
    const incomingSnapshot = incoming.map((entry: any, index: number) => ({
      index,
      keyName: entry?.dataKey?.name,
      keyLabel: entry?.dataKey?.label,
      points: Array.isArray(entry?.data) ? entry.data.length : 0,
      firstPointTs: Array.isArray(entry?.data) && entry.data.length ? entry.data[0]?.[0] : null,
      lastPointTs: Array.isArray(entry?.data) && entry.data.length ? entry.data[entry.data.length - 1]?.[0] : null
    }));

    console.log('[miikue-chart-line] Incoming custom subscription update', {
      mode: this.selectedDataDisplayMode,
      seriesCount: incoming.length,
      snapshot: incomingSnapshot,
      rawData: incoming
    });

    if (this.selectedDataDisplayMode === 'hour') {
      const totalPoints = incomingSnapshot.reduce((sum, item) => sum + (Number(item.points) || 0), 0);
      if (totalPoints === 0) {
        console.warn('[miikue-chart-line] Hour mode returned zero points. Likely suffix mismatch for hourly keys.', {
          expectedSuffix: this.resolveAggregationSuffix('hour'),
          expectedKeyNames: this.buildExpectedAggregatedKeyNames('hour'),
          tip: 'If your telemetry uses different hourly suffix, set ctx.settings.hourAggregationSuffix (e.g. _60min).'
        });
      }
    }

    this.aggregationEntries = incoming.map((entry, index) => {
      const baseDataKey = baseEntries[index]?.dataKey || {};
      const entryDataKey = entry?.dataKey || {};
      const baseName = this.stripAggregationSuffix(baseDataKey?.name || entryDataKey?.name);
      return {
        ...entry,
        data: Array.isArray(entry?.data) ? entry.data : [],
        dataKey: {
          ...entryDataKey,
          label: baseDataKey?.label || entryDataKey?.label || baseName,
          name: baseName,
          color: baseDataKey?.color || entryDataKey?.color,
          decimals: isDefinedAndNotNull(baseDataKey?.decimals) ? baseDataKey.decimals : entryDataKey?.decimals,
          units: isDefinedAndNotNull(baseDataKey?.units) ? baseDataKey.units : entryDataKey?.units
        }
      };
    });

    if (this.myChart) {
      this.onDataUpdated();
    }
  }

  private normalizeSubscriptionData(data: any): Array<any> {
    if (Array.isArray(data)) {
      return data;
    }
    if (data && typeof data === 'object') {
      return Object.values(data) as Array<any>;
    }
    return [];
  }

  private destroyAggregationSubscription(): void {
    if (this.aggregationSubscription?.unsubscribe) {
      this.aggregationSubscription.unsubscribe();
    }
    if (this.aggregationSubscription?.destroy) {
      this.aggregationSubscription.destroy();
    }
    this.aggregationSubscription = null;
  }

  private resolveSubscriptionType(): any {
    return this.ctx?.defaultSubscription?.type || this.ctx?.defaultSubscription?.subscriptionType || 'timeseries';
  }

  private stripAggregationSuffix(value: string): string {
    const text = String(value || '');
    return text.replace(/_(min|hour)$/i, '');
  }

  private resolveAggregationSuffix(mode: DataDisplayMode): string {
    const minSuffix = this.normalizeSuffix(this.ctx?.settings?.minAggregationSuffix, '_min');
    const hourSuffix = this.normalizeSuffix(this.ctx?.settings?.hourAggregationSuffix, '_hour');
    return mode === 'min' ? minSuffix : hourSuffix;
  }

  private normalizeSuffix(value: any, fallback: string): string {
    const raw = String(value || '').trim();
    if (!raw) {
      return fallback;
    }
    return raw.startsWith('_') ? raw : `_${raw}`;
  }

  private buildExpectedAggregatedKeyNames(mode: DataDisplayMode): string[] {
    const suffix = this.resolveAggregationSuffix(mode);
    const baseEntries = Object.values(this.ctx?.data || {}) as any[];
    return baseEntries
      .map((entry: any) => this.stripAggregationSuffix(entry?.dataKey?.name || ''))
      .filter((name: string) => !!name)
      .map((name: string) => `${name}${suffix}`);
  }

  private buildDatasourceSnapshot(datasources: Array<any>): Array<any> {
    return (datasources || []).map((datasource: any, index: number) => ({
      index,
      type: datasource?.type,
      name: datasource?.name,
      entityType: datasource?.entityType,
      entityAliasId: datasource?.entityAliasId,
      dataKeys: (datasource?.dataKeys || []).map((dataKey: any) => ({
        name: dataKey?.name,
        label: dataKey?.label,
        type: dataKey?.type,
        color: dataKey?.color,
        units: dataKey?.units,
        decimals: dataKey?.decimals
      }))
    }));
  }

  private resolveCustomTimeWindowConfig(baseSubscriptionOptions: any): any {
    const fromBaseOptions = this.cloneObject(baseSubscriptionOptions?.timeWindowConfig);
    const fromDefaultSubscription = this.cloneObject(this.ctx?.defaultSubscription?.timeWindowConfig);
    const sourceConfig = fromBaseOptions || fromDefaultSubscription;
    const activeTimeWindow = this.getActiveTimeWindow();

    if (sourceConfig) {
      const normalized = this.normalizeTimeWindowConfig(sourceConfig, activeTimeWindow);
      this.ensureAggregationLimit(normalized, activeTimeWindow);
      return normalized;
    }

    if (activeTimeWindow?.minTime && activeTimeWindow?.maxTime) {
      const fallbackConfig = {
        history: {
          fixedTimewindow: {
            startTimeMs: activeTimeWindow.minTime,
            endTimeMs: activeTimeWindow.maxTime
          }
        }
      } as any;
      this.ensureAggregationLimit(fallbackConfig, activeTimeWindow);
      return {
        ...fallbackConfig
      };
    }

    return undefined;
  }

  private normalizeTimeWindowConfig(sourceConfig: any, activeTimeWindow?: WidgetTimewindow): any {
    const config = this.cloneObject(sourceConfig) || {};
    const fixedWindow = config?.fixedWindow;
    if (!config.history || typeof config.history !== 'object') {
      config.history = {};
    }

    if (fixedWindow?.startTimeMs && fixedWindow?.endTimeMs && !config.history.fixedTimewindow) {
      config.history.fixedTimewindow = {
        startTimeMs: fixedWindow.startTimeMs,
        endTimeMs: fixedWindow.endTimeMs
      };
    }

    if (activeTimeWindow?.minTime && activeTimeWindow?.maxTime) {
      config.history.fixedTimewindow = {
        startTimeMs: activeTimeWindow.minTime,
        endTimeMs: activeTimeWindow.maxTime
      };
    }

    return config;
  }

  private ensureAggregationLimit(timeWindowConfig: any, activeTimeWindow?: WidgetTimewindow): void {
    if (!timeWindowConfig || !activeTimeWindow?.minTime || !activeTimeWindow?.maxTime) {
      return;
    }

    if (this.selectedDataDisplayMode === 'hour') {
      // For hourly pre-aggregated keys, keep backend/widget aggregation untouched.
      return;
    }

    const bucketMs = 60 * 1000;
    const durationMs = Math.max(0, activeTimeWindow.maxTime - activeTimeWindow.minTime);
    const recommendedLimit = Math.min(50000, Math.max(1000, Math.ceil(durationMs / bucketMs) + 10));
    const currentLimit = Number(timeWindowConfig?.aggregation?.limit);
    const finalLimit = Number.isFinite(currentLimit) ? Math.max(currentLimit, recommendedLimit) : recommendedLimit;

    timeWindowConfig.aggregation = {
      ...(timeWindowConfig.aggregation || {}),
      type: timeWindowConfig?.aggregation?.type || 'NONE',
      limit: finalLimit
    };
  }

  private cloneObject<T>(value: T): T {
    if (!value || typeof value !== 'object') {
      return value;
    }
    try {
      return JSON.parse(JSON.stringify(value)) as T;
    } catch {
      return value;
    }
  }

  private resolveMaxGapMs(): number {
    const settingsGapSeconds = Number(this.ctx?.settings?.maxConnectedGapSeconds);
    if (Number.isFinite(settingsGapSeconds) && settingsGapSeconds > 0) {
      return settingsGapSeconds * 1000;
    }
    return this.maxConnectedGapSeconds > 0 ? this.maxConnectedGapSeconds * 1000 : 0;
  }

  private resolveInitialDataDisplayMode(): DataDisplayMode {
    const rawMode = String(this.ctx?.settings?.dataDisplayMode || '').toLowerCase();
    if (rawMode === 'seconds' || rawMode === 'min' || rawMode === 'hour') {
      return rawMode;
    }
    return 'seconds';
  }

  private isSortedByTimestamp(points: Array<any>): boolean {
    if (!points || points.length < 2) {
      return true;
    }
    for (let i = 1; i < points.length; i++) {
      const prev = Number(points[i - 1]?.[0]);
      const curr = Number(points[i]?.[0]);
      if (Number.isFinite(prev) && Number.isFinite(curr) && prev > curr) {
        return false;
      }
    }
    return true;
  }

  private setupToolbox(): EChartsOption['toolbox'] {
    if (this.ctx?.settings?.showToolbox === false) {
      return { show: false };
    }

    return {
      show: true,
      right: 8,
      top: 8,
      itemSize: 16,
      feature: {
        dataZoom: {
          yAxisIndex: 'none'
        },
        saveAsImage: {
          pixelRatio: 2,
          backgroundColor: '#ffffff',
          name: 'miikue-chart-line'
        }
      }
    };
  }

  private initEchart(): void {
    echarts.use([
      TooltipComponent,
      GridComponent,
      VisualMapComponent,
      DataZoomComponent,
      ToolboxComponent,
      MarkLineComponent,
      PolarComponent,
      RadarComponent,
      LineChart,
      BarChart,
      PieChart,
      RadarChart,
      CustomChart,
      LabelLayout,
      CanvasRenderer,
      SVGRenderer
    ]);
  }

  private initLegend(): void {
    this.showLegend = this.ctx.settings.showLegend;
    if (this.showLegend) {
      this.legendConfig = this.ctx.settings.legendConfig;
      this.legendData = this.ctx.defaultSubscription.legendData;
      this.legendKeys = this.legendData.keys;
      this.legendClass = `legend-${this.legendConfig.position}`;
      if (this.legendConfig.sortDataKeys) {
        this.legendKeys = this.legendData.keys.sort((key1, key2) => key1.dataKey.label.localeCompare(key2.dataKey.label));
      } else {
        this.legendKeys = this.legendData.keys;
      }
    }
  }

  private initResize(): void {
    this.shapeResize$ = new ResizeObserver(() => {
      this.onResize();
    });
    this.shapeResize$.observe(this.echartContainer.nativeElement);
  }

  private onResize() {
    if (this.myChart) {
      this.myChart.resize();
    }
  }

  private prepareValueFormat() {
    const units = this.ctx.units;
    this.valueFormatter = ValueFormatProcessor.fromSettings(this.ctx.$injector, {units, decimals: this.ctx.decimals});
  }

  private setupTooltipElement(params: CallbackDataParams[]): HTMLElement {
    const tooltipElement: HTMLElement = this.renderer.createElement('div');
    this.renderer.setStyle(tooltipElement, 'display', 'flex');
    this.renderer.setStyle(tooltipElement, 'flex-direction', 'column');
    this.renderer.setStyle(tooltipElement, 'align-items', 'flex-start');
    this.renderer.setStyle(tooltipElement, 'gap', '16px');

    if (params.length) {
      const tooltipItemsElement: HTMLElement = this.renderer.createElement('div');
      this.renderer.setStyle(tooltipItemsElement, 'display', 'flex');
      this.renderer.setStyle(tooltipItemsElement, 'flex-direction', 'column');
      this.renderer.setStyle(tooltipItemsElement, 'align-items', 'flex-start');
      this.renderer.setStyle(tooltipItemsElement, 'gap', '4px');

      this.renderer.appendChild(tooltipItemsElement, this.setTooltipDate(params));

      for (const [i, param] of params.entries()) {
        this.renderer.appendChild(tooltipItemsElement, this.constructTooltipSeriesElement(param, i));
      }

      this.renderer.appendChild(tooltipElement, tooltipItemsElement);
    }
    return tooltipElement;
  }

  private constructTooltipSeriesElement(param: CallbackDataParams, index: number): HTMLElement {
    const seriesEntries = this.getSeriesEntries();
    const seriesEntry = seriesEntries[index];

    const labelValueElement: HTMLElement = this.renderer.createElement('div');
    this.renderer.setStyle(labelValueElement, 'display', 'flex');
    this.renderer.setStyle(labelValueElement, 'flex-direction', 'row');
    this.renderer.setStyle(labelValueElement, 'align-items', 'center');
    this.renderer.setStyle(labelValueElement, 'align-self', 'stretch');
    this.renderer.setStyle(labelValueElement, 'gap', '12px');

    const labelElement: HTMLElement = this.renderer.createElement('div');
    this.renderer.setStyle(labelElement, 'display', 'flex');
    this.renderer.setStyle(labelElement, 'align-items', 'center');
    this.renderer.setStyle(labelElement, 'gap', '8px');
    this.renderer.appendChild(labelValueElement, labelElement);

    const circleElement: HTMLElement = this.renderer.createElement('div');
    this.renderer.setStyle(circleElement, 'width', '8px');
    this.renderer.setStyle(circleElement, 'height', '8px');
    this.renderer.setStyle(circleElement, 'border-radius', '50%');
    this.renderer.setStyle(circleElement, 'background', param.color);
    this.renderer.appendChild(labelElement, circleElement);

    const labelTextElement: HTMLElement = this.renderer.createElement('div');
    this.renderer.setProperty(labelTextElement, 'innerHTML', this.sanitizer.sanitize(SecurityContext.HTML, param.seriesName));
    this.renderer.setStyle(labelTextElement, 'font-family', 'Roboto');
    this.renderer.setStyle(labelTextElement, 'font-size', '12px');
    this.renderer.setStyle(labelTextElement, 'font-style', 'normal');
    this.renderer.setStyle(labelTextElement, 'font-weight', 400);
    this.renderer.setStyle(labelTextElement, 'line-height', '16px');
    this.renderer.setStyle(labelTextElement, 'color', 'rgba(0, 0, 0, 0.76)');
    this.renderer.appendChild(labelElement, labelTextElement);

    const decimals = isDefinedAndNotNull(seriesEntry?.dataKey?.decimals) ?
      seriesEntry.dataKey.decimals : this.ctx.decimals;
    const units = isDefinedAndNotNull(seriesEntry?.dataKey?.units) ?
      seriesEntry.dataKey.units : this.ctx.units;
    const valueFormatter = ValueFormatProcessor.fromSettings(this.ctx.$injector, {units, decimals});
    const value = valueFormatter.format(param.value[1]);

    const valueElement: HTMLElement = this.renderer.createElement('div');
    this.renderer.setProperty(valueElement, 'innerHTML', this.sanitizer.sanitize(SecurityContext.HTML, value));
    this.renderer.setStyle(valueElement, 'flex', '1');
    this.renderer.setStyle(valueElement, 'text-align', 'end');
    this.renderer.setStyle(valueElement, 'font-family', 'Roboto');
    this.renderer.setStyle(valueElement, 'font-size', '12px');
    this.renderer.setStyle(valueElement, 'font-style', 'normal');
    this.renderer.setStyle(valueElement, 'font-weight', 500);
    this.renderer.setStyle(valueElement, 'line-height', '16px');
    this.renderer.setStyle(valueElement, 'color', 'rgba(0, 0, 0, 0.76)');
    this.renderer.appendChild(labelValueElement, valueElement);
    return labelValueElement;
  }

  private setTooltipDate(params: CallbackDataParams[]): HTMLElement {
    const dateElement: HTMLElement = this.renderer.createElement('div');
    this.renderer.appendChild(dateElement, this.renderer.createText(new Date(params[0].value[0]).toLocaleString('en-GB')));
    this.renderer.setStyle(dateElement, 'font-family', 'Roboto');
    this.renderer.setStyle(dateElement, 'font-size', '11px');
    this.renderer.setStyle(dateElement, 'font-style', 'normal');
    this.renderer.setStyle(dateElement, 'font-weight', '400');
    this.renderer.setStyle(dateElement, 'line-height', '16px');
    this.renderer.setStyle(dateElement, 'color', 'rgba(0, 0, 0, 0.76)');
    return dateElement;
  }
  
  private setupAnimationSettings(): object {
      return  {
        animation: true,
        animationDelay: 0,
        animationDelayUpdate: 0,
        animationDuration: 500,
        animationDurationUpdate: 300,
        animationEasing: "cubicOut",
        animationEasingUpdate: "cubicOut",
        animationThreshold: 2000
      }
  }

  private setupChartLines(): SeriesOption[] {
    const series: SeriesOption[] = [];
    const baseEntries = this.getSeriesEntries();
    for (const [index, entry] of baseEntries.entries()) {
      const dataKey = entry?.dataKey;
      if (!dataKey) {
        continue;
      }

      const seriesName = dataKey.label || dataKey.name;
      series.push({
        id: index,
        name: seriesName,
        type: 'line',
        connectNulls: false,
        showSymbol: false,
        smooth: false,
        step: false,
        stackStrategy: 'all',
        data: [],
        lineStyle: {
          color: dataKey.color
        },
        itemStyle: {
          color: dataKey.color
        }
      })
    }
    return series;
  }

  private setupYAxis(): YAXisOption {
    return {
      type: 'value',
      position: 'left',
      mainType: 'yAxis',
      id: 'yAxis',
      offset: 0,
      name: '',
      nameLocation: 'middle',
      nameRotate: 90,
      alignTicks: true,
      scale: true,
      show: true,
      axisLabel: {
        color: 'rgba(0, 0, 0, 0.54)',
        fontFamily: 'Roboto',
        fontSize: 12,
        fontStyle: 'normal',
        fontWeight: 400,
        show: true,
        formatter: (value: any) => {
          return this.valueFormatter.format(value);
        }
      },
      splitLine: {
        show: true,
      },
      axisLine: {
        show: true,
        lineStyle: {
          color: 'rgba(0, 0, 0, 0.54)'
        }
      },
      axisTick: {
        lineStyle: {
          color: 'rgba(0, 0, 0, 0.54)'
        },
        show: true
      },
      nameTextStyle: {
        color: 'rgba(0, 0, 0, 0.54)',
        fontFamily: 'Roboto',
        fontSize: 12,
        fontStyle: 'normal',
        fontWeight: 600
      }
    }
  }

  private setupXAxis(): XAXisOption {
    const activeTimeWindow = this.getActiveTimeWindow();
    const now = Date.now();
    return {
      id: 'xAxis',
      mainType: 'xAxis',
      show: true,
      type: 'time',
      position: "bottom",
      name: '',
      offset: 0,
      nameLocation: 'middle',
      max: activeTimeWindow?.maxTime ?? now,
      min: activeTimeWindow?.minTime ?? (now - 24 * 60 * 60 * 1000),
      nameTextStyle: {
        color: 'rgba(0, 0, 0, 0.54)',
        fontStyle: 'normal',
        fontWeight: 600,
        fontFamily: 'Roboto',
        fontSize: 12,
      },
      axisPointer: {
        shadowStyle: {
          color: 'rgba(210,219,238,0.2)'
        }
      },
      splitLine: {
        show: true
      },
      axisTick: {
        show: true,
        lineStyle: {
          color: 'rgba(0, 0, 0, 0.54)'
        }
      },
      axisLine: {
        onZero: false,
        show: true,
        lineStyle: {
          color: 'rgba(0, 0, 0, 0.54)'
        }
      },
      axisLabel: {
        color: 'rgba(0, 0, 0, 0.54)',
        fontFamily: 'Roboto',
        fontSize: 10,
        fontStyle: 'normal',
        fontWeight: 400,
        show: true,
        hideOverlap: true,
      }
    }
  }
}
