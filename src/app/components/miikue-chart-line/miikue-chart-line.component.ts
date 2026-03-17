import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnInit,
  Renderer2,
  SecurityContext,
  TemplateRef,
  ViewChild,
  OnDestroy,
  NgZone
} from '@angular/core';
import * as echarts from 'echarts/core';
import { EChartsOption, SeriesOption } from 'echarts';
import { WidgetContext } from '@home/models/widget-component.models';
import { LineChart, BarChart, PieChart, RadarChart, CustomChart } from 'echarts/charts';
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
import { Subscription, from, of, Subject } from 'rxjs';
import { catchError, concatMap, map, tap, finalize, takeUntil } from 'rxjs/operators';
import { HttpParams } from '@angular/common/http';

@Component({
  selector: 'tb-miikue-chart-line',
  templateUrl: './miikue-chart-line.component.html',
  styleUrls: ['./miikue-chart-line.component.scss']
})
export class MiikueChartLineComponent implements OnInit, AfterViewInit, OnDestroy {

  private readonly fallbackSuffixOrder = ['', '_min', '_30min', '_hour'];

  private _echartContainer: ElementRef<HTMLElement>;
  @ViewChild('echartContainer', {static: false}) set echartContainer(container: ElementRef<HTMLElement>) {
    if (container) {
      this._echartContainer = container;
      this.initChart();
    }
  }

  @Input() ctx: WidgetContext;
  @Input() showSmallGraph: boolean = true;
  @Input() fullscreen: boolean = false;
  @Input() maxSplitTime: number = 0;
  @Input() widgetTitlePanel: TemplateRef<any>;

  private myChart: ECharts;
  private shapeResize$: ResizeObserver;
  private xAxis: XAXisOption;
  private yAxis: YAXisOption;
  private option: EChartsOption;
  private valueFormatter: ValueFormatProcessor;

  public legendConfig: LegendConfig;
  public legendClass: string;
  public legendData: LegendData;
  public legendKeys: Array<LegendKey>;
  public showLegend: boolean;

  // --- Smart Loading State ---
  private destroy$ = new Subject<void>();
  private loadSubscription: Subscription;
  
  // Cache: Ukládáme data a informaci o tom, jaký rozsah máme v paměti
  private store = {
    minLoaded: -1,
    maxLoaded: -1,
    series: {} as { [key: number]: { data: [number, number][] } }
  };

  public get shouldRender(): boolean {
    return this.showSmallGraph || this.fullscreen;
  }

  constructor(
    private renderer: Renderer2,
    private sanitizer: DomSanitizer,
    public widgetComponent: WidgetComponent,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    this.ctx.$scope.miikueChartLineWidget = this;
    this.prepareValueFormat();
    
    // Inicializace prázdného store pro každou sérii
    if (this.ctx.datasources.length > 0) {
      this.ctx.datasources[0].dataKeys.forEach((_, idx) => {
        this.store.series[idx] = { data: [] };
      });
    }

    this.initEchart(); // Registrace modulů
    this.initLegend();
  }

