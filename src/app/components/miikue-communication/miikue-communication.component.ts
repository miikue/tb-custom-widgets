import { ChangeDetectorRef, Component, Input, OnChanges, OnInit, SimpleChanges, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'tb-miikue-communication',
  templateUrl: './miikue-communication.component.html',
  styleUrls: ['./miikue-communication.component.scss']
})
export class MiikueCommunicationComponent implements OnInit, OnChanges {

  @Input() ctx: any;

  @Input() textOn: string = 'AKTIVNÍ';
  @Input() textOff: string = 'NEAKTIVNÍ';

  @Input() fullscreen: boolean = false;

  @Output() statusPing = new EventEmitter<any>();

  // Internal State
  modbusStatus: { name: string, valueText: string, color: string, ts: number };
  edgeStatus: { name: string, valueText: string, color: string, ts: number };
  gatewayStatus: { name: string, valueText: string, color: string, ts: number };

  hasData: boolean = false;
  displayStatus: boolean = false; // UI: All systems (Core + Extras)
  alarmStatus: boolean = false;   // Output: Only Core systems
  private lastEmittedStatus: boolean | null = null;
  
  public allStatuses: any[] = [];

  extraStatuses: Array<{
      name: string;
      valueText: string;
      color: string;
      isError: boolean;
      ts: number;
  }> = [];

  constructor(private cd: ChangeDetectorRef) {
  }

