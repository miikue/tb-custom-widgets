import { ChangeDetectorRef, Component, ElementRef, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TimeWindow } from '../miikue-time-window-selector/miikue-time-window-selector.component';

@Component({
  selector: 'tb-miikue-energie',
  templateUrl: './miikue-energie.component.html',
  styleUrls: ['./miikue-energie.component.scss']
})
export class MiikueEnergieComponent implements OnInit, OnChanges {

  @Input() ctx: any;

  // Configuration Inputs
  @Input() isOk: boolean = true;
  @Input() badText: string = 'NEAKTUÁLNÍ DATA';
  @Input() badColor: string = '#ef4444';
  @Input() daysCount: number = 7;
  @Input() fullscreen: boolean = false;

  // New time window state with a valid default value
  public currentTimeWindow: TimeWindow = {
      startTs: new Date().getTime() - 7 * 24 * 60 * 60 * 1000,
      endTs: new Date().getTime()
  };

  // Internal Labels (taken from data keys)
  dailyLabel: string = 'Dnes';
  totalLabel: string = 'Celkem';

  // Internal State
  _dailyVal: string = '0';
  _dailyUnit: string = '';
  _totalVal: string = '0';
  _totalUnit: string = '';

  // Chart Data
  chartBars: Array<{ x: number, y: number, width: number, height: number, isLast: boolean, value: string, date: string, rawTs: number }> = [];
  monthMarkers: Array<{ x: number, label: string }> = [];
  gridLines: Array<{ y: number, value: string }> = [];

  // Statistics
  stats = { min: '0', max: '0', avg: '0', total: '0' };

  // Tooltip State
  hoveredBar: any = null;
  tooltipPos = { x: 0, y: 0 };

  // Helper for bad data state styling
  currentPrimaryColor: string = '#1e293b';

  // Caching & Progressive Loading
  private hasFetchedInitialData = false;
  private allDataPoints: Map<number, any> = new Map();
  private fetchedRanges: Array<{start: number, end: number}> = [];
  private currentFetchId: number = 0;
  private lastEntityId: string = '';
  public isLoading: boolean = false;

  constructor(private cd: ChangeDetectorRef, private http: HttpClient, private elementRef: ElementRef) {}