  ngAfterViewInit(): void {
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.loadSubscription) this.loadSubscription.unsubscribe();
    if (this.shapeResize$) this.shapeResize$.disconnect();
    if (this.myChart) {
      this.myChart.dispose();
    }
  }

  public onDataUpdated() {
    if (!this.myChart || !this.shouldRender) return;
    this.checkAndFetchData();
  }

  private initChart(): void {
    if (this.myChart) return;

    // Inicializace ECharts mimo Angular zónu pro výkon
    this.ngZone.runOutsideAngular(() => {
      this.myChart = echarts.init(this._echartContainer.nativeElement, null, { renderer: 'canvas' });
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
        show: true, trigger: 'axis', confine: true, padding: [8, 12], appendTo: 'body',
        textStyle: { fontFamily: 'Roboto', fontSize: 12, fontWeight: 'normal', lineHeight: 16 }
      },
      grid: [{
        backgroundColor: null, borderColor: "#ccc", borderWidth: 1,
        bottom: 45, left: 5, right: 5, show: false, top: 10
      }],
      xAxis: [this.xAxis],
      yAxis: [this.yAxis],
      series: this.setupChartLines(),
      dataZoom: [
        { type: 'inside', disabled: false, realtime: true, filterMode: 'filter' },
        { type: 'slider', show: true, showDetail: false, realtime: true, filterMode: 'filter', bottom: 5 }
      ]
    };

    this.ngZone.runOutsideAngular(() => {
      this.myChart.setOption(this.option);
    });
    
    this.updateAxisOffset(false);
    this.checkAndFetchData();
  }

  // =================================================================================
  // SMART DATA LOADING LOGIC
  // =================================================================================

  private checkAndFetchData() {
    const requestedWindow = this.ctx.defaultSubscription.timeWindow;
    const reqMin = requestedWindow.minTime;
    const reqMax = requestedWindow.maxTime;

    // 1. Aktualizace pohledu osy X (zoom)
    this.updateXAxisView(reqMin, reqMax);

    // 2. Výpočet chybějících dat
    const missingRanges = this.calculateMissingRanges(reqMin, reqMax);

    if (missingRanges.length === 0) {
      return; // Data máme v cache
    }

    // Pokud se rozsahy nepotkávají, vyčistit cache
    const isDisjoint = (reqMax < this.store.minLoaded) || (reqMin > this.store.maxLoaded);
    if (this.store.minLoaded !== -1 && isDisjoint) {
       this.clearStore();
    }

    // 3. Stažení dat
    this.fetchMissingRanges(missingRanges, reqMin, reqMax);
  }

  private calculateMissingRanges(reqMin: number, reqMax: number): {start: number, end: number}[] {
    if (this.store.minLoaded === -1) {
      return [{ start: reqMin, end: reqMax }];
    }
    const ranges = [];
    if (reqMin < this.store.minLoaded) {
      ranges.push({ start: reqMin, end: this.store.minLoaded });
    }
    if (reqMax > this.store.maxLoaded) {
      ranges.push({ start: this.store.maxLoaded, end: reqMax });
    }
    return ranges;
  }

  private fetchMissingRanges(ranges: {start: number, end: number}[], globalMin: number, globalMax: number) {
    if (this.loadSubscription) this.loadSubscription.unsubscribe();

    const requestStream = from(ranges).pipe(
      concatMap(range => {
        // Chunk size 120 minut
        const CHUNK_SIZE = 120 * 60 * 1000;
        const chunks = [];
        for (let t = range.start; t < range.end; t += CHUNK_SIZE) {
          chunks.push({
            start: t,
            end: Math.min(t + CHUNK_SIZE, range.end)
          });
        }
        return from(chunks);
      }),
      concatMap(chunk => {
        // Limit 50000 bodů, RAW data
        return this.fetchDataFromApi(chunk.start, chunk.end, 0, 'NONE', 50000).pipe(
           tap(data => {
             this.ngZone.runOutsideAngular(() => {
               this.mergeDataToStore(data, chunk.start, chunk.end);
             });
           })
        );
      }),
      finalize(() => {
        // Aktualizace globálního rozsahu cache
        if (this.store.minLoaded === -1) {
            this.store.minLoaded = globalMin;
            this.store.maxLoaded = globalMax;
        } else {
            this.store.minLoaded = Math.min(this.store.minLoaded, globalMin);
            this.store.maxLoaded = Math.max(this.store.maxLoaded, globalMax);
        }
        this.myChart.hideLoading();
      }),
      takeUntil(this.destroy$)
    );

    this.myChart.showLoading({ maskColor: 'rgba(255,255,255,0.2)' });
    this.loadSubscription = requestStream.subscribe();
  }

  private fetchDataFromApi(startTs: number, endTs: number, interval: number, agg: string, limit: number) {
    const datasource = this.ctx.datasources[0];
    if (!datasource.dataKeys || datasource.dataKeys.length === 0) return of({});

    const fallbackChains = datasource.dataKeys.map(k => this.getFallbackKeyChain(k.name));
    const requestedKeys = Array.from(new Set(fallbackChains.flat()));
    const keysParam = requestedKeys.join(',');

    let params = new HttpParams()
      .set('keys', keysParam)
      .set('startTs', Math.floor(startTs).toString())
      .set('endTs', Math.floor(endTs).toString());

    if (agg === 'NONE') {
      params = params.set('limit', limit.toString());
    } else {
      params = params.set('interval', Math.floor(interval).toString()).set('agg', agg).set('limit', limit.toString());
    }
    
    const url = `/api/plugins/telemetry/${datasource.entityType}/${datasource.entityId}/values/timeseries`;

    return this.ctx.http.get(url, { params }).pipe(
      map((res: any) => {
        const result = {};
        datasource.dataKeys.forEach((_, index) => {
          result[index] = this.composeSeriesFromFallbackKeys(res, fallbackChains[index]);
        });
        return result;
      }),
      catchError(err => {
        console.error('Fetch error:', err);
        return of({});
      })
    );
  }

  private getFallbackKeyChain(originalKey: string): string[] {
    const matchedSuffix = this.fallbackSuffixOrder
      .filter(suffix => suffix.length > 0)
      .find(suffix => originalKey.endsWith(suffix));

    if (matchedSuffix) {
      const baseKey = originalKey.slice(0, originalKey.length - matchedSuffix.length);
      const startIndex = this.fallbackSuffixOrder.indexOf(matchedSuffix);
      return this.fallbackSuffixOrder.slice(startIndex).map(suffix => `${baseKey}${suffix}`);
    }

    return [
      originalKey,
      ...this.fallbackSuffixOrder
        .filter(suffix => suffix.length > 0)
        .map(suffix => `${originalKey}${suffix}`)
    ];
  }

  private composeSeriesFromFallbackKeys(response: any, keyChain: string[]): [number, number][] {
    const merged: [number, number][] = [];
    let oldestTimestamp = Number.POSITIVE_INFINITY;

    for (const keyName of keyChain) {
      const points = this.parseTelemetryPoints(response?.[keyName]);
      if (!points.length) {
        continue;
      }

      if (!merged.length) {
        merged.push(...points);
        oldestTimestamp = points[0][0];
        continue;
      }

      const olderOnly = points.filter(point => point[0] < oldestTimestamp);
      if (olderOnly.length) {
        merged.unshift(...olderOnly);
        oldestTimestamp = olderOnly[0][0];
      }
    }

    return merged;
  }

  private parseTelemetryPoints(series: any): [number, number][] {
    if (!Array.isArray(series) || series.length === 0) {
      return [];
    }

    return series
      .map(point => [Number(point.ts), Number(point.value)] as [number, number])
      .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]))
      .sort((a, b) => a[0] - b[0]);
  }

  private mergeDataToStore(newData: any, chunkStart: number, chunkEnd: number) {
    let hasUpdates = false;
    Object.keys(newData).forEach(key => {
      const idx = Number(key);
      const newPoints = newData[idx];
      if (!newPoints || newPoints.length === 0) return;

      const storeSeries = this.store.series[idx];
      
      // Optimalizace připojování dat
      if (storeSeries.data.length > 0 && newPoints[0][0] >= storeSeries.data[storeSeries.data.length - 1][0]) {
          storeSeries.data.push(...newPoints); // Append
      } else if (storeSeries.data.length > 0 && newPoints[newPoints.length - 1][0] <= storeSeries.data[0][0]) {
          storeSeries.data.unshift(...newPoints); // Prepend
      } else {
         const filtered = storeSeries.data.filter(p => p[0] < chunkStart || p[0] >= chunkEnd);
         storeSeries.data = filtered.concat(newPoints).sort((a, b) => a[0] - b[0]);
      }
      hasUpdates = true;
    });

    if (hasUpdates) {
      requestAnimationFrame(() => {
        this.refreshChartSeries();
      });
    }
  }

  private refreshChartSeries() {
    const newSeries = [];
    const currentOptions = this.option.series as SeriesOption[];
    
    currentOptions.forEach((opt: any) => {
      const idx = opt.id;
      const rawData = this.store.series[idx]?.data || [];
      const processedData = this.applyGapsAndFormat(rawData, idx);
      newSeries.push({ ...opt, data: processedData });
    });

    this.myChart.setOption({ series: newSeries }, { replaceMerge: ['series'] });
  }

  private applyGapsAndFormat(rawData: [number, number][], seriesIdx: number): any[] {
     if (rawData.length === 0) return [];
     
     const processed = [];
     const dataKey = this.ctx.datasources[0].dataKeys[seriesIdx];
     const decimals = isDefinedAndNotNull(dataKey.decimals) ? dataKey.decimals : this.ctx.decimals;
     const factor = Math.pow(10, decimals);
     const needsFormat = decimals !== null; 

     let lastTs = rawData[0][0];
     let val = rawData[0][1];
     if (needsFormat && val !== null) val = Math.round(val * factor) / factor;
     
     processed.push({ name: lastTs, value: [lastTs, val] });

     for (let i = 1; i < rawData.length; i++) {
        const currTs = rawData[i][0];
        let currVal = rawData[i][1];
        
        if (this.maxSplitTime > 0 && (currTs - lastTs > this.maxSplitTime)) {
            processed.push({ name: currTs - 1, value: [currTs - 1, null] });
        }
        
        if (needsFormat && currVal !== null) {
            currVal = Math.round(currVal * factor) / factor;
        }

        processed.push({ name: currTs, value: [currTs, currVal] });
        lastTs = currTs;
     }
     return processed;
  }

  private clearStore() {
    this.store.minLoaded = -1;
    this.store.maxLoaded = -1;
    Object.keys(this.store.series).forEach(k => this.store.series[k].data = []);
  }

  private updateXAxisView(min: number, max: number) {
     this.ngZone.runOutsideAngular(() => {
        if (this.myChart) {
          this.myChart.setOption({
              xAxis: { min: min, max: max }
          });
        }
     });
  }

  // =================================================================================
  // SUPPORT LOGIC
  // =================================================================================

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
      this.ngZone.runOutsideAngular(() => {
        if (this.myChart) this.myChart.resize();
      });
    });
    this.shapeResize$.observe(this._echartContainer.nativeElement);
  }

  private prepareValueFormat() {
    const units = this.ctx.units;
    this.valueFormatter = ValueFormatProcessor.fromSettings(this.ctx.$injector, {units, decimals: this.ctx.decimals});
  }

  private setupTooltipElement(params: CallbackDataParams[]): HTMLElement {
    if (!params || params.length === 0) return null;
    const hoverTimestamp = params[0].value[0] as number;

    const tooltipElement: HTMLElement = this.renderer.createElement('div');
    this.renderer.setStyle(tooltipElement, 'display', 'flex');
    this.renderer.setStyle(tooltipElement, 'flex-direction', 'column');
    this.renderer.setStyle(tooltipElement, 'align-items', 'flex-start');
    this.renderer.setStyle(tooltipElement, 'gap', '16px');

    const tooltipItemsElement: HTMLElement = this.renderer.createElement('div');
    this.renderer.setStyle(tooltipItemsElement, 'display', 'flex');
    this.renderer.setStyle(tooltipItemsElement, 'flex-direction', 'column');
    this.renderer.setStyle(tooltipItemsElement, 'align-items', 'flex-start');
    this.renderer.setStyle(tooltipItemsElement, 'gap', '4px');

    const dateElement: HTMLElement = this.renderer.createElement('div');
    this.renderer.appendChild(dateElement, this.renderer.createText(new Date(hoverTimestamp).toLocaleString('en-GB')));
    this.renderer.setStyle(dateElement, 'font-family', 'Roboto');
    this.renderer.setStyle(dateElement, 'font-size', '11px');
    this.renderer.setStyle(dateElement, 'color', 'rgba(0, 0, 0, 0.76)');
    this.renderer.appendChild(tooltipItemsElement, dateElement);

    const sortedDataKeys = this.ctx.datasources[0].dataKeys.map((dk, idx) => ({dk, idx})).sort((a, b) => {
       return a.dk.label.localeCompare(b.dk.label);
    });

    for (const item of sortedDataKeys) {
      const idx = item.idx;
      const dataKey = item.dk;
      
      const seriesStore = this.store.series[idx];
      if (!seriesStore || !seriesStore.data.length) continue;

      const closestPoint = this.findClosestPoint(seriesStore.data, hoverTimestamp);
      
      if (closestPoint) {
        const rawValue = closestPoint[1];
        if (rawValue === null || rawValue === undefined) continue;

        const decimals = isDefinedAndNotNull(dataKey.decimals) ? dataKey.decimals : this.ctx.decimals;
        const units = isDefinedAndNotNull(dataKey.units) ? dataKey.units : this.ctx.units;
        const valueFormatter = ValueFormatProcessor.fromSettings(this.ctx.$injector, {units, decimals});
        const formattedValue = valueFormatter.format(rawValue);

        const row = this.createTooltipRow(dataKey.color, dataKey.label, formattedValue);
        this.renderer.appendChild(tooltipItemsElement, row);
      }
    }

    this.renderer.appendChild(tooltipElement, tooltipItemsElement);
    return tooltipElement;
  }

  private createTooltipRow(color: string, label: string, valueText: string): HTMLElement {
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
    this.renderer.setStyle(circleElement, 'background', color);
    this.renderer.appendChild(labelElement, circleElement);

    const labelTextElement: HTMLElement = this.renderer.createElement('div');
    this.renderer.setProperty(labelTextElement, 'innerHTML', this.sanitizer.sanitize(SecurityContext.HTML, label));
    this.renderer.setStyle(labelTextElement, 'font-family', 'Roboto');
    this.renderer.setStyle(labelTextElement, 'font-size', '12px');
    this.renderer.setStyle(labelTextElement, 'color', 'rgba(0, 0, 0, 0.76)');
    this.renderer.appendChild(labelElement, labelTextElement);

    const valueElement: HTMLElement = this.renderer.createElement('div');
    this.renderer.setProperty(valueElement, 'innerHTML', this.sanitizer.sanitize(SecurityContext.HTML, valueText));
    this.renderer.setStyle(valueElement, 'flex', '1');
    this.renderer.setStyle(valueElement, 'text-align', 'end');
    this.renderer.setStyle(valueElement, 'font-family', 'Roboto');
    this.renderer.setStyle(valueElement, 'font-size', '12px');
    this.renderer.setStyle(valueElement, 'font-weight', 500);
    this.renderer.setStyle(valueElement, 'color', 'rgba(0, 0, 0, 0.76)');
    
    this.renderer.appendChild(labelValueElement, valueElement);
    return labelValueElement;
  }
  
  private setupAnimationSettings(): object {
      return  { animation: false }
  }

  private setupChartLines(): SeriesOption[] {
    const series: SeriesOption[] = [];
    if (this.ctx.datasources.length > 0) {
      for(const [index, dataKey] of this.ctx.datasources[0].dataKeys.entries()) {
        series.push({
          id: index,
          name: dataKey.label,
          type: 'line',
          sampling: 'lttb',
          connectNulls: false,
          showSymbol: false,
          smooth: false,
          step: false,
          stackStrategy: 'all',
          data: [],
          lineStyle: { color: dataKey.color },
          itemStyle: { color: dataKey.color }
        });
      }
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
      name: 'YAxis',
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
      splitLine: { show: true },
      axisLine: { show: true, lineStyle: { color: 'rgba(0, 0, 0, 0.54)' } },
      axisTick: { lineStyle: { color: 'rgba(0, 0, 0, 0.54)' }, show: true },
      nameTextStyle: {
        color: 'rgba(0, 0, 0, 0.54)', fontFamily: 'Roboto', fontSize: 12, fontStyle: 'normal', fontWeight: 600
      }
    }
  }

  private findClosestPoint(data: [number, any][], targetTimestamp: number): [number, number] | null {
    if (!data || data.length === 0) return null;
    let left = 0;
    let right = data.length - 1;

    if (targetTimestamp <= data[0][0]) return data[0];
    if (targetTimestamp >= data[right][0]) return data[right];

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (data[mid][0] === targetTimestamp) {
        return data[mid];
      } else if (data[mid][0] < targetTimestamp) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    const prev = data[right];
    const next = data[left];

    if (!prev) return next;
    if (!next) return prev;

    return (targetTimestamp - prev[0] < next[0] - targetTimestamp) ? prev : next;
  }

  private setupXAxis(): XAXisOption {
    return {
      id: 'xAxis',
      mainType: 'xAxis',
      show: true,
      type: 'time',
      position: "bottom",
      name: 'XAxis',
      offset: 0,
      nameLocation: 'middle',
      // Min a Max se nastavují dynamicky v updateXAxisView, zde init default
      max:  this.ctx.defaultSubscription.timeWindow.maxTime,
      min:  this.ctx.defaultSubscription.timeWindow.minTime,
      nameTextStyle: {
        color: 'rgba(0, 0, 0, 0.54)', fontStyle: 'normal', fontWeight: 600, fontFamily: 'Roboto', fontSize: 12,
      },
      axisPointer: {
        snap: true,
        shadowStyle: { color: 'rgba(210,219,238,0.2)' }
      },
      splitLine: { show: true },
      axisTick: { show: true, lineStyle: { color: 'rgba(0, 0, 0, 0.54)' } },
      axisLine: { onZero: false, show: true, lineStyle: { color: 'rgba(0, 0, 0, 0.54)' } },
      axisLabel: {
        color: 'rgba(0, 0, 0, 0.54)', fontFamily: 'Roboto', fontSize: 10, fontStyle: 'normal', fontWeight: 400, show: true, hideOverlap: true,
      }
    }
  }
}