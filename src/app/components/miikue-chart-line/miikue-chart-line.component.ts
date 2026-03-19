import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnInit,
  Renderer2,
  SecurityContext,
  TemplateRef,
  ViewChild
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
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
import { TimeWindow } from '../miikue-time-window-selector/miikue-time-window-selector.component';

@Component({
  selector: 'tb-miikue-chart-line',
  templateUrl: './miikue-chart-line.component.html',
  styleUrls: ['./miikue-chart-line.component.scss'],
  standalone: false
})
export class MiikueChartLineComponent implements OnInit, AfterViewInit {

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
  private historyLoadInProgress = false;
  private historyWindowSignature = '';
  private lastHistoryRequestTs = 0;

  private valueFormatter: ValueFormatProcessor;

  public legendConfig: LegendConfig;
  public legendClass: string;
  public legendData: LegendData;
  public legendKeys: Array<LegendKey>;
  public showLegend: boolean;
  public currentTimeWindow: TimeWindow;

  constructor(
    private renderer: Renderer2,
    private sanitizer: DomSanitizer,
    private http: HttpClient,
    public widgetComponent: WidgetComponent,
  ) {}

  //Core logic
  ngOnInit(): void {
    this.ctx.$scope.miikueChartLineWidget = this;
    this.syncCurrentTimeWindowFromSubscription();
    this.prepareValueFormat();
    this.initEchart();
    this.initLegend();
  }

  public onTimeWindowChange(newTimeWindow: TimeWindow): void {
    if (!newTimeWindow?.startTs || !newTimeWindow?.endTs) {
      return;
    }

    this.currentTimeWindow = newTimeWindow;
    this.ctx?.timewindowFunctions?.onUpdateTimewindow(newTimeWindow.startTs, newTimeWindow.endTs);
  }

