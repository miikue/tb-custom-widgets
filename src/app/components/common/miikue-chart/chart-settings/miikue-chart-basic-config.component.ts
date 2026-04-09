import { Component } from '@angular/core';
import { BasicWidgetConfigComponent } from '@home/components/public-api';
import { FormBuilder, FormGroup } from '@angular/forms';
import { WidgetConfigComponentData } from '@home/models/widget-component.models';
import { AppState } from '@core/public-api';
import { Store } from '@ngrx/store';
import { WidgetConfigComponent } from '@home/components/widget/widget-config.component';
import { DataKey, Datasource } from '@shared/public-api';

@Component({
  selector: 'tb-miikue-chart-basic-config',
  templateUrl: './miikue-chart-basic-config.component.html',
  styleUrls: [],
  standalone: false
})
export class MiikueChartBasicConfigComponent extends BasicWidgetConfigComponent {

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
    const showSmallGraph = this.getShowSmallGraph(configData.config.settings);
    this.configFormGroup = this.fb.group({
      datasources: [configData.config.datasources, []],
      dataKeys: [this.getDataKeys(configData.config.datasources), []],
      showSmallGraph: [showSmallGraph, []],
      actions: [configData.config.actions || {}, []]
    });
  }

  protected prepareOutputConfig(config: any): WidgetConfigComponentData {
    this.widgetConfig.config.datasources = config.datasources;
    this.widgetConfig.config.actions = config.actions;
    this.widgetConfig.config.settings = {
      ...(this.widgetConfig.config.settings || {}),
      showSmallGraph: this.normalizeBoolean(config.showSmallGraph, true)
    };
    this.setDataKeys(config.dataKeys, this.widgetConfig.config.datasources);
    return this.widgetConfig;
  }

  private getShowSmallGraph(settings?: any): boolean {
    return this.normalizeBoolean(settings?.showSmallGraph, true);
  }

  private normalizeBoolean(value: any, fallback: boolean): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (!normalized) {
        return fallback;
      }
      if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
        return false;
      }
      if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
        return true;
      }
    }

    if (typeof value === 'number') {
      return value !== 0;
    }

    return fallback;
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
