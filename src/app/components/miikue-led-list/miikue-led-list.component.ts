import { Component, Input, ElementRef, AfterViewInit, OnDestroy, ChangeDetectorRef, OnChanges, SimpleChanges } from '@angular/core';

interface LedItem {
  valueToMatch: string[];
  label: string;
  color: string;
}

@Component({
  selector: 'tb-miikue-led-list',
  templateUrl: './miikue-led-list.component.html',
  styleUrls: ['./miikue-led-list.component.scss']
})
export class MiikueLedListComponent implements OnChanges {
  @Input() text: string;
  @Input() mapping: string = '';
  @Input() sizeText: number;
  @Input() sizeLed: number;
  @Input() sizeLedText: number; // Explicit size for the LED label font
  @Input() value: any;
  @Input() colorOn: string = 'green';
  @Input() colorOff: string = 'grey';

  // For the template
  ledList: LedItem[] = [];

  // For dynamic sizing
  dynamicTitleSize: number;
  dynamicLedSize: number;

  dynamicLedLabelSize: number;
  ready = false;

  constructor(private elementRef: ElementRef, private cd: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    let mappingOrNameChanged = changes.mapping;
    let valueChanged = changes.value;
    let colorsChanged = changes.colorOn || changes.colorOff;

    // 1. Update the LED list if mapping changes
    if (mappingOrNameChanged) {
      this.updateLedList();
    }

    // 2. Always apply sizes, using new defaults if inputs are not provided.
    this.dynamicTitleSize = this.sizeText ?? 16;
    this.dynamicLedSize = this.sizeLed ?? 20;
    this.dynamicLedLabelSize = this.sizeLedText ?? 14;

    // 3. Update LED colors if value, mapping, or colors change.
    if (valueChanged || mappingOrNameChanged || colorsChanged) {
      this.updateLedColors();
    }

    // 4. Set ready to true after initial setup is complete.
    if (!this.ready) {
        this.ready = true;
    }
    
    this.cd.detectChanges();
  }

  private updateLedList(): void {
    let ledConfigString: string | null = null;

    // Check 'mapping' input (now strictly a string)
    if (this.mapping) {
      let mappingString = this.mapping.trim();
      const bracketMatch = mappingString.match(/(\[.*?\])/);
      if (bracketMatch && bracketMatch[1]) {
        // Format with brackets, e.g., "NAME [...]" or "[...]"
        ledConfigString = bracketMatch[1].trim();
      } else if (!mappingString.includes('[')) {
        // Format without brackets, e.g., "1=0% 2=0%"
        ledConfigString = mappingString;
      }
    }

    // 3. Parse the determined ledConfigString
    if (ledConfigString) {
      this.ledList = ledConfigString.split(' ')
        .map(pair => pair.trim())
        .filter(pair => pair && pair.includes('='))
        .map(pair => {
          const parts = pair.split('=');
          const valueToMatch = parts[0].trim().split('|');
          const label = parts[1].trim();

          // Use the inactive color as the default.
          const color = this.colorOff;

          return { valueToMatch, label, color };
        });
    } else if (ledConfigString === null) { // mapping is always a string, so no need to check type
        this.ledList = [];
    }
  }

  private updateLedColors(): void {
    if (!this.ledList || this.ledList.length === 0) {
      return;
    }

    this.ledList.forEach(led => {
      // Compare value with the array of values to match
      if (led.valueToMatch.includes(String(this.value))) {
        led.color = this.colorOn; // Active color
      } else {
        led.color = this.colorOff; // Inactive color
      }
    });
  }
}
