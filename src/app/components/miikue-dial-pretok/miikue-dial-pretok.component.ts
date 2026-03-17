import { ChangeDetectorRef, Component, Input, OnChanges, OnInit, SimpleChanges, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'tb-miikue-dial-pretok',
  templateUrl: './miikue-dial-pretok.component.html',
  styleUrls: ['./miikue-dial-pretok.component.scss']
})
export class MiikueDialPretokComponent implements OnInit, OnChanges {

  @Input() ctx: any; // The ThingsBoard widget context
  
  @Input() maxLimit: number = 400; // Scale limit (e.g. -400 to 400)
  @Input() pDeliveryColor: string = '#22c55e'; // Left side (Delivery)
  @Input() pConsumptionColor: string = '#f97316'; // Right side (Consumption)


  @Input() pText: string = 'DODÁVKA DO SÍTĚ';
  @Input() qText: string = 'ODBĚR ZE SÍTĚ';
  @Input() neutralText: string = 'NEČINNÉ';

  @Input() isOk: boolean = true; // Pokud false, zobrazí se N/A a badText
  @Input() badText: string = 'NEAKTUÁLNÍ DATA';
  @Input() badColor: string = '#ef4444'; // Color for stale data/N/A

  // Internal properties derived from ctx
  _pValue: number = 0; 
  _qValue: number = 0;
  _unit: string = 'kW';
  _qUnit: string = 'kVAr';
  _pDecimals: number = 1;
  _qDecimals: number = 1;

  // Calculated properties
  deliveryOffset: number = 126;
  consumptionOffset: number = 126;
  
  isDelivery: boolean = false;
  
  displayValue: string = '0';
  displayQValue: string = '0';
  statusText: string = 'NEČINNÉ';
  
  ticks: any[] = [];

  constructor(private cd: ChangeDetectorRef) {}

  ngOnInit(): void {
      if (this.ctx && this.ctx.$scope) {
          this.ctx.$scope.miikueDialWidget = this;
      }
      this.onInit();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // If ctx object changes reference (rare), re-register
    if (changes['ctx'] && this.ctx && this.ctx.$scope) {
        this.ctx.$scope.miikueDialWidget = this;
    }
    
    // For other input changes, refresh display
    this.refreshDisplay();
  }

  public onInit(): void {
      this.onDataUpdated();
  }

  public onDataUpdated(): void {
      this.extractDataFromCtx();
      this.refreshDisplay();
      this.cd.detectChanges();
  }

  private extractDataFromCtx(): void {
    const data = this.ctx.$scope?.data;
    
    if (data && data.length > 0) {
      // First value in the list (P)
      const pItem = data[0];
      if (pItem) {
        if (pItem.data && pItem.data.length) {
           const latestPoint = pItem.data[pItem.data.length - 1];
           this._pValue = Number(latestPoint[1]);
        }
        if (pItem.dataKey) {
            this._unit = pItem.dataKey.units || this._unit;
            if (pItem.dataKey.decimals !== undefined && pItem.dataKey.decimals !== null) {
                this._pDecimals = pItem.dataKey.decimals;
            }
        }
      }

      // Second value in the list (Q)
      if (data.length > 1) {
        const qItem = data[1];
        if (qItem) {
            if (qItem.data && qItem.data.length) {
                this._qValue = Number(qItem.data[qItem.data.length - 1][1]);
            }
            if (qItem.dataKey) {
                this._qUnit = qItem.dataKey.units || this._qUnit;
                if (qItem.dataKey.decimals !== undefined && qItem.dataKey.decimals !== null) {
                    this._qDecimals = qItem.dataKey.decimals;
                }
            }
        }
      }
    }
  }

  public refreshDisplay(): void {
    this.updateState();
    this.generateTicks();
  }

  private formatTruncated(value: number, decimals: number): string {
    if (decimals === undefined || decimals === null) return value.toString();
    const multiplier = Math.pow(10, decimals);
    // Use Math.trunc to cut off decimals without rounding
    const truncated = Math.trunc(value * multiplier) / multiplier;
    return truncated.toLocaleString('cs-CZ', { 
        minimumFractionDigits: decimals, 
        maximumFractionDigits: decimals 
    });
  }

  public updateState() {
    const maxArcLength = 126;

    if (!this.isOk) {
        this.displayValue = 'N/A';
        this.displayQValue = 'N/A';
        this.statusText = this.badText;
        this.deliveryOffset = maxArcLength;
        this.consumptionOffset = maxArcLength;
        this.isDelivery = false; // Reset to avoid specific color logic for P/Q
        return;
    }

    this.isDelivery = this._pValue < 0; 
    
    // Format P Value (Truncate, no rounding)
    this.displayValue = this.formatTruncated(Math.abs(this._pValue), this._pDecimals);

    // Format Q Value (Truncate, no rounding)
    this.displayQValue = this.formatTruncated(this._qValue, this._qDecimals);
    

    if (this._pValue === 0) {
      this.statusText = this.neutralText;
      this.deliveryOffset = maxArcLength;
      this.consumptionOffset = maxArcLength;
    } else if (this._pValue < 0) {
      this.statusText = this.pText;
      const ratio = Math.min(Math.abs(this._pValue) / this.maxLimit, 1);
      this.deliveryOffset = maxArcLength - (maxArcLength * ratio);
      this.consumptionOffset = maxArcLength;
    } else {
      this.statusText = this.qText;
      const ratio = Math.min(Math.abs(this._pValue) / this.maxLimit, 1);
      this.consumptionOffset = maxArcLength - (maxArcLength * ratio);
      this.deliveryOffset = maxArcLength;
    }
  }

  public generateTicks() {
    const centerX = 100;
    const centerY = 100;
    this.ticks = [];
    // 5 ticks: -Max, -Max/2, 0, Max/2, Max
    // Angles: 180, 225, 270, 315, 360
    const steps = [
      { ratio: -1, angle: 180 },
      { ratio: -0.5, angle: 225 },
      { ratio: 0, angle: 270 },
      { ratio: 0.5, angle: 315 },
      { ratio: 1, angle: 360 }
    ];

    steps.forEach(step => {
      const val = this.maxLimit * step.ratio;
      const angleRad = step.angle * (Math.PI / 180);
      
      // Line: r72 to r88
      let x1 = centerX + (72 * Math.cos(angleRad));
      let y1 = centerY + (72 * Math.sin(angleRad));
      let x2 = centerX + (88 * Math.cos(angleRad));
      let y2 = centerY + (88 * Math.sin(angleRad));

      let anchor = 'middle';
      let lx, ly;

      // Custom positioning for side ticks (180 and 360)
      if (step.angle === 180 || step.angle === 360) {
        // Position directly below the tick end (y2)
        // x matches the outer edge roughly
        lx = centerX + (88 * Math.cos(angleRad)); 
        ly = centerY + 15; // Push down below the horizon (y=100)
        anchor = 'middle'; // Center text on the tick
      } else {
        // Standard radial position for others
        const labelR = 100;
        lx = centerX + (labelR * Math.cos(angleRad));
        ly = centerY + (labelR * Math.sin(angleRad)) + 4; // slight vertical offset
      }

      this.ticks.push({
        line: { x1, y1, x2, y2 },
        label: { 
          x: lx, 
          y: ly, 
          text: val.toString(),
          anchor: anchor
        }
      });
    });
  }
}