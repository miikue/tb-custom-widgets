import { Component } from '@angular/core';
import { BasicWidgetConfigComponent } from '@home/components/public-api';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { WidgetConfigComponentData } from '@home/models/widget-component.models';
import { AppState } from '@core/public-api';
import { Store } from '@ngrx/store';
import { WidgetConfigComponent } from '@home/components/widget/widget-config.component';
import { DataKey, Datasource } from '@shared/public-api';

@Component({
  selector: 'tb-miikue-regulace-basic-config',
  templateUrl: './miikue-regulace-basic-config.component.html',
  styleUrls: [],
  standalone: false
})
export class MiikueRegulaceBasicConfigComponent extends BasicWidgetConfigComponent {

  private readonly defaults = {
    textOn: 'AKTIVNÍ',
    textOff: 'NEAKTIVNÍ',
    badText: 'NEAKTUÁLNÍ DATA',
    badColor: '#ef4444'
  };

  public configFormGroup: FormGroup;
  public basicMode = this.basicMode;

  public get datasource(): Datasource | null {
    const datasources: Datasource[] = this.configFormGroup.get('datasources').value;
    if (datasources && datasources.length) {
      return datasources[0];
    }
    return null;
  }

  constructor(protected store: Store<AppState>,
              protected widgetConfigComponent: WidgetConfigComponent,
              private fb: FormBuilder) {
    super(store, widgetConfigComponent);
  }

  protected configForm(): FormGroup {
    return this.configFormGroup;
  }

  protected onConfigSet(configData: WidgetConfigComponentData): void {
    const settings = configData.config.settings || {};

    this.configFormGroup = this.fb.group({
      datasources: [configData.config.datasources, []],
      dataKeys: [this.getDataKeys(configData.config.datasources), []],
      textOn: [this.getStringSetting(settings.textOn, this.defaults.textOn), [Validators.required]],
      textOff: [this.getStringSetting(settings.textOff, this.defaults.textOff), [Validators.required]],
      badText: [this.getStringSetting(settings.badText, this.defaults.badText), [Validators.required]],
      badColor: [this.getStringSetting(settings.badColor, this.defaults.badColor), [Validators.required]],
      actions: [configData.config.actions || {}, []]
    });
  }

  protected prepareOutputConfig(config: any): WidgetConfigComponentData {
    this.widgetConfig.config.datasources = config.datasources;
    this.widgetConfig.config.actions = config.actions;
    this.widgetConfig.config.settings = {
      ...(this.widgetConfig.config.settings || {}),
      textOn: this.getStringSetting(config.textOn, this.defaults.textOn),
      textOff: this.getStringSetting(config.textOff, this.defaults.textOff),
      badText: this.getStringSetting(config.badText, this.defaults.badText),
      badColor: this.getStringSetting(config.badColor, this.defaults.badColor)
    };

    this.setDataKeys(config.dataKeys, this.widgetConfig.config.datasources);
    return this.widgetConfig;
  }

  private getStringSetting(value: any, fallback: string): string {
    return typeof value === 'string' && value.trim().length ? value : fallback;
  }

  private getDataKeys(datasources?: Datasource[]): DataKey[] {
    if (datasources && datasources.length) {
      return datasources[0].dataKeys || [];
    }
    return [];
  }

  private setDataKeys(dataKeys: DataKey[], datasources?: Datasource[]) {
    if (datasources && datasources.length) {
      datasources[0].dataKeys = dataKeys;
    }
  }
}
