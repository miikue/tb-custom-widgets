import { Component, Input, ElementRef, AfterViewInit, OnDestroy, ChangeDetectorRef, OnChanges, SimpleChanges } from '@angular/core';

@Component({
  selector: 'tb-miikue-signalization',
  templateUrl: './miikue-signalization.component.html',
  styleUrls: ['./miikue-signalization.component.scss']
})
export class MiikueSignalizationComponent implements OnChanges {
  @Input() text: string;
  @Input() value: any;
  @Input() mapping: string = '';
  @Input() colorOn: string = 'green';
  @Input() colorOff: string = 'grey';
  @Input() size: number; // Explicit size for the LED

  dynamicFontSize: number;
  dynamicLedSize: number;
  ledColor: string = 'grey';

  constructor(private cd: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges) {
    // 1. Update sizes (always)
    this.dynamicLedSize = this.size ?? 20; // Default LED size
    this.dynamicFontSize = this.dynamicLedSize * 0.8; // Derived text size (e.g., 20 * 0.8 = 16px)

    // 2. Update LED color if relevant inputs change
    const valueChanged = changes.value;
    const mappingChanged = changes.mapping;
    const colorsChanged = changes.colorOn || changes.colorOff;

    if (valueChanged || mappingChanged || colorsChanged) {
      this.updateSignalColor();
    }

    // 3. Trigger change detection
    this.cd.detectChanges();
  }

  private updateSignalColor(): void {
    let matched = false;
    if (this.mapping && this.value !== undefined && this.value !== null) {
      const conditionParts = this.mapping.split(' '); // Split by space to allow multiple conditions (though user example only shows one)
      const dataValue = String(this.value);

      for (const part of conditionParts) {
        if (part.includes('|')) { // Handle multiple values: "1|2"
          const values = part.split('|');
          if (values.includes(dataValue)) {
            matched = true;
            break;
          }
        } else if (part.includes('-')) { // Handle range: "4-8"
          const [startStr, endStr] = part.split('-');
          const start = Number(startStr);
          const end = Number(endStr);
          const numValue = Number(dataValue);
          if (!isNaN(start) && !isNaN(end) && !isNaN(numValue) && numValue >= start && numValue <= end) {
            matched = true;
            break;
          }
        } else { // Handle single value: "1"
          if (part === dataValue) {
            matched = true;
            break;
          }
        }
      }
    }

    this.ledColor = matched ? this.colorOn : this.colorOff;
  }
}