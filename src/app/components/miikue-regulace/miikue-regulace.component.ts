import { ChangeDetectorRef, Component, Input, OnChanges, OnInit, SimpleChanges, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'tb-miikue-regulace',
  templateUrl: './miikue-regulace.component.html',
  styleUrls: ['./miikue-regulace.component.scss']
})
export class MiikueRegulaceComponent implements OnInit, OnChanges {

  @Input() ctx: any;
  @Input() textOn: string = 'AKTIVNÍ';
  @Input() textOff: string = 'NEAKTIVNÍ';

  @Input() isOk: boolean = true;
  @Input() badText: string = 'NEAKTUÁLNÍ DATA';
  @Input() badColor: string = '#ef4444';

  // Data properties
  options: Array<{ value: number, label: string }> = [];
  activeValue: number = -1;
  
  // Visual state
  psdOut: string = '0';
  psdLabel: string = '--';
  psdUnit: string = '';
  
  // Regulation Status (3rd Input)
  regStatusText: string = '-';
  regStatusColor: string = '#94a3b8';
  regStatusMap: { [key: number]: string } = {};
  lastRegStatusLabel: string = '';

  currentMode: string = '-';
  modeColor: string = '#333';

  private lastLabel: string = '';

  constructor(private cd: ChangeDetectorRef) {}

  ngOnInit(): void {
      if (this.ctx && this.ctx.$scope) {
          this.ctx.$scope.miikueRegulaceWidget = this;
      }
      this.onInit();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['ctx'] && this.ctx && this.ctx.$scope) {
        this.ctx.$scope.miikueRegulaceWidget = this;
    }
    if (changes['isOk'] || changes['ctx']) {
        this.refreshData();
    }
  }

  public onInit(): void {
      this.refreshData();
  }

  public onDataUpdated(): void {
      this.refreshData();
      this.cd.detectChanges();
  }

  private refreshData(): void {
      if (!this.isOk) {
          this.psdOut = 'N/A';
          this.regStatusText = this.badText;
          this.regStatusColor = this.badColor;
          
          this.activeValue = -1;
          this.currentMode = '-';
          this.modeColor = '#94a3b8';

          this.cd.detectChanges();
          return;
      }

      if (!this.ctx || !this.ctx.defaultSubscription) return;

      const data = this.ctx.$scope.data;
      if (data && data.length > 0) {
          // 1. Process First Data Source (The Switch/Regulace)
          const regulaceItem = data[0];
          
          const label = regulaceItem.dataKey.label || regulaceItem.dataKey.name;
          if (label && label !== this.lastLabel) {
              this.parseOptions(label);
              this.lastLabel = label;
          }

          if (regulaceItem.data && regulaceItem.data.length) {
              const latestPoint = regulaceItem.data[regulaceItem.data.length - 1];
              this.activeValue = Number(latestPoint[1]);
              this.updateCurrentModeDisplay(); 
          }
          
          // 2. Process Second Data Source (PSD Value)
          if (data.length > 1) {
              const psdItem = data[1];
              this.psdLabel = psdItem.dataKey.label || psdItem.dataKey.name || 'Value';
              this.psdUnit = psdItem.dataKey.units || '';
              const decimals = (psdItem.dataKey.decimals !== undefined && psdItem.dataKey.decimals !== null) ? psdItem.dataKey.decimals : 1;

              if (psdItem.data && psdItem.data.length) {
                  const val = Number(psdItem.data[psdItem.data.length - 1][1]);
                  this.psdOut = this.formatTruncated(val, decimals);
              }
          }

          // 3. Process Third Data Source (Regulation Status)
          if (data.length > 2) {
              const statusItem = data[2];
              const sLabel = statusItem.dataKey.label;
              
              if (sLabel && sLabel !== this.lastRegStatusLabel) {
                  this.parseStatusMap(sLabel);
                  this.lastRegStatusLabel = sLabel;
              }

              if (statusItem.data && statusItem.data.length) {
                  const sVal = Number(statusItem.data[statusItem.data.length - 1][1]);
                  this.updateStatusDisplay(sVal);
              }
          }
      }
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

  private parseOptions(label: string): void {
      this.options = [];
      const matches = label.matchAll(/\[(.*?)\]/g);
      for (const match of matches) {
          const content = match[1];
          if (content.includes('=')) {
              const parts = content.split(/\s+/);
              parts.forEach(part => {
                  const eqIndex = part.indexOf('=');
                  if (eqIndex > -1) {
                      const valStr = part.substring(0, eqIndex);
                      const lblStr = part.substring(eqIndex + 1);
                      
                      if (!isNaN(Number(valStr))) {
                          this.options.push({
                              value: Number(valStr),
                              label: lblStr
                          });
                      }
                  }
              });
          }
      }
  }

  private parseStatusMap(label: string): void {
      this.regStatusMap = {};
      const matches = label.matchAll(/\[(.*?)\]/g);
      for (const match of matches) {
          const content = match[1];
          if (content.includes('=')) {
              const parts = content.split(/\s+/);
              parts.forEach(part => {
                  const eqIndex = part.indexOf('=');
                  if (eqIndex > -1) {
                      const key = Number(part.substring(0, eqIndex));
                      const val = part.substring(eqIndex + 1);
                      if (!isNaN(key)) {
                          this.regStatusMap[key] = val;
                      }
                  }
              });
          }
      }
  }

  private updateStatusDisplay(val: number): void {
      const labelRaw = this.regStatusMap[val];
      const label = (labelRaw || '').toLowerCase();
      
      //console.log('MiikueRegulace: updateStatusDisplay', { val, labelRaw, label, map: this.regStatusMap });

      if (label.includes('on')) {
          this.regStatusText = this.textOn || 'AKTIVNÍ';
          this.regStatusColor = '#16a34a'; // Green
      } else if (label.includes('off')) {
          this.regStatusText = this.textOff || 'NEAKTIVNÍ';
          this.regStatusColor = this.badColor; // Use badColor for OFF state
      } else {
          // Fallback if no on/off instruction found
          if (labelRaw) {
              this.regStatusText = labelRaw;
              this.regStatusColor = '#f97316'; // Orange (Unknown semantic)
          }
          else {
              this.regStatusText = '--';
              this.regStatusColor = '#94a3b8';
          }
      }
  }

  private updateCurrentModeDisplay(): void {
      const activeOpt = this.options.find(o => o.value === this.activeValue);
      if (activeOpt) {
          this.currentMode = activeOpt.label;
          
          const index = this.options.indexOf(activeOpt);
          const middleIndex = Math.floor(this.options.length / 2);

          if (this.options.length % 2 !== 0 && index === middleIndex) {
               this.modeColor = '#16a34a'; // Green (Middle)
          } else {
               this.modeColor = '#ea580c'; // Orange (Others)
          }
      } else {
          this.currentMode = 'Neznámý';
          this.modeColor = this.badColor;
      }
  }
  
  public getOptionClass(opt: {value: number, label: string}): string {
      if (this.activeValue !== opt.value) return '';
      
      const index = this.options.indexOf(opt);
      const middleIndex = Math.floor(this.options.length / 2);

      // If we have an odd number of items, the exact middle is green.
      // If even, no single middle exists (or you could pick one), but standard is odd (e.g. 5 options).
      if (this.options.length % 2 !== 0 && index === middleIndex) {
          return 'active-0'; // Green
      }
      
      return 'active-c'; // Orange for everything else
  }
}
