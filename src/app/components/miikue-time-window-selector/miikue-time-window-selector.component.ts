import {
  Component,
  Input,
  OnInit,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ChangeDetectorRef,
  ViewEncapsulation,
  ElementRef,
  Renderer2,
  output
} from '@angular/core';

export interface TimeWindow {
  startTs: number;
  endTs: number;
}

@Component({
  selector: 'app-miikue-time-window-selector',
  templateUrl: './miikue-time-window-selector.component.html',
  styleUrls: ['./miikue-time-window-selector.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class MiikueTimeWindowSelectorComponent implements OnInit, OnChanges {

  @Input() initialTimeWindow: TimeWindow;
  
  // New Signal-based output
  timeWindowChange = output<TimeWindow>();

  isPopupOpen = false;
  currentSelectionText = 'Posledních 24 hodin';

  customStartDate: string;
  customEndDate: string;
  
  customStartTime: string;
  customEndTime: string;

  private uiDebugEnabled = false;
  private hostDashboardWidget: HTMLElement | null = null;
  private hostDashboardWidgetOriginalZIndex: string | null = null;

  constructor(
    private cd: ChangeDetectorRef,
    private elementRef: ElementRef<HTMLElement>,
    private renderer: Renderer2
  ) {}

  ngOnInit(): void {
    this.captureHostDashboardWidget();

    if (this.initialTimeWindow) {
      this.updateStateFromTimeWindow(this.initialTimeWindow);
    } else {
      this.selectQuickRange('day', false);
    }
  }

  ngOnDestroy(): void {
    this.restoreHostDashboardWidgetLayer();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.initialTimeWindow && !changes.initialTimeWindow.firstChange) {
      const newTimeWindow = changes.initialTimeWindow.currentValue as TimeWindow;
      if (newTimeWindow && newTimeWindow.startTs && newTimeWindow.endTs) {
        this.updateStateFromTimeWindow(newTimeWindow, false);
      }
    }
  }

  private updateStateFromTimeWindow(timeWindow: TimeWindow, useLabel: boolean = true) {
    if (!timeWindow || typeof timeWindow.startTs !== 'number' || typeof timeWindow.endTs !== 'number') {
      return;
    }
    const startDate = new Date(timeWindow.startTs);
    const endDate = new Date(timeWindow.endTs);
    this.customStartDate = this.formatDateForInput(startDate);
    this.customEndDate = this.formatDateForInput(endDate);
    this.customStartTime = this.formatTime(startDate);
    this.customEndTime = this.formatTime(endDate);
    const quickRangeLabel = useLabel ? this.getQuickRangeLabel(timeWindow) : null;
    this.updateDisplay(timeWindow, quickRangeLabel);
  }

  private getQuickRangeLabel(timeWindow: TimeWindow): string | null {
    const duration = timeWindow.endTs - timeWindow.startTs;
    if (Math.abs(duration - 36e5) < 1000) return 'Poslední hodina';
    if (Math.abs(duration - 216e5) < 1000) return 'Posledních 6 hodin';
    if (Math.abs(duration - 864e5) < 1000) return 'Posledních 24 hodin';
    if (Math.abs(duration - 6048e5) < 1000) return 'Posledních 7 dní';
    if (Math.abs(duration - 2592e6) < 1000) return 'Poslední měsíc';
    return null;
  }

  togglePopup(event?: MouseEvent) {
    if (event) event.stopPropagation();
    if (this.uiDebugEnabled) {
      console.warn('[TW UI] togglePopup click', {
        eventType: event?.type,
        target: (event?.target as HTMLElement)?.tagName,
        isPopupOpenBefore: this.isPopupOpen
      });
    }
    if (this.isPopupOpen) {
      this.closePopup();
    } else {
      const initial = this.initialTimeWindow || this.calculateInitialWindow();
      this.updateStateFromTimeWindow(initial);
      this.isPopupOpen = true;
      this.elevateHostDashboardWidgetLayer();
    }
    if (this.uiDebugEnabled) {
      console.warn('[TW UI] popup state changed', { isPopupOpenAfter: this.isPopupOpen });
    }
  }

  onTriggerMouseDown(event: MouseEvent): void {
    if (this.uiDebugEnabled) {
      console.warn('[TW UI] trigger mousedown', {
        button: event.button,
        x: event.clientX,
        y: event.clientY
      });
    }
  }

  onRootPointerDown(event: PointerEvent): void {
    if (this.uiDebugEnabled) {
      console.warn('[TW UI] root pointerdown', {
        target: (event.target as HTMLElement)?.tagName,
        x: event.clientX,
        y: event.clientY
      });
    }
  }


  private calculateInitialWindow(): TimeWindow {
      const endTs = new Date().getTime();
      const startTs = endTs - 24 * 60 * 60 * 1000;
      return { startTs, endTs };
  }
  selectQuickRange(type: 'hour' | '2h' | '6hours' | '12h' | 'day' | 'week' | 'month' | '2m' | '3m' | '6m' | '1y', emitChange = true) {
    const endTs = new Date().getTime();
    const startDate = new Date();
    let startTs: number;
    
    switch (type) {
        case 'hour':   startDate.setHours(startDate.getHours() - 1); break;
        case '2h':     startDate.setHours(startDate.getHours() - 2); break;
        case '6hours': startDate.setHours(startDate.getHours() - 6); break;
        case '12h':    startDate.setHours(startDate.getHours() - 12); break;
        case 'day':    startDate.setDate(startDate.getDate() - 1); break;
        case 'week':   startDate.setDate(startDate.getDate() - 7); break;
        case 'month':  startDate.setMonth(startDate.getMonth() - 1); break;
        case '2m':     startDate.setMonth(startDate.getMonth() - 2); break;
        case '3m':     startDate.setMonth(startDate.getMonth() - 3); break;
        case '6m':     startDate.setMonth(startDate.getMonth() - 6); break;
        case '1y':     startDate.setFullYear(startDate.getFullYear() - 1); break;
    }
    startTs = startDate.getTime();

    const newTimeWindow = { startTs, endTs };
    if (emitChange) {
      this.timeWindowChange.emit(newTimeWindow);
    }
    this.updateStateFromTimeWindow(newTimeWindow);
    if (emitChange && this.isPopupOpen) {
      this.closePopup();
    }
    this.cd.detectChanges();
  }

  applyCustomRange() {
    if (!this.customStartDate || !this.customEndDate) {
      alert('Prosím, vyberte datum Od/Do.');
      return;
    }

    let finalStartDate: Date;
    let finalEndDate: Date;

    const startTime = this.customStartTime || '00:00';
    const endTime = this.customEndTime || '23:59';
    finalStartDate = this.combineDateAndTime(this.customStartDate, startTime);
    finalEndDate = this.combineDateAndTime(this.customEndDate, endTime);
    if (finalStartDate.getTime() < finalEndDate.getTime()) {
      const newTimeWindow = { startTs: finalStartDate.getTime(), endTs: finalEndDate.getTime() };
      this.timeWindowChange.emit(newTimeWindow);
      this.updateStateFromTimeWindow(newTimeWindow, false);
      this.closePopup();
    } else {
      alert('Neplatný časový rozsah. Datum "Od" musí být dříve než datum "Do".');
    }
  }
  
  private combineDateAndTime(date: string, time: string): Date {
      const [hours, minutes] = time.split(':').map(Number);
      const [year, month, day] = date.split('-').map(Number);
      const newDate = new Date(year, month - 1, day);
      newDate.setHours(hours, minutes, 0, 0);
      return newDate;
  }

  onStartDateChange(event: any): void {
    if (event && event instanceof Date) {
      this.customStartDate = this.formatDateForInput(event);
    }
  }

  onEndDateChange(event: any): void {
    if (event && event instanceof Date) {
      this.customEndDate = this.formatDateForInput(event);
    }
  }
  
  closePopup() {
    if (this.uiDebugEnabled) {
      console.warn('[TW UI] closePopup');
    }
    this.isPopupOpen = false;
    this.restoreHostDashboardWidgetLayer();
  }

  private captureHostDashboardWidget(): void {
    const host = this.elementRef.nativeElement;
    this.hostDashboardWidget = host.closest('.grid-stack-item') as HTMLElement | null;
    if (this.hostDashboardWidget) {
      this.hostDashboardWidgetOriginalZIndex = this.hostDashboardWidget.style.zIndex || null;
    }
  }

  private elevateHostDashboardWidgetLayer(): void {
    if (!this.hostDashboardWidget) {
      return;
    }
    this.renderer.setStyle(this.hostDashboardWidget, 'z-index', '20000');
  }

  private restoreHostDashboardWidgetLayer(): void {
    if (!this.hostDashboardWidget) {
      return;
    }
    if (this.hostDashboardWidgetOriginalZIndex) {
      this.renderer.setStyle(this.hostDashboardWidget, 'z-index', this.hostDashboardWidgetOriginalZIndex);
    } else {
      this.renderer.removeStyle(this.hostDashboardWidget, 'z-index');
    }
  }

  private updateDisplay(timeWindow: TimeWindow, label?: string) {
    if (label) {
      this.currentSelectionText = label;
    } else {
      const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric' };
      const start = new Date(timeWindow.startTs).toLocaleString('cs-CZ', options);
      const end = new Date(timeWindow.endTs).toLocaleString('cs-CZ', options);
      this.currentSelectionText = `${start} - ${end}`;
    }
    this.cd.detectChanges();
  }

  private formatTime(date: Date): string {
    return date.toTimeString().split(' ')[0].substring(0, 5);
  }

  private formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  onDateInputChange(): void {
    // Inputs are bound via ngModel; keep this hook for template compatibility.
  }
}