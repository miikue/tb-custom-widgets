import { Component } from '@angular/core';
import { BasicWidgetConfigComponent } from '@home/components/public-api';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { WidgetConfigComponentData } from '@home/models/widget-component.models';
import { AppState } from '@core/public-api';
import { Store } from '@ngrx/store';
import { WidgetConfigComponent } from '@home/components/widget/widget-config.component';
import { DataKey, Datasource } from '@shared/public-api';

@Component({
  selector: 'tb-miikue-chart-line-basic-config',
  templateUrl: './miikue-chart-line-basic-config.component.html',
  styleUrls: [],
  standalone: false
})
export class MiikueChartLineBasicConfigComponent extends BasicWidgetConfigComponent {

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
    const maxConnectedGapSeconds = this.getMaxConnectedGapSeconds(configData.config.settings);
    this.configFormGroup = this.fb.group({
      datasources: [configData.config.datasources, []],
      dataKeys: [this.getDataKeys(configData.config.datasources), []],
      maxConnectedGapSeconds: [maxConnectedGapSeconds, [Validators.min(0)]],
      actions: [configData.config.actions || {}, []]
    });
  }

  protected prepareOutputConfig(config: any): WidgetConfigComponentData {
    const maxConnectedGapSeconds = Number(config.maxConnectedGapSeconds);
    const normalizedMaxGap = Number.isFinite(maxConnectedGapSeconds) && maxConnectedGapSeconds > 0 ?
      maxConnectedGapSeconds : 0;

    this.widgetConfig.config.datasources = config.datasources;
    this.widgetConfig.config.actions = config.actions;
    this.widgetConfig.config.settings = {
      ...(this.widgetConfig.config.settings || {}),
      maxConnectedGapSeconds: normalizedMaxGap
    };
    this.setDataKeys(config.dataKeys, this.widgetConfig.config.datasources);
    return this.widgetConfig;
  }

  private getMaxConnectedGapSeconds(settings?: any): number {
    const value = Number(settings?.maxConnectedGapSeconds);
    return Number.isFinite(value) && value > 0 ? value : 0;
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
