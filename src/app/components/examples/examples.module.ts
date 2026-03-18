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
import { MiikueDialFveComponent } from '../miikue-dial-fve/miikue-dial-fve.component';
import { MiikueRegulaceComponent } from '../miikue-regulace/miikue-regulace.component';
import { MiikueLabelComponent } from '../miikue-label/miikue-label.component';
import { MiikueValueComponent } from '../miikue-value/miikue-value.component';
import { MiikueLedComponent } from '../miikue-led/miikue-led.component';
import { MiikueSignalizationComponent } from '../miikue-signalization/miikue-signalization.component';
import { MiikueLedListComponent } from '../miikue-led-list/miikue-led-list.component';
import { MiikueEnergieComponent } from '../miikue-energie/miikue-energie.component';
import { MiikueTimeFormatterComponent } from '../miikue-time-formatter/miikue-time-formatter.component';
import { MiikueCommunicationComponent } from '../miikue-communication/miikue-communication.component';
import { MiikueStavyComponent } from '../miikue-stavy/miikue-stavy.component';
import { MiikueChartLineComponent } from '../miikue-chart-line/miikue-chart-line.component';
import { MiikueChartLineBasicConfigComponent } from '../miikue-chart-line/chart-settings/miikue-chart-line-basic-config.component';
import { MiikueTimeWindowSelectorComponent } from '../miikue-time-window-selector/miikue-time-window-selector.component';
import { MiikueTimeInputComponent } from '../miikue-time-input/miikue-time-input.component';

// Angular Material Modules for Date Picker
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatNativeDateModule, MAT_DATE_LOCALE } from '@angular/material/core';


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
    MiikueDialFveComponent,
    MiikueRegulaceComponent,
    MiikueLabelComponent,
    MiikueValueComponent,
    MiikueLedComponent,
    MiikueSignalizationComponent,
    MiikueLedListComponent,
    MiikueEnergieComponent,
    MiikueTimeFormatterComponent,
    MiikueCommunicationComponent,
    MiikueStavyComponent,
    MiikueChartLineComponent,
    MiikueChartLineBasicConfigComponent,
    MiikueTimeWindowSelectorComponent,
    MiikueTimeInputComponent
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
    MatNativeDateModule
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
    MiikueDialFveComponent,
    MiikueRegulaceComponent,
    MiikueLabelComponent,
    MiikueValueComponent,
    MiikueLedComponent,
    MiikueSignalizationComponent,
    MiikueLedListComponent,
    MiikueEnergieComponent,
    MiikueTimeFormatterComponent,
    MiikueCommunicationComponent,
    MiikueStavyComponent,
    MiikueChartLineComponent,
    MiikueChartLineBasicConfigComponent,
    MiikueTimeWindowSelectorComponent,
    MiikueTimeInputComponent
  ],
    providers: [
    { provide: MAT_DATE_LOCALE, useValue: 'cs-CZ' }
  ]
})

export class ExamplesModule {
}
