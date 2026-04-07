import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SharedModule } from '@shared/public-api';
import {
  BasicWidgetConfigModule,
  HomeComponentsModule,
  WidgetConfigComponentsModule
} from '@home/components/public-api';
import { ChartModule } from 'primeng/chart';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatNativeDateModule, MAT_DATE_LOCALE } from '@angular/material/core';

import { MiikueDialPretokComponent } from './miikue-dial-pretok/miikue-dial-pretok.component';
import { MiikueDialPretokBasicConfigComponent } from './miikue-dial-pretok/basic-config/miikue-dial-pretok-basic-config.component';
import { MiikueDialFveComponent } from './miikue-dial-fve/miikue-dial-fve.component';
import { MiikueDialFveBasicConfigComponent } from './miikue-dial-fve/basic-config/miikue-dial-fve-basic-config.component';
import { MiikueRegulaceComponent } from './miikue-regulace/miikue-regulace.component';
import { MiikueRegulaceBasicConfigComponent } from './miikue-regulace/basic-config/miikue-regulace-basic-config.component';
import { MiikueDowlanderComponent } from './miikue-dowlander/miikue-dowlander.component';
import { MiikueCommunicationComponent } from './miikue-communication/miikue-communication.component';
import { MiikueStavyComponent } from './miikue-stavy/miikue-stavy.component';
import { MiikueNotifikationCenterComponent } from './miikue-notifikation-center/miikue-notifikation-center.component';
import { MiikueChartLineComponent } from './miikue-chart-line/miikue-chart-line.component';
import { MiikueChartLineBasicConfigComponent } from './miikue-chart-line/chart-settings/miikue-chart-line-basic-config.component';
import { MiikueTimeWindowSelectorComponent } from './miikue-time-window-selector/miikue-time-window-selector.component';
import { MiikueChartEngineComponent } from './miikue-chart-engine/miikue-chart-engine.component';
import { MiikueChartComponent } from './miikue-chart/miikue-chart.component';

@NgModule({
  declarations: [
    MiikueDialPretokComponent,
    MiikueDialPretokBasicConfigComponent,
    MiikueDialFveComponent,
    MiikueDialFveBasicConfigComponent,
    MiikueRegulaceComponent,
    MiikueRegulaceBasicConfigComponent,
    MiikueDowlanderComponent,
    MiikueCommunicationComponent,
    MiikueStavyComponent,
    MiikueNotifikationCenterComponent,
    MiikueChartLineComponent,
    MiikueChartLineBasicConfigComponent,
    MiikueTimeWindowSelectorComponent,
    MiikueChartEngineComponent,
    MiikueChartComponent
  ],
  imports: [
    CommonModule,
    SharedModule,
    HomeComponentsModule,
    ChartModule,
    BasicWidgetConfigModule,
    WidgetConfigComponentsModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatNativeDateModule,
    FormsModule
  ],
  exports: [
    MiikueDialPretokComponent,
    MiikueDialPretokBasicConfigComponent,
    MiikueDialFveComponent,
    MiikueDialFveBasicConfigComponent,
    MiikueRegulaceComponent,
    MiikueRegulaceBasicConfigComponent,
    MiikueDowlanderComponent,
    MiikueCommunicationComponent,
    MiikueStavyComponent,
    MiikueNotifikationCenterComponent,
    MiikueChartLineComponent,
    MiikueChartLineBasicConfigComponent,
    MiikueTimeWindowSelectorComponent,
    MiikueChartEngineComponent,
    MiikueChartComponent
  ],
  providers: [
    { provide: MAT_DATE_LOCALE, useValue: 'cs-CZ' }
  ]
})
export class CommonComponentsModule {}
