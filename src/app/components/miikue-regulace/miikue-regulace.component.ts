import { ChangeDetectorRef, Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';

@Component({
  selector: 'tb-miikue-regulace',
  templateUrl: './miikue-regulace.component.html',
  styleUrls: ['./miikue-regulace.component.scss']
})
export class MiikueRegulaceComponent implements OnInit, OnChanges {

    private readonly defaultTextOn = 'AKTIVNÍ';
    private readonly defaultTextOff = 'NEAKTIVNÍ';
    private readonly defaultBadText = 'NEAKTUÁLNÍ DATA';
    private readonly defaultBadColor = '#ef4444';

  @Input() ctx: any;
    @Input() textOn: string = this.defaultTextOn;
    @Input() textOff: string = this.defaultTextOff;

  @Input() isOk: boolean = true;
    @Input() badText: string = this.defaultBadText;
    @Input() badColor: string = this.defaultBadColor;

  // Data properties
  options: Array<{ value: number, label: string }> = [];
  activeValue: number = -1;
    selectedOptionValue: number | null = null;
  
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
    this.applySettingsFromCtx();
    if (changes['isOk'] || changes['ctx']) {
        this.refreshData();
    }
  }

  public onInit(): void {
      this.applySettingsFromCtx();
      this.refreshData();
  }

  public onDataUpdated(): void {
      this.applySettingsFromCtx();
      this.refreshData();
      this.cd.detectChanges();
  }

  private applySettingsFromCtx(): void {
      const settings = this.ctx?.settings;
      if (!settings) {
          return;
      }

      this.textOn = this.pickStringSetting(settings.textOn, this.textOn, this.defaultTextOn);
      this.textOff = this.pickStringSetting(settings.textOff, this.textOff, this.defaultTextOff);
      this.badText = this.pickStringSetting(settings.badText, this.badText, this.defaultBadText);
      this.badColor = this.pickStringSetting(settings.badColor, this.badColor, this.defaultBadColor);
  }

  private pickStringSetting(value: any, currentValue: string, fallback: string): string {
      if (typeof value === 'string' && value.trim().length) {
          return value;
      }
      if (typeof currentValue === 'string' && currentValue.trim().length) {
          return currentValue;
      }
      return fallback;
  }

  private refreshData(): void {
      if (!this.isOk) {
          this.psdOut = 'N/A';
          this.regStatusText = this.badText;
          this.regStatusColor = this.badColor;
          
          this.activeValue = -1;
          this.selectedOptionValue = null;
          this.currentMode = '-';
          this.modeColor = '#94a3b8';

          this.cd.detectChanges();
          return;
      }

    if (!this.ctx || !this.ctx.$scope) return;

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
              this.ensureFallbackOption();
              this.updateSelectedOptionValue();
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
              const sLabel = statusItem.dataKey?.label || statusItem.dataKey?.name;
              
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
              // Support both legacy space-separated and new underscore-separated pairs.
              // Split on whitespace or on "_" only when it starts another numeric key (e.g. _2=).
              const parts = content.split(/(?:\s+|_(?=\d+=))/);
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
      this.ensureFallbackOption();
      this.updateSelectedOptionValue();
  }

  private parseStatusMap(label: string): void {
      this.regStatusMap = {};
      const matches = label.matchAll(/\[(.*?)\]/g);
      for (const match of matches) {
          const content = match[1];
          if (content.includes('=')) {
              // Support both legacy space-separated and new underscore-separated pairs.
              // Split on whitespace or on "_" only when it starts another numeric key (e.g. _2=).
              const parts = content.split(/(?:\s+|_(?=\d+=))/);
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
      const activeOpt = this.options.find(o => o.value === this.selectedOptionValue);
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

  private updateSelectedOptionValue(): void {
      if (!this.options.length) {
          this.selectedOptionValue = null;
          return;
      }

      const exactMatch = this.options.find(o => o.value === this.activeValue);
      if (exactMatch) {
          this.selectedOptionValue = exactMatch.value;
          return;
      }

      const roundedValue = Math.round(this.activeValue);
      const roundedMatch = this.options.find(o => o.value === roundedValue);
      if (roundedMatch) {
          this.selectedOptionValue = roundedMatch.value;
          return;
      }

      this.selectedOptionValue = this.options[0].value;
  }

  private ensureFallbackOption(): void {
      if (this.options.length) {
          return;
      }
      if (!Number.isFinite(this.activeValue)) {
          return;
      }
      this.options = [{
          value: this.activeValue,
          label: this.activeValue.toString()
      }];
  }

  public isOptionActive(opt: { value: number, label: string }): boolean {
      return this.selectedOptionValue === opt.value;
  }

  public isMiddleOption(opt: { value: number, label: string }): boolean {
      if (!this.options.length) {
          return false;
      }
      const index = this.options.indexOf(opt);
      const middleIndex = Math.floor(this.options.length / 2);
      return this.options.length % 2 !== 0 && index === middleIndex;
  }
  
  public trackByOption(index: number, opt: { value: number, label: string }): string {
      return `${opt?.value ?? index}-${opt?.label ?? ''}`;
  }
}