  ngOnInit(): void {
      const validDaysCount = Number(this.daysCount) || 7;
      const endTs = new Date().getTime();
      const startTs = endTs - (validDaysCount * 24 * 60 * 60 * 1000);
      this.currentTimeWindow = { startTs, endTs };

      if (this.ctx && this.ctx.$scope) {
          this.ctx.$scope.miikueEnergieWidget = this;
      }
      this.refreshData();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['ctx']) {
        if (this.ctx && this.ctx.$scope) {
            this.ctx.$scope.miikueEnergieWidget = this;
        }
        if (this.ctx.defaultSubscription && this.ctx.defaultSubscription.datasources && this.ctx.defaultSubscription.datasources.length > 0) {
             const newId = this.ctx.defaultSubscription.datasources[0].entityId;
             if (newId !== this.lastEntityId) {
                 this.clearCache();
                 this.lastEntityId = newId;
             }
        }
    }
    this.refreshData();
  }

  public onTimeWindowChange(newTimeWindow: TimeWindow): void {
      //console.log('%c[Energie] onTimeWindowChange called with:', 'color: green; font-weight: bold;', newTimeWindow);
      this.currentTimeWindow = newTimeWindow;
      this.fetchHistory();
  }

  public onBarEnter(bar: any, event: MouseEvent) {
      this.hoveredBar = bar;
      this.updateTooltipPos(event);
  }

  public onBarMove(event: MouseEvent) {
      this.updateTooltipPos(event);
  }

  public onBarLeave() {
      this.hoveredBar = null;
  }

  public onChartTouchMove(event: TouchEvent) {
      if (event.touches.length > 0) {
          event.preventDefault();
          const touch = event.touches[0];
          this.handlePointerAt(touch.clientX, touch.clientY);
      }
  }

  public onChartTouchStart(event: TouchEvent) {
      if (event.touches.length > 0) {
          const touch = event.touches[0];
          this.handlePointerAt(touch.clientX, touch.clientY);
      }
  }

  private handlePointerAt(clientX: number, clientY: number) {
      const bounds = this.elementRef.nativeElement.getBoundingClientRect();
      const x = clientX - bounds.left;
      const y = clientY - bounds.top;
      this.tooltipPos.x = x;
      this.tooltipPos.y = y;

      const chartLayer = this.elementRef.nativeElement.querySelector('.chart-layer');
      if (chartLayer) {
          const cBounds = chartLayer.getBoundingClientRect();
          const relativeX = ((clientX - cBounds.left) / cBounds.width) * 100;
          const foundBar = this.chartBars.find(bar => 
              relativeX >= bar.x && relativeX <= (bar.x + bar.width + 1)
          );
          if (foundBar) {
              this.hoveredBar = foundBar;
          }
      }
  }

  private updateTooltipPos(event: MouseEvent) {
      const bounds = this.elementRef.nativeElement.getBoundingClientRect();
      this.tooltipPos.x = event.clientX - bounds.left;
      this.tooltipPos.y = event.clientY - bounds.top;
  }

  public onDataUpdated(): void {
      //console.log('--- onDataUpdated called ---');
      this.refreshData();
      
      const subDataKeysLength = this.ctx.defaultSubscription.dataKeys?.length || 0;
      const scopeDataLength = this.ctx.$scope.data?.length || 0;
      const hasDataKeys = subDataKeysLength > 0 || scopeDataLength > 0;

      //console.log(`Checking fetch condition: hasFetchedInitialData=${this.hasFetchedInitialData}, hasDataKeys=${hasDataKeys} (sub: ${subDataKeysLength}, scope: ${scopeDataLength})`);

      if (!this.hasFetchedInitialData && hasDataKeys) {
          //console.log("Condition met. Performing initial fetchHistory.");
          this.fetchHistory();
          this.hasFetchedInitialData = true;
      }

      this.cd.detectChanges();
  }

  private refreshData(): void {
      if (!this.isOk) {
          this._dailyVal = 'N/A';
          this._totalVal = 'N/A';
          this.currentPrimaryColor = this.badColor;
          this.cd.detectChanges();
          return;
      }
      this.currentPrimaryColor = '#1e293b';

      if (!this.ctx || !this.ctx.defaultSubscription) return;
      const data = this.ctx.$scope.data;

      if (data && data.length > 0) {
          const dailyItem = data[0];
          if (dailyItem) {
              if (dailyItem.dataKey.label || dailyItem.dataKey.name) {
                  this.dailyLabel = dailyItem.dataKey.label || dailyItem.dataKey.name; 
              }
              if (dailyItem.dataKey.units) {
                  this._dailyUnit = dailyItem.dataKey.units;
              }
              const decimals = (dailyItem.dataKey.decimals !== undefined && dailyItem.dataKey.decimals !== null) 
                               ? dailyItem.dataKey.decimals : 1;
              if (dailyItem.data && dailyItem.data.length) {
                  const val = Number(dailyItem.data[dailyItem.data.length - 1][1]);
                  this._dailyVal = this.formatTruncated(val, decimals);
              }
          }
          if (data.length > 1) {
              const totalItem = data[1];
              if (totalItem) {
                  if (totalItem.dataKey.label || totalItem.dataKey.name) {
                      this.totalLabel = totalItem.dataKey.label || totalItem.dataKey.name;
                  }
                  if (totalItem.dataKey.units) {
                      this._totalUnit = totalItem.dataKey.units;
                  }
                  const decimals = (totalItem.dataKey.decimals !== undefined && totalItem.dataKey.decimals !== null) 
                                   ? totalItem.dataKey.decimals : 1;
                  if (totalItem.data && totalItem.data.length) {
                      const val = Number(totalItem.data[totalItem.data.length - 1][1]);
                      this._totalVal = this.formatTruncated(val, decimals);
                  }
              }
          }
      }
      this.cd.detectChanges();
  }

  private clearCache() {
      this.allDataPoints.clear();
      this.fetchedRanges = [];
  }

  private fetchHistory(): void {
    if (!this.ctx || !this.ctx.defaultSubscription) return;
    const datasources = this.ctx.defaultSubscription.datasources || this.ctx.datasources;
    if (!datasources || datasources.length === 0) return;
    const entityType = datasources[0].entityType;
    const entityId = datasources[0].entityId;
    if (!entityId) return;

    let keyName = '';
    if (this.ctx.defaultSubscription.dataKeys && this.ctx.defaultSubscription.dataKeys.length > 0) {
        keyName = this.ctx.defaultSubscription.dataKeys[0].name;
    } else if (this.ctx.$scope?.data && this.ctx.$scope.data.length > 0) {
        keyName = this.ctx.$scope.data[0].dataKey.name;
    }
    if (!keyName) return;

    if (!this.currentTimeWindow) {
        return;
    }
    const { startTs, endTs } = this.currentTimeWindow;

    this.currentFetchId++;
    const fetchId = this.currentFetchId;
    this.isLoading = true;

    const CHUNK_SIZE = 7 * 24 * 60 * 60 * 1000;
    const chunks: Array<{start: number, end: number}> = [];
    
    let curr = startTs;
    while (curr < endTs) {
        let next = Math.min(curr + CHUNK_SIZE, endTs);
        chunks.push({ start: curr, end: next });
        curr = next;
    }

    this.updateChartFromCache(startTs, endTs);
    this.processNextChunk(chunks, fetchId, keyName, entityType, entityId, startTs, endTs);
  }

  private processNextChunk(
      chunks: Array<{start: number, end: number}>,
      fetchId: number, 
      keyName: string, 
      entityType: string, 
      entityId: string,
      globalStart: number,
      globalEnd: number
  ) {
      if (this.currentFetchId !== fetchId) return;
      if (chunks.length === 0) {
          this.isLoading = false;
          this.cd.detectChanges();
          return;
      }
      const chunk = chunks.shift();
      if (!chunk) return;
      if (this.isRangeCached(chunk.start, chunk.end)) {
          this.updateChartFromCache(globalStart, globalEnd); 
          this.processNextChunk(chunks, fetchId, keyName, entityType, entityId, globalStart, globalEnd);
          return;
      }

      const interval = 24 * 60 * 60 * 1000;
      const diffDays = Math.ceil((chunk.end - chunk.start) / interval);
      const limit = diffDays + 10;

      const url = `/api/plugins/telemetry/${entityType}/${entityId}/values/timeseries` +
          `?keys=${encodeURIComponent(keyName)}` +
          `&startTs=${chunk.start}` +
          `&endTs=${chunk.end}` +
          `&interval=${interval}` +
          `&agg=MAX` +
          `&limit=${limit}`;

      this.http.get(url).subscribe(
          (response: any) => {
              if (this.currentFetchId !== fetchId) return;
              if (response && response[keyName]) {
                  this.mergeData(response[keyName]);
              }
              this.markRangeCached(chunk.start, chunk.end);
              this.updateChartFromCache(globalStart, globalEnd);
              this.processNextChunk(chunks, fetchId, keyName, entityType, entityId, globalStart, globalEnd);
          },
          (error) => {
              console.error('MiikueEnergie: Failed to fetch chunk', error);
              this.processNextChunk(chunks, fetchId, keyName, entityType, entityId, globalStart, globalEnd);
          }
      );
  }

  private isRangeCached(start: number, end: number): boolean {
      return this.fetchedRanges.some(r => r.start <= start && r.end >= end);
  }

  private markRangeCached(start: number, end: number) {
      this.fetchedRanges.push({ start, end });
  }

  private mergeData(data: any[]) {
      data.forEach(item => {
          const d = new Date(item.ts);
          d.setHours(0, 0, 0, 0);
          const normalizedTs = d.getTime();
          const newItem = { ...item, ts: normalizedTs };
          this.allDataPoints.set(normalizedTs, newItem);
      });
  }

  private updateChartFromCache(startTs: number, endTs: number) {
      const viewData = Array.from(this.allDataPoints.values())
          .filter(d => d.ts >= startTs && d.ts <= endTs);
      this.generateChart(viewData);
  }

  private generateChart(data: any[]): void {
      if (!data || data.length === 0) {
          this.chartBars = [];
          this.monthMarkers = [];
          this.gridLines = [];
          this.stats = { min: '0', max: '0', avg: '0', total: '0' };
          this.cd.detectChanges();
          return;
      }
      data.sort((a, b) => a.ts - b.ts);
      
      let min = Infinity, max = -Infinity, sum = 0, countVal = 0;

      data.forEach(item => {
          const v = Number(item.value);
          if (v < min) min = v;
          if (v > max) max = v;
          sum += v;
          countVal++;
      });
      if (min === Infinity) min = 0;
      if (max === -Infinity) max = 0;
      const avg = countVal > 0 ? (sum / countVal) : 0;
      let decimals = 1;
      if (this.ctx.$scope?.data && this.ctx.$scope.data[0]?.dataKey?.decimals !== undefined) {
          decimals = this.ctx.$scope.data[0].dataKey.decimals;
      }

      this.stats = {
          min: this.formatTruncated(min, decimals),
          max: this.formatTruncated(max, decimals),
          avg: this.formatTruncated(avg, decimals),
          total: this.formatTruncated(sum, decimals)
      };

      let scaleMax = max;
      if (scaleMax === 0) scaleMax = 1;
      const svgW = 100, svgH = 40;
      
      this.gridLines = [];
      [0.25, 0.5, 0.75].forEach(ratio => {
          const val = scaleMax * ratio;
          const h = (val / scaleMax) * svgH;
          this.gridLines.push({ y: svgH - h, value: this.formatTruncated(val, decimals) });
      });

      const count = data.length;
      const gap = count > 60 ? 0.1 : (count > 20 ? 0.5 : 1.5);
      const totalGap = gap * (count - 1);
      const barWidth = Math.max((svgW - totalGap) / count, 0.1);

      this.chartBars = [];
      this.monthMarkers = [];
      let lastMonth = -1;

      data.forEach((item, index) => {
          const val = Number(item.value);
          const h = (val / scaleMax) * svgH;
          const dateObj = new Date(item.ts);
          const dateStr = dateObj.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
          const currentMonth = dateObj.getMonth();
          
          const x = index * (barWidth + gap);

          if (index === 0 || currentMonth !== lastMonth) {
              const monthName = dateObj.toLocaleDateString('cs-CZ', { month: 'short' });
              this.monthMarkers.push({ x: x, label: monthName });
          }
          lastMonth = currentMonth;

          this.chartBars.push({
              x: x, y: svgH - h, width: barWidth, height: Math.max(h, 0.5),
              isLast: index === data.length - 1,
              value: this.formatTruncated(val, decimals) + ' ' + this._dailyUnit,
              date: dateStr,
              rawTs: item.ts
          });
      });
      
      this.cd.detectChanges();
  }

  private formatTruncated(value: number, decimals: number): string {
    const multiplier = Math.pow(10, decimals);
    const truncated = Math.trunc(value * multiplier) / multiplier;
    return truncated.toLocaleString('cs-CZ', { 
        minimumFractionDigits: decimals, 
        maximumFractionDigits: decimals 
    });
  }
}