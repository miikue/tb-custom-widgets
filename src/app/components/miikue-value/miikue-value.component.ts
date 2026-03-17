import { Component, Input, ElementRef, AfterViewInit, OnDestroy, ChangeDetectorRef, OnChanges, SimpleChanges } from '@angular/core';

@Component({
  selector: 'tb-miikue-value',
  templateUrl: './miikue-value.component.html',
  styleUrls: ['./miikue-value.component.scss']
})
export class MiikueValueComponent implements OnChanges {
  @Input() text: string;
  @Input() value: string;
  @Input() color: string;
  @Input() size: number; // Explicit size for the value font

  dynamicFontSize: number;
  dynamicValueFontSize: number;

  constructor(private cd: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (this.size) { // If 'size' input is explicitly provided
      this.dynamicValueFontSize = this.size;
      this.dynamicFontSize = this.size - 4;
    } else { // If 'size' input is not provided, use new defaults
      this.dynamicValueFontSize = 22; // Default for value
      this.dynamicFontSize = 18;     // Default for label
    }
    this.cd.detectChanges(); // Ensure view updates
  }
}