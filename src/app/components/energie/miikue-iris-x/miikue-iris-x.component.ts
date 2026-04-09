import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild
} from '@angular/core';

type FlowEdge = 'fve-grid' | 'fve-home' | 'grid-home' | 'fve-maric';

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
  @ViewChild('diagramRef', { static: true }) diagramRef!: ElementRef<HTMLElement>;

  fvePower = 0;
  maricPower = 0;
  gridPowerAbs = 0;
  homePower = 0;
  flowBubbles: FlowBubble[] = [];
  showMaric = false;

  diagramWidth = 1000;
  diagramHeight = 640;
  nodeDiameterPx = 80;
  fveNodeLeft = 420;
  fveNodeTop = 40;
  gridNodeLeft = 120;
  gridNodeTop = 420;
  homeNodeLeft = 720;
  homeNodeTop = 420;
  maricNodeLeft = 220;
  maricNodeTop = 40;
  fveToGridPath = 'M500 130 L250 470';
  fveToHomePath = 'M500 130 L750 470';
  gridToHomePath = 'M250 470 L750 470';
  fveToMaricPath = 'M500 130 L300 130';

  private gridRawPower = 0;
  private fveDecimals = 2;
  private maricDecimals = 2;
  private gridDecimals = 2;
  private homeDecimals = 2;
  private fveUnit = 'kW';
  private maricUnit = 'kW';
  private gridUnit = 'kW';
  private homeUnit = 'kW';
  private readonly defaultFveColor = '#efb44f';
  private readonly defaultMaricColor = '#d97706';
  private readonly defaultGridColor = '#2b38eb';
  private readonly defaultHomeColor = '#111111';
  fveColor = this.defaultFveColor;
  maricColor = this.defaultMaricColor;
  gridColor = this.defaultGridColor;
  homeColor = this.defaultHomeColor;
  fveHomeColor = '#e49412';
  private resizeObserver?: ResizeObserver;

  constructor(private cd: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    this.updateGeometry();
    this.resizeObserver = new ResizeObserver(() => {
      this.updateGeometry();
      this.cd.detectChanges();
    });
    this.resizeObserver.observe(this.diagramRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

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
    this.updateGeometry();
    this.onDataUpdated();
  }

  public onResize(): void {
    this.updateGeometry();
    this.cd.detectChanges();
  }

  public onDataUpdated(): void {
    const data = this.ctx?.$scope?.data || this.ctx?.data || [];
    if (!Array.isArray(data) || data.length < 1) {
      this.fvePower = 0;
      this.maricPower = 0;
      this.gridRawPower = 0;
      this.gridPowerAbs = 0;
      this.homePower = 0;
      this.showMaric = false;
      this.fveUnit = 'kW';
      this.gridUnit = 'kW';
      this.maricUnit = 'kW';
      this.homeUnit = 'kW';
      this.fveColor = this.defaultFveColor;
      this.maricColor = this.defaultMaricColor;
      this.gridColor = this.defaultGridColor;
      this.homeColor = this.defaultHomeColor;
      this.fveHomeColor = '#e49412';
      this.flowBubbles = [];
      this.cd.detectChanges();
      return;
    }

    const fveItem = data[0];
    const gridItem = data[1];
    const maricItem = data[2];

    this.fvePower = this.getLatestNumericValue(fveItem);
    this.showMaric = Boolean(maricItem);
    this.maricPower = this.showMaric ? Math.max(0, this.getLatestNumericValue(maricItem)) : 0;
    this.gridRawPower = this.getLatestNumericValue(gridItem);
    this.gridPowerAbs = Math.abs(this.gridRawPower);
    this.fveColor = this.readColor(fveItem, this.defaultFveColor);
    this.gridColor = this.readColor(gridItem, this.defaultGridColor);
    this.maricColor = this.readColor(maricItem, this.defaultMaricColor);
    this.homeColor = this.defaultHomeColor;
    this.fveHomeColor = this.fveColor;

    // House consumption = FVE production + import from grid - export to grid.
    this.homePower = Math.max(0, this.fvePower + this.gridRawPower);

    this.fveDecimals = this.readDecimals(fveItem, this.ctx?.decimals ?? 2);
    this.maricDecimals = this.readDecimals(maricItem, this.fveDecimals);
    this.gridDecimals = this.readDecimals(gridItem, this.ctx?.decimals ?? 2);
    this.homeDecimals = this.fveDecimals;
    this.fveUnit = this.readUnit(fveItem, this.ctx?.units || 'kW');
    this.gridUnit = this.readUnit(gridItem, this.fveUnit);
    this.maricUnit = this.readUnit(maricItem, this.fveUnit);
    this.homeUnit = this.fveUnit;
    this.rebuildFlowBubbles();

    this.cd.detectChanges();
  }

  get fveValueText(): string {
    return this.formatValue(this.fvePower, this.fveDecimals);
  }

  get gridValueText(): string {
    return this.formatValue(this.gridPowerAbs, this.gridDecimals);
  }

  get maricValueText(): string {
    return this.formatValue(this.maricPower, this.maricDecimals);
  }

  get homeValueText(): string {
    return this.formatValue(this.homePower, this.homeDecimals);
  }

  get fveUnitText(): string {
    return this.fveUnit;
  }

  get gridUnitText(): string {
    return this.gridUnit;
  }

  get maricUnitText(): string {
    return this.maricUnit;
  }

  get homeUnitText(): string {
    return this.homeUnit;
  }

  get gridFlowText(): string {
    if (this.gridRawPower < 0) {
      return 'Do sítě';
    }
    if (this.gridRawPower > 0) {
      return 'Ze sítě';
    }
    return 'Vyrovnáno';
  }

  get isGridExport(): boolean {
    return this.gridRawPower < 0;
  }

  trackByBubble(index: number, bubble: FlowBubble): string {
    return bubble.id;
  }

  get themeVars(): Record<string, string> {
    return {
      '--fve': this.fveColor,
      '--maric': this.maricColor,
      '--grid': this.gridColor,
      '--home': this.homeColor,
      '--fve-home': this.fveHomeColor
    };
  }

  private rebuildFlowBubbles(): void {
    const fveToGrid = Math.max(0, -this.gridRawPower);
    const gridToHome = Math.max(0, this.gridRawPower);
    const fveToMaric = this.showMaric ? this.maricPower : 0;
    const fveAvailableForHome = Math.max(0, this.fvePower - fveToGrid - fveToMaric);
    const fveToHome = Math.min(fveAvailableForHome, this.homePower);
    const scale = Math.max(this.fvePower, this.gridPowerAbs, this.homePower, 1);

    this.flowBubbles = [
      ...this.buildEdgeBubbles('fve-maric', fveToMaric, scale),
      ...this.buildEdgeBubbles('fve-grid', fveToGrid, scale),
      ...this.buildEdgeBubbles('fve-home', fveToHome, scale),
      ...this.buildEdgeBubbles('grid-home', gridToHome, scale)
    ];
  }

  private updateGeometry(): void {
    const el = this.diagramRef?.nativeElement;
    if (!el) {
      return;
    }

    const width = Math.max(el.clientWidth, 180);
    const height = Math.max(el.clientHeight, 120);
    const minSide = Math.min(width, height);

    this.diagramWidth = width;
    this.diagramHeight = height;

    const padding = minSide * 0.08;
    const diameter = 80;
    const radius = diameter / 2;

    this.nodeDiameterPx = diameter;

    const fveCenter = {
      x: width / 2,
      y: padding + radius
    };

    const gridCenter = {
      x: padding + radius,
      y: height - padding - radius
    };

    const homeCenter = {
      x: width - padding - radius,
      y: height - padding - radius
    };

    const maricCenter = {
      x: padding + radius,
      y: padding + radius
    };

    this.fveNodeLeft = fveCenter.x - radius;
    this.fveNodeTop = fveCenter.y - radius;
    this.gridNodeLeft = gridCenter.x - radius;
    this.gridNodeTop = gridCenter.y - radius;
    this.homeNodeLeft = homeCenter.x - radius;
    this.homeNodeTop = homeCenter.y - radius;
    this.maricNodeLeft = maricCenter.x - radius;
    this.maricNodeTop = maricCenter.y - radius;

    const pathOffset = radius + 2;
    this.fveToGridPath = this.buildLinePath(fveCenter, gridCenter, pathOffset);
    this.fveToHomePath = this.buildLinePath(fveCenter, homeCenter, pathOffset);
    this.gridToHomePath = this.buildLinePath(gridCenter, homeCenter, pathOffset);
    this.fveToMaricPath = this.buildLinePath(fveCenter, maricCenter, pathOffset);
  }

  private buildLinePath(from: { x: number; y: number }, to: { x: number; y: number }, cut: number): string {
    const start = this.offsetToward(from, to, cut);
    const end = this.offsetToward(to, from, cut);
    return `M${start.x} ${start.y} L${end.x} ${end.y}`;
  }

  private offsetToward(from: { x: number; y: number }, to: { x: number; y: number }, distance: number): { x: number; y: number } {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
      x: from.x + (dx / length) * distance,
      y: from.y + (dy / length) * distance
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private buildEdgeBubbles(edge: FlowEdge, power: number, scale: number): FlowBubble[] {
    if (power <= 0 || scale <= 0) {
      return [];
    }

    const ratio = Math.min(power / scale, 1);
    const count = Math.max(1, Math.min(6, Math.round(ratio * 6)));
    const durationSec = 4.2 - (ratio * 2.2);
    const sizePx = 9;

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

  private readColor(item: any, fallback: string): string {
    const color = item?.dataKey?.color;
    if (typeof color === 'string' && color.trim().length) {
      return color.trim();
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
