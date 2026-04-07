import { ChangeDetectorRef, Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';

type FlowEdge = 'fve-grid' | 'fve-home' | 'grid-home';

interface FlowBubble {
  id: string;
  edge: FlowEdge;
  durationSec: number;
  beginSec: number;
  sizePx: number;
}

@Component({
  selector: 'tb-miikue-iris-x',
  templateUrl: './miikue-iris-x.component.html',
  styleUrls: ['./miikue-iris-x.component.scss'],
  standalone: false
})
export class MiikueIrisXComponent implements OnInit, OnChanges {

  @Input() ctx: any;

  fvePower = 0;
  gridPowerAbs = 0;
  homePower = 0;
  flowBubbles: FlowBubble[] = [];

  private gridRawPower = 0;
  private fveDecimals = 2;
  private gridDecimals = 2;
  private homeDecimals = 2;
  private unit = 'kW';

  constructor(private cd: ChangeDetectorRef) {}

  ngOnInit(): void {
    if (this.ctx?.$scope) {
      this.ctx.$scope.miikueIrisXWidget = this;
    }
    this.onInit();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['ctx'] && this.ctx?.$scope) {
      this.ctx.$scope.miikueIrisXWidget = this;
    }
    this.onDataUpdated();
  }

  public onInit(): void {
    this.onDataUpdated();
  }

  public onDataUpdated(): void {
    const data = this.ctx?.$scope?.data || this.ctx?.data || [];
    if (!Array.isArray(data) || data.length < 1) {
      this.fvePower = 0;
      this.gridRawPower = 0;
      this.gridPowerAbs = 0;
      this.homePower = 0;
      this.flowBubbles = [];
      this.cd.detectChanges();
      return;
    }

    const fveItem = data[0];
    const gridItem = data[1];

    this.fvePower = this.getLatestNumericValue(fveItem);
    this.gridRawPower = this.getLatestNumericValue(gridItem);
    this.gridPowerAbs = Math.abs(this.gridRawPower);

    // House consumption = FVE production + import from grid - export to grid.
    this.homePower = Math.max(0, this.fvePower + this.gridRawPower);

    this.fveDecimals = this.readDecimals(fveItem, this.ctx?.decimals ?? 2);
    this.gridDecimals = this.readDecimals(gridItem, this.ctx?.decimals ?? 2);
    this.homeDecimals = this.fveDecimals;
    this.unit = this.readUnit(fveItem, this.ctx?.units || 'kW');
    this.rebuildFlowBubbles();

    this.cd.detectChanges();
  }

  get fveValueText(): string {
    return this.formatValue(this.fvePower, this.fveDecimals);
  }

  get gridValueText(): string {
    return this.formatValue(this.gridPowerAbs, this.gridDecimals);
  }

  get homeValueText(): string {
    return this.formatValue(this.homePower, this.homeDecimals);
  }

  get valueUnitText(): string {
    return this.unit;
  }

  get gridFlowText(): string {
    if (this.gridRawPower < 0) {
      return 'Do site';
    }
    if (this.gridRawPower > 0) {
      return 'Ze site';
    }
    return 'Vyrovnano';
  }

  get isGridExport(): boolean {
    return this.gridRawPower < 0;
  }

  trackByBubble(index: number, bubble: FlowBubble): string {
    return bubble.id;
  }

  private rebuildFlowBubbles(): void {
    const fveToGrid = Math.max(0, -this.gridRawPower);
    const gridToHome = Math.max(0, this.gridRawPower);
    const fveToHome = Math.min(Math.max(this.fvePower, 0), this.homePower);
    const scale = Math.max(this.fvePower, this.gridPowerAbs, this.homePower, 1);

    this.flowBubbles = [
      ...this.buildEdgeBubbles('fve-grid', fveToGrid, scale),
      ...this.buildEdgeBubbles('fve-home', fveToHome, scale),
      ...this.buildEdgeBubbles('grid-home', gridToHome, scale)
    ];
  }

  private buildEdgeBubbles(edge: FlowEdge, power: number, scale: number): FlowBubble[] {
    if (power <= 0 || scale <= 0) {
      return [];
    }

    const ratio = Math.min(power / scale, 1);
    const count = Math.max(1, Math.min(6, Math.round(ratio * 6)));
    const durationSec = 4.2 - (ratio * 2.2);
    const sizePx = 7 + (ratio * 5);

    const bubbles: FlowBubble[] = [];
    for (let i = 0; i < count; i++) {
      bubbles.push({
        id: `${edge}-${i}`,
        edge,
        durationSec,
        beginSec: (durationSec / count) * i,
        sizePx
      });
    }

    return bubbles;
  }

  private getLatestNumericValue(item: any): number {
    if (!item?.data || !Array.isArray(item.data) || item.data.length === 0) {
      return 0;
    }
    const lastPoint = item.data[item.data.length - 1];
    const parsed = Number(lastPoint?.[1]);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private readDecimals(item: any, fallback: number): number {
    const parsed = Number(item?.dataKey?.decimals);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
    return Number.isFinite(fallback) ? fallback : 2;
  }

  private readUnit(item: any, fallback: string): string {
    const unit = item?.dataKey?.units;
    if (typeof unit === 'string' && unit.trim().length) {
      return unit;
    }
    return fallback;
  }

  private formatValue(value: number, decimals: number): string {
    return value.toLocaleString('cs-CZ', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }
}
