import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CommonComponentsModule } from '../common/common.module';
import { MiikueIrisXComponent } from './miikue-iris-x/miikue-iris-x.component';
import { MiikueSpotrebaGrafComponent } from './miikue-spotreba-graf/miikue-spotreba-graf.component';
import {
  MiikueSpotrebaGrafEngineComponent
} from './miikue-spotreba-graf/engine/miikue-spotreba-graf-engine.component';

@NgModule({
  declarations: [
    MiikueIrisXComponent,
    MiikueSpotrebaGrafComponent,
    MiikueSpotrebaGrafEngineComponent
  ],
  imports: [CommonModule, CommonComponentsModule],
  exports: [
    MiikueIrisXComponent,
    MiikueSpotrebaGrafComponent,
    MiikueSpotrebaGrafEngineComponent
  ]
})
export class EnergieComponentsModule {}
