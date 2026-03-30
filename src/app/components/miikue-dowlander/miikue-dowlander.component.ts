import { Component, Input, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { WidgetContext } from '@home/models/widget-component.models';
import { firstValueFrom } from 'rxjs';

interface DatasourceEntity {
  entityType: string | null;
  entityId: string | null;
  entityName: string;
  keys: string[];
}

interface TimeWindowSelection {
  startTs: number;
  endTs: number;
}

interface TimeChunk {
  chunkIndex: number;
  startTs: number;
  endTs: number;
}

interface TimeseriesValue {
  ts: number;
  value: string | number | boolean | null;
}

type TimeseriesResponse = Record<string, TimeseriesValue[]>;

interface CsvExportRow {
  key: string;
  ts: number;
  value: string | number | boolean | null;
}

@Component({
  selector: 'tb-miikue-dowlander',
  templateUrl: './miikue-dowlander.component.html',
  styleUrls: ['./miikue-dowlander.component.scss'],
  standalone: false
})
export class MiikueDowlanderComponent implements OnInit {

  @Input() ctx: WidgetContext;

  public entityName = 'Dowlander';
  public datasourceEntities: DatasourceEntity[] = [];
  public isWidgetExpanded = false;
  public selectedEntityId: string | null = null;
  public selectedKeys = new Set<string>();
  public selectedTimeWindow: TimeWindowSelection | null = null;
  public exportStatusMessage = '';
  public exportProgressPercent = 0;
  public isExportRunning = false;
  public isExportError = false;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    if (this.ctx && this.ctx.$scope) {
      this.ctx.$scope.miikueDowlanderWidget = this;
    }

    this.entityName = this.ctx?.datasources?.[0]?.entityName || 'Dowlander';
    const entityMap = new Map<string, DatasourceEntity>();
    (this.ctx?.datasources || []).forEach((ds: any) => {
      const rawEntityType = ds?.entityType ?? ds?.entityId?.entityType ?? null;
      const rawEntityId = ds?.entityId;
      const normalizedEntityId = typeof rawEntityId === 'object'
        ? (rawEntityId?.id ?? null)
        : (rawEntityId ?? null);
      const entityType = rawEntityType !== null && rawEntityType !== undefined ? String(rawEntityType) : null;
      const entityId = normalizedEntityId !== null && normalizedEntityId !== undefined ? String(normalizedEntityId) : null;
      const entityName = ds?.entityName || '';
      const mapKey = `${entityType || 'na'}|${entityId || 'na'}`;

      if (!entityMap.has(mapKey)) {
        entityMap.set(mapKey, {
          entityType,
          entityId,
          entityName,
          keys: []
        });
      }
    });

    this.datasourceEntities = Array.from(entityMap.values());
    this.selectedEntityId = this.datasourceEntities[0]?.entityId || null;
    this.selectedTimeWindow = this.resolveTimeWindowFromCtx();

    this.fetchTimeseriesKeysForAllEntities();

    this.onResize();
  }

  public onResize(): void {
    this.updateExpandedState();
  }

  public onSelectedDeviceChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    this.selectedEntityId = target?.value || null;
    this.selectedKeys.clear();
  }

  public onKeySelectionChange(key: string, checked: boolean): void {
    if (checked) {
      this.selectedKeys.add(key);
    } else {
      this.selectedKeys.delete(key);
    }
  }

  public async onExportClick(): Promise<void> {
    const selectedDevice = this.selectedDevice;
    const selectedEntityType = selectedDevice?.entityType;
    const selectedEntityId = selectedDevice?.entityId;
    const selectedKeys = Array.from(this.selectedKeys);

    if (!selectedDevice || !selectedEntityType || !selectedEntityId) {
      this.setExportStatus('Není vybrané zařízení.', true);
      return;
    }

    if (!this.selectedTimeWindow || !this.isTimeWindowValid(this.selectedTimeWindow)) {
      this.setExportStatus('Nebyl zvolen platný časový rozsah.', true);
      return;
    }

    if (this.selectedKeys.size === 0) {
      this.setExportStatus('Nebyl zvolen žádný klíč.', true);
      return;
    }

    if (this.isExportRunning) {
      return;
    }

    this.isExportRunning = true;
    this.exportProgressPercent = 0;
    this.setExportStatus('Pracuji... 0 %', false);

    const chunks = this.splitTimeWindowIntoChunks(this.selectedTimeWindow);

    if (!chunks.length) {
      this.isExportRunning = false;
      this.setExportStatus('Časové okno je prázdné.', true);
      return;
    }

    const exportRows: CsvExportRow[] = [];

    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        const chunkData = await this.fetchTimeseriesChunk(selectedEntityType, selectedEntityId, selectedKeys, chunk);
        this.appendChunkRows(exportRows, chunkData);

        this.exportProgressPercent = Math.round(((i + 1) / chunks.length) * 100);
        this.setExportStatus(`Pracuji... ${this.exportProgressPercent} %`, false);
        this.ctx?.detectChanges?.();
      }
    } catch (error) {
      this.isExportRunning = false;
      this.setExportStatus('Chyba při stahování dat z API.', true);
      return;
    }

    if (!exportRows.length) {
      this.isExportRunning = false;
      this.setExportStatus('Pro zvolené období nejsou dostupná data.', true);
      return;
    }

    const fileName = `export_${selectedEntityId}.csv`;
    this.downloadCsvFile(fileName, exportRows);
    this.isExportRunning = false;
    this.setExportStatus(`Hotovo. Staženo ${exportRows.length} řádků.`, false);
  }

  public onTimeWindowChange(timeWindow: TimeWindowSelection): void {
    this.selectedTimeWindow = timeWindow;
    if (this.ctx) {
      (this.ctx as any).timewindow = timeWindow;
    }
  }

  public isKeySelected(key: string): boolean {
    return this.selectedKeys.has(key);
  }

  public get selectedDevice(): DatasourceEntity | null {
    if (!this.selectedEntityId) {
      return null;
    }
    return this.datasourceEntities.find(entity => entity.entityId === this.selectedEntityId) || null;
  }

  public get selectedDeviceKeys(): string[] {
    const keys = this.selectedDevice?.keys || [];
    return [...keys].sort((a, b) => a.localeCompare(b, 'cs', { sensitivity: 'base' }));
  }

  private updateExpandedState(): void {
    const dashboard: any = this.ctx?.dashboard;
    if (typeof dashboard?.isWidgetExpanded === 'boolean') {
      this.isWidgetExpanded = dashboard.isWidgetExpanded;
      return;
    }

    // Fallback: if TB does not expose expansion state, keep widget collapsed.
    this.isWidgetExpanded = false;
  }

  private resolveTimeWindowFromCtx(): TimeWindowSelection | null {
    const tw: any = (this.ctx as any)?.timewindow;

    if (typeof tw?.startTs === 'number' && typeof tw?.endTs === 'number') {
      return {
        startTs: tw.startTs,
        endTs: tw.endTs
      };
    }

    const fixedWindow = tw?.fixedWindow;
    if (typeof fixedWindow?.startTimeMs === 'number' && typeof fixedWindow?.endTimeMs === 'number') {
      return {
        startTs: fixedWindow.startTimeMs,
        endTs: fixedWindow.endTimeMs
      };
    }

    return null;
  }

  private fetchTimeseriesKeysForAllEntities(): void {
    const seen = new Set<string>();

    this.datasourceEntities.forEach((entity) => {
      if (!entity.entityType || !entity.entityId) {
        return;
      }

      const key = `${entity.entityType}|${entity.entityId}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);

      this.fetchTimeseriesKeys(entity.entityType, entity.entityId, entity.entityName || '(no-name)');
    });
  }

  private fetchTimeseriesKeys(entityType: string, entityId: string, entityName: string): void {
    const normalizedEntityType = entityType.toUpperCase();
    const url = `/api/plugins/telemetry/${normalizedEntityType}/${entityId}/keys/timeseries`;

    this.http.get<string[]>(url).subscribe({
      next: (keys) => {
        const resolvedKeys = Array.isArray(keys) ? [...keys] : [];
        this.datasourceEntities = this.datasourceEntities.map(entity => {
          if (entity.entityType?.toUpperCase() === normalizedEntityType && entity.entityId === entityId) {
            return {
              ...entity,
              keys: resolvedKeys
            };
          }
          return entity;
        });
        this.ctx.detectChanges();
      },
      error: () => {
      }
    });
  }

  private async fetchTimeseriesChunk(
    entityType: string,
    entityId: string,
    keys: string[],
    chunk: TimeChunk
  ): Promise<TimeseriesResponse> {
    const normalizedEntityType = entityType.toUpperCase();
    const keysParam = keys.join(',');
    const url = `/api/plugins/telemetry/${normalizedEntityType}/${entityId}/values/timeseries`
      + `?keys=${encodeURIComponent(keysParam)}`
      + `&startTs=${chunk.startTs}`
      + `&endTs=${chunk.endTs}`
      + '&limit=100000'
      + '&orderBy=ASC'
      + '&useStrictDataTypes=true';

    return firstValueFrom(this.http.get<TimeseriesResponse>(url));
  }

  private appendChunkRows(targetRows: CsvExportRow[], chunkData: TimeseriesResponse | null | undefined): void {
    if (!chunkData || typeof chunkData !== 'object') {
      return;
    }

    Object.entries(chunkData).forEach(([key, values]) => {
      if (!Array.isArray(values)) {
        return;
      }

      values.forEach((entry) => {
        if (typeof entry?.ts !== 'number') {
          return;
        }

        targetRows.push({
          key,
          ts: entry.ts,
          value: entry.value ?? null
        });
      });
    });
  }

  private downloadCsvFile(fileName: string, rows: CsvExportRow[]): void {
    const header = 'key,ts,value';
    const lines = rows.map((row) => {
      const key = this.escapeCsvValue(row.key);
      const ts = this.escapeCsvValue(String(row.ts));
      const value = this.escapeCsvValue(row.value === null ? '' : String(row.value));
      return `${key},${ts},${value}`;
    });
    const csvContent = [header, ...lines].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  private escapeCsvValue(value: string): string {
    const escaped = value.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  private splitTimeWindowIntoChunks(timeWindow: TimeWindowSelection, chunkSizeMs: number = 60 * 60 * 1000): TimeChunk[] {
    const chunks: TimeChunk[] = [];
    let currentStart = timeWindow.startTs;
    let chunkIndex = 0;

    while (currentStart <= timeWindow.endTs) {
      const currentEnd = Math.min(currentStart + chunkSizeMs, timeWindow.endTs);
      chunks.push({
        chunkIndex,
        startTs: currentStart,
        endTs: currentEnd
      });
      currentStart = currentEnd + 1;
      chunkIndex++;
    }

    return chunks;
  }

  private isTimeWindowValid(timeWindow: TimeWindowSelection): boolean {
    return Number.isFinite(timeWindow.startTs)
      && Number.isFinite(timeWindow.endTs)
      && timeWindow.startTs < timeWindow.endTs;
  }

  private setExportStatus(message: string, isError: boolean): void {
    this.exportStatusMessage = message;
    this.isExportError = isError;
  }
}
