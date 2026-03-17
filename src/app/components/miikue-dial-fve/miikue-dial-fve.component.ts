import { ChangeDetectorRef, Component, Input, OnChanges, OnInit, SimpleChanges, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'tb-miikue-dial-fve',
  templateUrl: './miikue-dial-fve.component.html',
  styleUrls: ['./miikue-dial-fve.component.scss']
})
export class MiikueDialFveComponent implements OnInit, OnChanges {

  @Input() ctx: any;
  
  @Input() maxLimit: number = 10000; // Scale limit (0 to 10000)
  @Input() productionColor: string = '#eab308'; // Yellow/Orange for FVE
  @Input() limitColor: string = '#ef4444'; // Red for limit indication (future use)

  @Input() limitText: string = 'OMEZENO NA {value}%';
  @Input() errorText: string = 'NEZNÁMÝ STAV LIMITU';
  @Input() okText: string = 'NE-OMEZENO';
  
  @Input() isOk: boolean = true;
  @Input() badText: string = 'NEAKTUÁLNÍ DATA';
  @Input() badColor: string = '#ef4444';

  // Internal properties
  _pValue: number = 0; 
  _qValue: number = 0;
  _limitValue: number = 0; // The 3rd input
  
  _unit: string = 'kW';
  _qUnit: string = 'kVAr';
  _limitUnit: string = 'kW';

  _pDecimals: number = 1;
  _qDecimals: number = 1;

  // Limit logic
  limitMapping: { [key: number]: number } = {};
  limitAngle: number = 0;
  isLimitVisible: boolean = false;
  isLimitUnknown: boolean = false;
  limitRedDashArray: string = '0 251'; // Pattern for red zone
  lastLimitLabel: string = '';

  // Calculated properties
  activeOffset: number = 251; // Max length of arc (pi * 80)
  
  displayValue: string = '0';
  displayQValue: string = '0';
  statusText: string = 'VÝROBA FVE';
  
  ticks: any[] = [];
  limitTicks: any[] = [];
  currentLimitPct: number = -1;

  constructor(private cd: ChangeDetectorRef) {}

  ngOnInit(): void {
      if (this.ctx && this.ctx.$scope) {
          this.ctx.$scope.miikueDialFveWidget = this;
      }
      this.onInit();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['ctx'] && this.ctx && this.ctx.$scope) {
        this.ctx.$scope.miikueDialFveWidget = this;
    }
    