  ngOnInit(): void {
      if (this.ctx && this.ctx.$scope) {
          this.ctx.$scope.miikueCommunicationWidget = this;
      }
      this.refreshData();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['ctx']) { // Only checking for ctx now that mode is gone
        if (this.ctx && this.ctx.$scope) {
            this.ctx.$scope.miikueCommunicationWidget = this;
        }
        this.refreshData();
    }
  }

  public onDataUpdated(): void {
      this.refreshData();
      this.cd.detectChanges();
  }

  private refreshData(): void {
      if (!this.ctx || !this.ctx.$scope) {
          return;
      }

      const data = this.ctx.$scope.data || [];
      this.hasData = data.length > 0;
      this.modbusStatus = null;
      this.edgeStatus = null;
      this.gatewayStatus = null;
      const extraDatasourceItems = [];

      // Step 1: Identify and process all datasources by name tag
      for (const item of data) {
          const label = item.dataKey.label || item.dataKey.name;
          const keyName = label.toLowerCase();
          const displayName = label.replace(/\[.*?\]/g, '').trim();

          if (keyName.includes('[modbus]')) {
              this.modbusStatus = this.processCoreDatasource(displayName, item);
          } else if (keyName.includes('[edge]')) {
              this.edgeStatus = this.processCoreDatasource(displayName, item);
          } else if (keyName.includes('[gw]')) {
              this.gatewayStatus = this.processCoreDatasource(displayName, item);
          } else {
              extraDatasourceItems.push(item);
          }
      }

      // Step 2: Determine final core status with HIERARCHICAL LOGIC
      // The hierarchy is: Edge -> Gateway -> Modbus. Failure cascades down.
      const isEdgeOk = this.edgeStatus && this.edgeStatus.color === '#16a34a';
      const isGatewayOk = this.gatewayStatus && this.gatewayStatus.color === '#16a34a';

      if (!isEdgeOk) {
          // If Edge is not OK (red or gray), force Gateway and Modbus to a disabled state (gray).
          if (this.gatewayStatus) {
              this.gatewayStatus.color = '#94a3b8'; // Gray it out
              this.gatewayStatus.valueText = this.textOff; // Show as inactive
          }
          if (this.modbusStatus) {
              this.modbusStatus.color = '#94a3b8'; // Gray it out
              this.modbusStatus.valueText = this.textOff; // Show as inactive
          }
      } else if (!isGatewayOk) {
          // If Edge is OK, but Gateway is not, force Modbus to a disabled state.
          if (this.modbusStatus) {
              this.modbusStatus.color = '#94a3b8'; // Gray it out
              this.modbusStatus.valueText = this.textOff; // Show as inactive
          }
      }

      // Now, recalculate the final OK status for the core group based on the potentially modified colors.
      const modbusOk = this.modbusStatus ? this.modbusStatus.color === '#16a34a' : true;
      const edgeOk = this.edgeStatus ? this.edgeStatus.color === '#16a34a' : true;
      const gatewayOk = this.gatewayStatus ? this.gatewayStatus.color === '#16a34a' : true;
      const coreIsOk = modbusOk && edgeOk && gatewayOk;


      // Step 3: Process Extra Statuses (dependent on coreIsOk)
      this.extraStatuses = extraDatasourceItems.map(item => {
          const label = item.dataKey.label || item.dataKey.name;
          const mapping = this.parseMapping(label);
          const cleanName = label.replace(/\[.*?\]/g, '').trim();
          let statusObj = { name: cleanName, valueText: 'N/A', color: '#ef4444', isError: true, ts: 0 };

          if (item.data && item.data.length > 0) {
              const lastPoint = item.data[item.data.length - 1];
              statusObj.ts = lastPoint[0];
              if (coreIsOk) { // Only process if ALL core services are OK
                  const rawVal = Number(lastPoint[1]);
                  if (mapping.has(rawVal)) {
                      const mapText = mapping.get(rawVal) || '';
                      statusObj.isError = false;
                      const lowerText = mapText.toLowerCase();
                      if (lowerText === 'on' || (lowerText.includes('aktiv') && !lowerText.includes('neaktiv'))) {
                          statusObj.valueText = this.textOn; statusObj.color = '#16a34a';
                      } else if (lowerText === 'off' || lowerText.includes('neaktiv')) {
                          statusObj.valueText = this.textOff; statusObj.color = '#94a3b8';
                      } else {
                          statusObj.valueText = mapText; statusObj.color = '#f97316';
                      }
                  } else {
                      statusObj.valueText = `NEZNÁMÝ (${rawVal})`; statusObj.color = '#ef4444'; statusObj.isError = true;
                  }
              }
          }
          return statusObj;
      });
      
      // Calculate and set final component statuses
      const extrasOk = this.extraStatuses.every(s => !s.isError);
      this.displayStatus = coreIsOk && extrasOk;
      this.alarmStatus = coreIsOk; // Alarm only triggered by core services.


      if (this.alarmStatus !== this.lastEmittedStatus) {
          this.statusPing.emit(this.alarmStatus);
          this.lastEmittedStatus = this.alarmStatus;
      }
      
      this.allStatuses = [this.modbusStatus, this.gatewayStatus, this.edgeStatus, ...this.extraStatuses].filter(s => !!s);
      this.cd.detectChanges();
  }

  private processCoreDatasource(name: string, item: any): { name: string, valueText: string, color: string, ts: number } {
      const statusObj = { name: name, valueText: 'N/A', color: '#ef4444', ts: 0 };
      const itemData = item.data;
      if (itemData && itemData.length > 0) {
          const lastPoint = itemData[item.data.length - 1];
          const isActive = this.parseBoolean(lastPoint[1]);
          statusObj.ts = lastPoint[0];
          statusObj.valueText = isActive ? this.textOn : this.textOff;
          statusObj.color = isActive ? '#16a34a' : '#ef4444';
      }
      return statusObj;
  }

  private parseBoolean(val: any): boolean {
      if (val === 'true' || val === true || val === 1 || val === '1') return true;
      return false;
  }

  private parseMapping(label: string): Map<number, string> {
      const map = new Map<number, string>();
      const matches = label.matchAll(/\[(.*?)\]/g);
      for (const match of matches) {
          const content = match[1];
          if (content.includes('=')) {
              const parts = content.split(/\s+/);
              parts.forEach(part => {
                  const eqIndex = part.indexOf('=');
                  if (eqIndex > -1) {
                      const key = Number(part.substring(0, eqIndex));
                      const val = part.substring(eqIndex + 1);
                      if (!isNaN(key)) {
                          map.set(key, val);
                      }
                  }
              });
          }
      }
      return map;
  }
}