  public resetTimeWindow(): void {
    this.ctx?.timewindowFunctions?.onResetTimewindow();
    this.syncCurrentTimeWindowFromSubscription();
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
    this.syncCurrentTimeWindowFromSubscription();
    const activeTimeWindow = this.getActiveTimeWindow();
    const newData = [];
    const maxGapMs = this.resolveMaxGapMs();
    this.onResize();
    if (activeTimeWindow) {
      this.updateXAxisTimeWindow(this.xAxis, activeTimeWindow);
    }

    for (const key in this.ctx.data) {
      newData[key] = [];
      const sourceData = this.ctx.data[key].data || [];
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
    this.loadOlderHistoryIfNeeded();
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

  public hasLegendStats(): boolean {
    return !!(
      this.legendConfig?.showMin ||
      this.legendConfig?.showMax ||
      this.legendConfig?.showAvg ||
      this.legendConfig?.showTotal ||
      this.legendConfig?.showLatest
    );
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

  private syncCurrentTimeWindowFromSubscription(): void {
    const activeTimeWindow = this.getActiveTimeWindow();
    if (!activeTimeWindow) {
      return;
    }
    this.currentTimeWindow = {
      startTs: activeTimeWindow.minTime,
      endTs: activeTimeWindow.maxTime
    };
  }

  private resolveMaxGapMs(): number {
    const settingsGapSeconds = Number(this.ctx?.settings?.maxConnectedGapSeconds);
    if (Number.isFinite(settingsGapSeconds) && settingsGapSeconds > 0) {
      return settingsGapSeconds * 1000;
    }
    return this.maxConnectedGapSeconds > 0 ? this.maxConnectedGapSeconds * 1000 : 0;
  }

  private loadOlderHistoryIfNeeded(): void {
    if (!this.isHistoryBackfillEnabled()) {
      return;
    }

    const now = Date.now();
    const cooldownMs = this.resolveHistoryBackfillCooldownMs();
    if (this.lastHistoryRequestTs && now - this.lastHistoryRequestTs < cooldownMs) {
      return;
    }

    const window = this.ctx?.defaultSubscription?.timeWindow;
    if (!window || !this.ctx?.data) {
      return;
    }

    const datasources = this.ctx?.defaultSubscription?.datasources || this.ctx?.datasources;
    const firstDatasource = datasources?.[0];
    const entityType = firstDatasource?.entityType;
    const entityId = firstDatasource?.entityId;
    if (!entityType || !entityId) {
      return;
    }

    const dataEntries = Object.values(this.ctx.data || {}) as unknown as Array<{
      data: Array<any>,
      dataKey: { name: string }
    }>;
    if (!dataEntries.length) {
      return;
    }

    const keyNames = dataEntries
      .map(entry => entry?.dataKey?.name)
      .filter(name => !!name);
    if (!keyNames.length) {
      return;
    }

    const earliestTs = this.findEarliestTs(dataEntries);
    if (!isDefinedAndNotNull(earliestTs)) {
      return;
    }

    const signature = `${entityType}|${entityId}|${window.minTime}|${window.maxTime}|${keyNames.join(',')}`;
    if (signature !== this.historyWindowSignature) {
      this.historyWindowSignature = signature;
      this.historyLoadInProgress = false;
    }

    if (earliestTs <= window.minTime || this.historyLoadInProgress) {
      return;
    }

    const batchMs = 7 * 24 * 60 * 60 * 1000;
    const endTs = earliestTs - 1;
    const startTs = Math.max(window.minTime, endTs - batchMs + 1);
    const keysQuery = encodeURIComponent(keyNames.join(','));
    const url = `/api/plugins/telemetry/${entityType}/${entityId}/values/timeseries` +
      `?keys=${keysQuery}` +
      `&startTs=${startTs}` +
      `&endTs=${endTs}` +
      `&limit=50000` +
      `&agg=NONE` +
      `&orderBy=ASC`;

    this.historyLoadInProgress = true;
    this.lastHistoryRequestTs = now;
    this.http.get(url).subscribe({
      next: (response: any) => {
        this.historyLoadInProgress = false;
        this.mergeHistoryResponse(response, window.minTime);
      },
      error: () => {
        this.historyLoadInProgress = false;
      }
    });
  }

  private isHistoryBackfillEnabled(): boolean {
    const enabled = this.ctx?.settings?.enableHistoryBackfill;
    return enabled === true || enabled === 'true';
  }

  private resolveHistoryBackfillCooldownMs(): number {
    const configuredMs = Number(this.ctx?.settings?.historyBackfillCooldownMs);
    if (Number.isFinite(configuredMs) && configuredMs >= 500) {
      return configuredMs;
    }
    return 5000;
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

  private findEarliestTs(dataEntries: Array<{ data: Array<[number, any]> }>): number | null {
    let earliest: number = null;
    for (const entry of dataEntries) {
      if (!entry?.data?.length) {
        continue;
      }
      const tsValues = entry.data
        .map(point => this.normalizePoint(point))
        .filter(point => !!point)
        .map(point => Number(point[0]));
      if (!tsValues.length) {
        continue;
      }
      const firstTs = Math.min(...tsValues);
      if (!Number.isFinite(firstTs)) {
        continue;
      }
      if (!isDefinedAndNotNull(earliest) || firstTs < earliest) {
        earliest = firstTs;
      }
    }
    return earliest;
  }

  private mergeHistoryResponse(response: any, minTime: number): number {
    if (!response || typeof response !== 'object') {
      return 0;
    }

    let mergedPoints = 0;
    for (const key in this.ctx.data) {
      const seriesEntry = this.ctx.data[key];
      const seriesKeyName = seriesEntry?.dataKey?.name;
      if (!seriesKeyName) {
        continue;
      }

      const historyItems = Array.isArray(response[seriesKeyName]) ? response[seriesKeyName] : [];
      if (!historyItems.length) {
        continue;
      }

      const mergedMap = new Map<number, any>();
      for (const point of seriesEntry.data || []) {
        const normalizedPoint = this.normalizePoint(point);
        if (!normalizedPoint) {
          continue;
        }
        const [ts, value] = normalizedPoint;
        const numericTs = Number(ts);
        if (Number.isFinite(numericTs)) {
          mergedMap.set(numericTs, value);
        }
      }

      for (const item of historyItems) {
        const itemTs = Number(item?.ts);
        if (!Number.isFinite(itemTs) || itemTs < minTime) {
          continue;
        }
        if (!mergedMap.has(itemTs)) {
          mergedPoints++;
        }
        mergedMap.set(itemTs, item?.value);
      }

      seriesEntry.data = Array.from(mergedMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([ts, value]) => [ts, value]);
    }

    return mergedPoints;
  }

  private normalizePoint(point: any): [number, any] | null {
    if (!Array.isArray(point) || point.length < 2) {
      return null;
    }
    const ts = Number(point[0]);
    if (!Number.isFinite(ts)) {
      return null;
    }
    return [ts, point[1]];
  }

  private initEchart(): void {
    echarts.use([
      TooltipComponent,
      GridComponent,
      VisualMapComponent,
      DataZoomComponent,
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

    const decimals = isDefinedAndNotNull(this.ctx.data[index].dataKey.decimals) ?
      this.ctx.data[index].dataKey.decimals : this.ctx.decimals;
    const units = isDefinedAndNotNull(this.ctx.data[index].dataKey.units) ?
      this.ctx.data[index].dataKey.units : this.ctx.units;
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
    for (const [index, dataKey] of this.ctx.datasources[0].dataKeys.entries()) {
      series.push({
        id: index,
        name: dataKey.label,
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
