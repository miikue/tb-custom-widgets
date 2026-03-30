// ...existing code...
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

  // Formát exportovaného času v CSV: 'timestamp' | 'iso' | 'readable'
  public exportTimeFormat: 'timestamp' | 'iso' | 'readable' = 'timestamp';

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

    // Nová logika: tabulka time, key1, key2...
    // 1. Načti všechny chunkData a slož mapu: ts -> { key: value }
    const allChunkData: TimeseriesResponse[] = [];
    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkData = await this.fetchTimeseriesChunk(selectedEntityType, selectedEntityId, selectedKeys, chunk);
        allChunkData.push(chunkData);
        this.exportProgressPercent = Math.round(((i + 1) / chunks.length) * 100);
        this.setExportStatus(`Pracuji... ${this.exportProgressPercent} %`, false);
        this.ctx?.detectChanges?.();
      }
    } catch (error) {
      this.isExportRunning = false;
      this.setExportStatus('Chyba při stahování dat z API.', true);
      return;
    }

    // Složit mapu: ts -> { key: value }
    const tsMap = new Map<number, Record<string, string | number | boolean | null>>();
    const allKeys = new Set<string>(selectedKeys);
    for (const chunkData of allChunkData) {
      for (const key of Object.keys(chunkData)) {
        allKeys.add(key);
        for (const entry of chunkData[key] || []) {
          if (typeof entry?.ts !== 'number') continue;
          if (!tsMap.has(entry.ts)) tsMap.set(entry.ts, {});
          tsMap.get(entry.ts)![key] = entry.value ?? '';
        }
      }
    }

    if (tsMap.size === 0) {
      this.isExportRunning = false;
      this.setExportStatus('Pro zvolené období nejsou dostupná data.', true);
      return;
    }

    // Seřadit časy vzestupně
    const sortedTs = Array.from(tsMap.keys()).sort((a, b) => a - b);
    // Seřadit klíče podle abecedy
    const sortedKeys = Array.from(allKeys).sort((a, b) => a.localeCompare(b, 'cs', { sensitivity: 'base' }));

    // 2. Vygenerovat CSV
    const fileName = `export_${selectedEntityId}.csv`;
    this.downloadCsvTable(fileName, sortedTs, sortedKeys, tsMap);
    this.isExportRunning = false;
    this.setExportStatus(`Hotovo. Staženo ${sortedTs.length} řádků.`, false);
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


  // Již není potřeba


  private downloadCsvTable(fileName: string, sortedTs: number[], sortedKeys: string[], tsMap: Map<number, Record<string, string | number | boolean | null>>): void {
    // Hlavička: time, key1, key2, ...
    const header = ['time', ...sortedKeys.map(k => this.escapeCsvValue(k))].join(',');
    const lines = sortedTs.map(ts => {
      const row: string[] = [this.formatExportTime(ts)];
      const values = tsMap.get(ts) || {};
      for (const key of sortedKeys) {
        const val = key in values ? values[key] : '';
        row.push(this.escapeCsvValue(val === null ? '' : String(val)));
      }
      return row.join(',');
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

  private formatExportTime(ts: number): string {
    if (this.exportTimeFormat === 'timestamp') {
      return this.escapeCsvValue(String(ts));
    } else if (this.exportTimeFormat === 'iso') {
      return this.escapeCsvValue(new Date(ts).toISOString());
    } else if (this.exportTimeFormat === 'readable') {
      // YYYY-MM-DD hh:mm:ss, locale CZ
      const d = new Date(ts);
      const pad = (n: number) => n.toString().padStart(2, '0');
      const year = d.getFullYear();
      const month = pad(d.getMonth() + 1);
      const day = pad(d.getDate());
      const hour = pad(d.getHours());
      const min = pad(d.getMinutes());
      const sec = pad(d.getSeconds());
      return this.escapeCsvValue(`${year}-${month}-${day} ${hour}:${min}:${sec}`);
    }
    return this.escapeCsvValue(String(ts));
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
