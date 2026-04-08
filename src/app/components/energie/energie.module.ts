import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CommonComponentsModule } from '../common/common.module';
import { MiikueIrisXComponent } from './miikue-iris-x/miikue-iris-x.component';
import { MiikueSpotrebaGrafComponent } from './miikue-spotreba-graf/miikue-spotreba-graf.component';
import {
  MiikueSpotrebaGrafEngineComponent
} from './miikue-spotreba-graf/engine/miikue-spotreba-graf-engine.component';
import { MiikueSpotrebaGrafKwhComponent } from './miikue-spotreba-graf-kwh/miikue-spotreba-graf-kwh.component';
import {
  MiikueSpotrebaGrafKwhEngineComponent
} from './miikue-spotreba-graf-kwh/engine/miikue-spotreba-graf-kwh-engine.component';

@NgModule({
  declarations: [
    MiikueIrisXComponent,
    MiikueSpotrebaGrafComponent,
    MiikueSpotrebaGrafEngineComponent,
    MiikueSpotrebaGrafKwhComponent,
    MiikueSpotrebaGrafKwhEngineComponent
  ],
  imports: [CommonModule, CommonComponentsModule],
  exports: [
    MiikueIrisXComponent,
    MiikueSpotrebaGrafComponent,
    MiikueSpotrebaGrafEngineComponent,
    MiikueSpotrebaGrafKwhComponent,
    MiikueSpotrebaGrafKwhEngineComponent
  ]
})
export class EnergieComponentsModule {}
