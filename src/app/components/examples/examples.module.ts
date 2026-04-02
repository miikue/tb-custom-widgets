import { NgModule } from '@angular/core';
import { ExampleTableComponent } from './example-table/example-table.component';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import {
  BasicWidgetConfigModule,
  HomeComponentsModule,
  WidgetConfigComponentsModule
} from '@home/components/public-api';
import { ChartModule } from 'primeng/chart';
import { AddEntityComponent } from './example-action/add-entity.component';
import {
  ExampleTableCustomSettingsComponent
} from './example-table-with-custom-settings/example-table-custom-settings.component';
import {
  ExampleTableAdvancedConfigComponent
} from './example-table-with-custom-settings/advanced-config/example-table-advanced-config.component';
import {
  ExampleTableBasicConfigComponent
} from './example-table-with-custom-settings/basic-config/example-table-basic-config.component';
import {
  DataKeySettingsComponent
} from './example-table-with-custom-settings/data-key-settings/data-key-settings.component';
import {
  ExampleTableCustomSubscriptionComponent
} from './example-table-with-custom-subscription/example-table-custom-subscription.component';
import {
  ExampleOfUsingThirdPartyLibraryComponent
} from './example-of-using-third-party-library/example-of-using-third-party-library.component';
import { ExampleChartComponent } from './example-chart/example-chart.component';
import { ExampleChartSettingsComponent } from './example-chart/chart-settings/example-chart-settings.component';



// Miikue Components
import { MiikueDialPretokComponent } from '../miikue-dial-pretok/miikue-dial-pretok.component';
import { MiikueDialPretokBasicConfigComponent } from '../miikue-dial-pretok/basic-config/miikue-dial-pretok-basic-config.component';
import { MiikueDialFveComponent } from '../miikue-dial-fve/miikue-dial-fve.component';
import { MiikueDialFveBasicConfigComponent } from '../miikue-dial-fve/basic-config/miikue-dial-fve-basic-config.component';
import { MiikueRegulaceComponent } from '../miikue-regulace/miikue-regulace.component';
import { MiikueRegulaceBasicConfigComponent } from '../miikue-regulace/basic-config/miikue-regulace-basic-config.component';
import { MiikueDowlanderComponent } from '../miikue-dowlander/miikue-dowlander.component';
import { MiikueEnergieComponent } from '../miikue-energie/miikue-energie.component';
import { MiikueCommunicationComponent } from '../miikue-communication/miikue-communication.component';
import { MiikueStavyComponent } from '../miikue-stavy/miikue-stavy.component';
import { MiikueNotifikationCenterComponent } from '../miikue-notifikation-center/miikue-notifikation-center.component';
import { MiikueChartLineComponent } from '../miikue-chart-line/miikue-chart-line.component';
import { MiikueChartLineBasicConfigComponent } from '../miikue-chart-line/chart-settings/miikue-chart-line-basic-config.component';
import { MiikueTimeWindowSelectorComponent } from '../miikue-time-window-selector/miikue-time-window-selector.component';
import { MiikueChartEngineComponent } from '../miikue-chart-engine/miikue-chart-engine.component';
import { MiikueChartComponent } from '../miikue-chart/miikue-chart.component';

// Angular Material Modules for Date Picker
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatNativeDateModule, MAT_DATE_LOCALE } from '@angular/material/core';
import { FormsModule } from '@angular/forms';


@NgModule({
  declarations: [
    ExampleTableComponent,
    AddEntityComponent,
    ExampleTableCustomSettingsComponent,
    ExampleTableAdvancedConfigComponent,
    ExampleTableBasicConfigComponent,
    DataKeySettingsComponent,
    ExampleTableCustomSubscriptionComponent,
    ExampleOfUsingThirdPartyLibraryComponent,
    ExampleChartComponent,
    ExampleChartSettingsComponent,

    // Miikue Components
    MiikueDialPretokComponent,
    MiikueDialPretokBasicConfigComponent,
    MiikueDialFveComponent,
    MiikueDialFveBasicConfigComponent,
    MiikueRegulaceComponent,
    MiikueRegulaceBasicConfigComponent,
    MiikueDowlanderComponent,
    MiikueEnergieComponent,
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

        // Material
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatNativeDateModule,
    FormsModule
  ],
  exports: [
    ExampleTableComponent,
    AddEntityComponent,
    ExampleTableCustomSettingsComponent,
    ExampleTableAdvancedConfigComponent,
    ExampleTableBasicConfigComponent,
    DataKeySettingsComponent,
    ExampleTableCustomSubscriptionComponent,
    ExampleOfUsingThirdPartyLibraryComponent,
    ExampleChartComponent,
    ExampleChartSettingsComponent,


        // Miikue
    MiikueDialPretokComponent,
      MiikueDialPretokBasicConfigComponent,
    MiikueDialFveComponent,
    MiikueDialFveBasicConfigComponent,
    MiikueRegulaceComponent,
    MiikueRegulaceBasicConfigComponent,
    MiikueDowlanderComponent,
    MiikueEnergieComponent,
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

export class ExamplesModule {
}
