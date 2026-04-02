///
/// Copyright © 2023 ThingsBoard, Inc.
///

import { NgModule } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import addCustomWidgetLocale from './locale/custom-widget-locale.constant';
import { CommonModule } from '@angular/common';
import { ExamplesModule } from './components/examples/examples.module';
import { addLibraryStyles } from './scss/lib-styles';

import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent } from 'echarts/components';
import { NgxEchartsModule } from 'ngx-echarts';

echarts.use([BarChart, LineChart, PieChart, CanvasRenderer, SVGRenderer, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent]);

@NgModule({
  declarations: [],
  imports: [
    CommonModule,
    NgxEchartsModule.forRoot({echarts})
  ],
  exports: [
    ExamplesModule,
    NgxEchartsModule
  ]
})
export class ThingsboardExtensionWidgetsModule {

  constructor(translate: TranslateService) {
    addCustomWidgetLocale(translate);
    addLibraryStyles('tb-extension-css');
  }

}
