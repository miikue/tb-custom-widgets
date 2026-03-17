import { ChangeDetectorRef, Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';

interface MappingRule {
  status: string;
  message: string;
  match(value: number): boolean;
}

@Component({
  selector: 'tb-miikue-stavy',
  templateUrl: './miikue-stavy.component.html',
  styleUrls: ['./miikue-stavy.component.scss']
})
export class MiikueStavyComponent implements OnInit, OnChanges {

  @Input() ctx: any;
  @Input() textOn: string = 'ON';
  @Input() textOff: string = 'OFF';
  @Input() fullscreen: boolean = false;
  @Input() isOk: boolean = true;
  @Input() title: string = 'Stavy';

  @Input() colorOn: string = '#16a34a'; // Green
  @Input() colorOff: string = '#ef4444'; // Red
  @Input() colorMix: string = '#f97316'; // Orange
  @Input() textMix: string = 'MIX';

  // Internal State
  hasData: boolean = false;
  summaryLedColor: string = '#94a3b8'; // Default to grey

  public allStatuses: any[] = [];

  constructor(private cd: ChangeDetectorRef) {
  }

  ngOnInit(): void {

    if (this.ctx && this.ctx.$scope) {
      this.ctx.$scope.miikueStavyWidget = this;
    }
    this.refreshData();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['ctx'] || changes['isOk']) {
      if (this.ctx && this.ctx.$scope) {
        this.ctx.$scope.miikueStavyWidget = this;
      }
      this.refreshData();
    }
  }

  public onDataUpdated(): void {
    this.refreshData();
    this.cd.detectChanges();
  }

  private refreshData(): void {
    if (!this.ctx || !this.ctx.$scope) {
      return;
    }

    if (!this.isOk) {
      this.hasData = true; // Still 'has data' but it's bad data
      this.summaryLedColor = this.colorOff;
      this.allStatuses = (this.ctx.$scope.data || []).map(item => {
        const label = item.dataKey.label || item.dataKey.name;
        const cleanName = label.replace(/\[.*?\]/g, '').trim();
        return { name: cleanName, valueText: 'N/A', color: this.colorOff, isError: true, ts: 0 };
      });
      this.cd.detectChanges();
      return;
    }

    const data = this.ctx.$scope.data || [];
    this.hasData = data.length > 0;

    this.allStatuses = data.map(item => {
      const label = item.dataKey.label || item.dataKey.name;
      const rules = this.parseMapping(label); // Get array of rules
      const cleanName = label.replace(/\[.*?\]/g, '').trim();
      let statusObj = { name: cleanName, valueText: 'N/A', color: '#94a3b8', isError: true, ts: 0 };

      if (item.data && item.data.length > 0) {
        const lastPoint = item.data[item.data.length - 1];
        statusObj.ts = lastPoint[0];
        const rawVal = Number(lastPoint[1]);

        const matchingRule = rules.find(rule => rule.match(rawVal)); // Find the first matching rule

        if (matchingRule) {
          statusObj.isError = false;

          switch (matchingRule.status) {
            case 'on':
              statusObj.valueText = matchingRule.message || this.textOn;
              statusObj.color = this.colorOn;
              break;
            case 'off':
              statusObj.valueText = matchingRule.message || this.textOff;
              statusObj.color = this.colorOff;
              statusObj.isError = true;
              break;
            case 'mix':
              statusObj.valueText = matchingRule.message || this.textMix;
              statusObj.color = this.colorMix;
              statusObj.isError = true;
              break;
            default:
              statusObj.valueText = `CHYBA (${rawVal})`;
              statusObj.color = this.colorOff;
              statusObj.isError = true;
              break;
          }
        } else {
          // No mapping found
          statusObj.valueText = `NEZNÁMÝ (${rawVal})`;
          statusObj.color = this.colorOff; // Unmapped values are red
          statusObj.isError = true;
        }
      }
      // If no data, it remains in the default error state (N/A)
      if (statusObj.valueText === 'N/A') {
        statusObj.color = this.colorOff; 
      }
      return statusObj;
    });

    // Determine the summary LED color
    const hasRed = this.allStatuses.some(s => s.color === this.colorOff);
    const hasOrange = this.allStatuses.some(s => s.color === this.colorMix);

    if (hasRed) {
      this.summaryLedColor = this.colorOff;
    } else if (hasOrange) {
      this.summaryLedColor = this.colorMix;
    } else {
      this.summaryLedColor = this.colorOn;
    }
    
    // If there is no data at all, the LED should be grey
    if (!this.hasData || this.allStatuses.length === 0) {
        this.summaryLedColor = '#94a3b8';
    }

    this.cd.detectChanges();
  }

  private parseMapping(label: string): MappingRule[] {
    const rules: MappingRule[] = [];
    const bracketContentMatch = label.match(/\[(.*?)\]/);
    if (!bracketContentMatch) return rules;

    const content = bracketContentMatch[1];
    const parts = content.split(/\s+/);

    const entryRegex = /([\d,\-]+)=([a-zA-Z]+)(?:\((.*?)\))?/; // Updated regex for key part

    parts.forEach(part => {
      const match = part.match(entryRegex);
      if (match) {
        const keyPart = match[1];
        const status = match[2].toLowerCase();
        const message = match[3] || '';

        let matchFunction: (value: number) => boolean;

        if (keyPart.includes('-')) { // Range
          const [minStr, maxStr] = keyPart.split('-');
          const min = Number(minStr);
          const max = Number(maxStr);
          if (!isNaN(min) && !isNaN(max)) {
            matchFunction = (value: number) => value >= min && value <= max;
          }
        } else if (keyPart.includes(',')) { // List of values
          const values = keyPart.split(',').map(Number).filter(n => !isNaN(n));
          if (values.length > 0) {
            matchFunction = (value: number) => values.includes(value);
          }
        } else { // Single value
          const singleValue = Number(keyPart);
          if (!isNaN(singleValue)) {
            matchFunction = (value: number) => value === singleValue;
          }
        }

        if (matchFunction) {
          rules.push({ status, message, match: matchFunction });
        }
      }
    });
    return rules;
  }
}