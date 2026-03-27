import { Component } from '@angular/core';
import { BasicWidgetConfigComponent } from '@home/components/public-api';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { WidgetConfigComponentData } from '@home/models/widget-component.models';
import { AppState } from '@core/public-api';
import { Store } from '@ngrx/store';
import { WidgetConfigComponent } from '@home/components/widget/widget-config.component';
import { DataKey, Datasource } from '@shared/public-api';

@Component({
  selector: 'tb-miikue-dial-fve-basic-config',
  templateUrl: './miikue-dial-fve-basic-config.component.html',
  styleUrls: [],
  standalone: false
})
export class MiikueDialFveBasicConfigComponent extends BasicWidgetConfigComponent {

  private readonly defaults = {
    maxLimit: 300,
    productionColor: '#eab308',
    limitColor: '#ef4444',
    badColor: '#ef4444',
    limitText: 'OMEZENO NA {value}%',
    errorText: 'NEZNÁMÝ STAV LIMITU',
    okText: 'NE-OMEZENO',
    badText: 'NEAKTUÁLNÍ DATA'
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
      productionColor: [this.getStringSetting(settings.productionColor, this.defaults.productionColor), [Validators.required]],
      limitColor: [this.getStringSetting(settings.limitColor, this.defaults.limitColor), [Validators.required]],
      badColor: [this.getStringSetting(settings.badColor, this.defaults.badColor), [Validators.required]],
      limitText: [this.getStringSetting(settings.limitText, this.defaults.limitText), [Validators.required]],
      errorText: [this.getStringSetting(settings.errorText, this.defaults.errorText), [Validators.required]],
      okText: [this.getStringSetting(settings.okText ?? settings.OkText, this.defaults.okText), [Validators.required]],
      badText: [this.getStringSetting(settings.badText, this.defaults.badText), [Validators.required]],
      actions: [configData.config.actions || {}, []]
    });
  }

  protected prepareOutputConfig(config: any): WidgetConfigComponentData {
    const parsedMaxLimit = Number(config.maxLimit);
    const maxLimit = Number.isFinite(parsedMaxLimit) && parsedMaxLimit > 0 ? parsedMaxLimit : 300;

    this.widgetConfig.config.datasources = config.datasources;
    this.widgetConfig.config.actions = config.actions;
    this.widgetConfig.config.settings = {
      ...(this.widgetConfig.config.settings || {}),
      maxLimit,
      productionColor: this.getStringSetting(config.productionColor, this.defaults.productionColor),
      limitColor: this.getStringSetting(config.limitColor, this.defaults.limitColor),
      badColor: this.getStringSetting(config.badColor, this.defaults.badColor),
      limitText: this.getStringSetting(config.limitText, this.defaults.limitText),
      errorText: this.getStringSetting(config.errorText, this.defaults.errorText),
      okText: this.getStringSetting(config.okText, this.defaults.okText),
      badText: this.getStringSetting(config.badText, this.defaults.badText)
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
