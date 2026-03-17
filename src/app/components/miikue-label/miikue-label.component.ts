import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';

@Component({
  selector: 'tb-miikue-label',
  templateUrl: './miikue-label.component.html',
  styleUrls: ['./miikue-label.component.scss']
})
export class MiikueLabelComponent implements OnChanges {
  @Input() size: number = 25;
  @Input() text: string = '';
  @Input() bold: boolean = true;
  @Input() top: number = 0;
  @Input() bottom: number = 0;

  dynamicFontSize: number;
  dynamicFontWeight: string | number;

  ngOnChanges(changes: SimpleChanges): void {
    this.dynamicFontSize = this.size ?? 25;
    this.dynamicFontWeight = this.bold ? 'bold' : 'normal';
  }
}