    this.refreshDisplay();
  }

  public onInit(): void {
      this.onDataUpdated();
  }

  public onDataUpdated(): void {
      this.extractDataFromCtx();
      this.refreshDisplay();
      this.cd.detectChanges(); // Force update
  }

  private extractDataFromCtx(): void {
    const data = this.ctx.$scope?.data;
    
    if (data && data.length > 0) {
      // 1. Value: Production (P)
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

      // 2. Value: Q
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

      // 3. Value: Limit (Omezení)
      this.isLimitVisible = false;
      this.isLimitUnknown = false;
      this.currentLimitPct = -1;
      this.limitRedDashArray = '0 251';
      
      if (data.length > 2) {
        const limitItem = data[2];
        if (limitItem) {
            // Check for mapping update
            const label = limitItem.dataKey.label || limitItem.dataKey.name;
            if (label && label !== this.lastLimitLabel) {
                this.parseLimitString(label);
                this.lastLimitLabel = label;
            }

            if (limitItem.data && limitItem.data.length) {
                this._limitValue = Number(limitItem.data[limitItem.data.length - 1][1]);
                
                // Resolve Limit
                if (this.limitMapping.hasOwnProperty(this._limitValue)) {
                    const limitPct = this.limitMapping[this._limitValue];
                    this.currentLimitPct = limitPct;
                    
                    // Angle
                    this.limitAngle = 180 + (limitPct * 1.8);
                    
                    // Red Zone DashArray
                    const totalLen = 251;
                    const gap = totalLen * (limitPct / 100);
                    this.limitRedDashArray = `0 ${gap} ${totalLen}`;
                    
                    this.isLimitVisible = true;
                } else {
                    // Value exists but not in mapping
                    this.isLimitUnknown = true;
                }
            }
        }
      }
    }
  }

  private parseLimitString(label: string) {
      this.limitMapping = {};
      // Regex to find content inside []
      const match = label.match(/\[(.*?)\]/);
      if (match && match[1]) {
          const content = match[1];
          // Support both legacy and new naming separators (space/underscore)
          const parts = content.split(/[\s_]+/);
          parts.forEach(part => {
             // Regex for key=value%
             const kvMatch = part.match(/(\d+)=(\d+)%?/);
             if (kvMatch) {
                 const key = Number(kvMatch[1]);
                 const val = Number(kvMatch[2]);
                 this.limitMapping[key] = val;
             }
          });
      }
      this.generateTicks();
  }

  public refreshDisplay(): void {
    this.updateState();
    // generateTicks is called only on init or mapping change
  }
  private formatTruncated(value: number, decimals: number): string {
    if (decimals === undefined || decimals === null) return value.toString();
    const multiplier = Math.pow(10, decimals);
    const truncated = Math.trunc(value * multiplier) / multiplier;
    return truncated.toLocaleString('cs-CZ', { 
        minimumFractionDigits: decimals, 
        maximumFractionDigits: decimals 
    });
  }

  public updateState() {
    // Arc length for radius 80 is approx 251.32
    const maxArcLength = 251;

    if (!this.isOk) {
        this.displayValue = 'N/A';
        this.displayQValue = 'N/A';
        this.statusText = this.badText;
        this.activeOffset = maxArcLength; // Empty
        return;
    }
    
    this.displayValue = this.formatTruncated(this._pValue, this._pDecimals);
    this.displayQValue = this.formatTruncated(this._qValue, this._qDecimals);
    
    // Status text logic
    if (this.isLimitUnknown) {
        this.statusText = this.errorText;
    } else if (this.isLimitVisible && this.currentLimitPct > -1 && this.currentLimitPct < 100) {
        this.statusText = this.limitText.replace('{value}', this.currentLimitPct.toString());
    } else {
        this.statusText = this.okText;
    }

    // Calculate ratio (0 to 1)
    const limit = this.maxLimit || 10000; 
    const ratio = Math.max(0, Math.min(this._pValue / limit, 1));
    this.activeOffset = maxArcLength - (maxArcLength * ratio);
  }

  public generateTicks() {
    const centerX = 100;
    const centerY = 100;
    const limit = this.maxLimit || 10000;
    
    // 1. Main Ticks (Values) - Outer half of track (r80-r88)
    this.ticks = [];
    const mainSteps = [0, 0.25, 0.5, 0.75, 1];
    mainSteps.forEach(ratio => {
        const val = limit * ratio;
        const angle = 180 + (ratio * 180);
        const angleRad = angle * (Math.PI / 180);

        // Line from r80 (middle) to r88 (outer edge)
        let x1 = centerX + (80 * Math.cos(angleRad));
        let y1 = centerY + (80 * Math.sin(angleRad));
        let x2 = centerX + (88 * Math.cos(angleRad));
        let y2 = centerY + (88 * Math.sin(angleRad));

        let lx, ly;
        // Outer label (r98)
        if (angle === 180 || angle === 360) {
            lx = centerX + (94 * Math.cos(angleRad)); 
            ly = centerY + 15; 
        } else {
            lx = centerX + (98 * Math.cos(angleRad));
            ly = centerY + (98 * Math.sin(angleRad)) + 4;
        }

        this.ticks.push({
            line: { x1, y1, x2, y2 },
            label: { 
                x: lx, 
                y: ly, 
                text: val.toLocaleString('cs-CZ', { maximumFractionDigits: 0 }), 
                anchor: 'middle' 
            }
        });
    });

    // 2. Limit Ticks (Percentages) - Inner half of track (r72-r80)
    this.limitTicks = [];
    const uniquePcts = new Set<number>();
    Object.values(this.limitMapping).forEach(val => uniquePcts.add(val));
    
    Array.from(uniquePcts).sort((a, b) => a - b).forEach(pct => {
        const ratio = pct / 100;
        const angle = 180 + (ratio * 180);
        const angleRad = angle * (Math.PI / 180);

        // Line from r72 (inner edge) to r80 (middle)
        let x1 = centerX + (72 * Math.cos(angleRad));
        let y1 = centerY + (72 * Math.sin(angleRad));
        let x2 = centerX + (80 * Math.cos(angleRad));
        let y2 = centerY + (80 * Math.sin(angleRad));

        let lx, ly;
        // Inner label (r62)
        if (angle === 180 || angle === 360) {
            lx = centerX + (66 * Math.cos(angleRad));
            ly = centerY + 15;
        } else {
            lx = centerX + (62 * Math.cos(angleRad));
            ly = centerY + (62 * Math.sin(angleRad)) + 4;
        }

        this.limitTicks.push({
            pct: pct, 
            line: { x1, y1, x2, y2 },
            label: { x: lx, y: ly, text: pct + '%', anchor: 'middle' }
        });
    });
  }
}