import { Component, Input } from '@angular/core';

@Component({
  selector: 'tb-miikue-led',
  templateUrl: './miikue-led.component.html',
  styleUrls: ['./miikue-led.component.scss']
})
export class MiikueLedComponent {
  @Input() size = 20;
  @Input() color = 'grey';
}
