import { Component } from '@angular/core';
import { BasicWidgetConfigComponent } from '@home/components/public-api';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { WidgetConfigComponentData } from '@home/models/widget-component.models';
import { AppState } from '@core/public-api';
import { Store } from '@ngrx/store';
import { WidgetConfigComponent } from '@home/components/widget/widget-config.component';
import { DataKey, Datasource } from '@shared/public-api';

@Component({
  selector: 'tb-miikue-dial-pretok-basic-config',
  templateUrl: './miikue-dial-pretok-basic-config.component.html',
  styleUrls: [],
  standalone: false
})
export class MiikueDialPretokBasicConfigComponent extends BasicWidgetConfigComponent {

  private readonly defaults = {
    maxLimit: 400,
    pDeliveryColor: '#22c55e',
    pConsumptionColor: '#f97316',
    pText: 'DODÁVKA DO SÍTĚ',
    qText: 'ODBĚR ZE SÍTĚ',
    neutralText: 'NEČINNÉ',
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
      maxLimit: [this.getMaxLimit(settings), [Validators.required, Validators.min(1)]],
      pDeliveryColor: [this.getStringSetting(settings.pDeliveryColor, this.defaults.pDeliveryColor), [Validators.required]],
      pConsumptionColor: [this.getStringSetting(settings.pConsumptionColor, this.defaults.pConsumptionColor), [Validators.required]],
      pText: [this.getStringSetting(settings.pText, this.defaults.pText), [Validators.required]],
      qText: [this.getStringSetting(settings.qText, this.defaults.qText), [Validators.required]],
      neutralText: [this.getStringSetting(settings.neutralText, this.defaults.neutralText), [Validators.required]],
      badText: [this.getStringSetting(settings.badText, this.defaults.badText), [Validators.required]],
      badColor: [this.getStringSetting(settings.badColor, this.defaults.badColor), [Validators.required]],
      actions: [configData.config.actions || {}, []]
    });
  }

  protected prepareOutputConfig(config: any): WidgetConfigComponentData {
    const parsedMaxLimit = Number(config.maxLimit);
    const maxLimit = Number.isFinite(parsedMaxLimit) && parsedMaxLimit > 0
      ? parsedMaxLimit
      : this.defaults.maxLimit;

    this.widgetConfig.config.datasources = config.datasources;
    this.widgetConfig.config.actions = config.actions;
    this.widgetConfig.config.settings = {
      ...(this.widgetConfig.config.settings || {}),
      maxLimit,
      pDeliveryColor: this.getStringSetting(config.pDeliveryColor, this.defaults.pDeliveryColor),
      pConsumptionColor: this.getStringSetting(config.pConsumptionColor, this.defaults.pConsumptionColor),
      pText: this.getStringSetting(config.pText, this.defaults.pText),
      qText: this.getStringSetting(config.qText, this.defaults.qText),
      neutralText: this.getStringSetting(config.neutralText, this.defaults.neutralText),
      badText: this.getStringSetting(config.badText, this.defaults.badText),
      badColor: this.getStringSetting(config.badColor, this.defaults.badColor)
    };

    this.setDataKeys(config.dataKeys, this.widgetConfig.config.datasources);
    return this.widgetConfig;
  }

  private getMaxLimit(settings?: any): number {
    const value = Number(settings?.maxLimit);
    return Number.isFinite(value) && value > 0 ? value : this.defaults.maxLimit;
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
