import { Component, ElementRef, Input, OnInit, OnChanges, OnDestroy, SimpleChanges, ChangeDetectorRef, ViewChild, ViewEncapsulation, output } from '@angular/core';
import { DateRange, MatRangeDateSelectionModel, DefaultMatCalendarRangeStrategy } from '@angular/material/datepicker';

export interface TimeWindow {
  startTs: number;
  endTs: number;
}

@Component({
  selector: 'app-miikue-time-window-selector',
  templateUrl: './miikue-time-window-selector.component.html',
  styleUrls: ['./miikue-time-window-selector.component.scss'],
  encapsulation: ViewEncapsulation.None,
  providers: [
    MatRangeDateSelectionModel,
    DefaultMatCalendarRangeStrategy
  ],
})
export class MiikueTimeWindowSelectorComponent implements OnInit, OnChanges, OnDestroy {
  @ViewChild('popupContainer', { static: false }) popupContainer: ElementRef<HTMLDivElement>;

  @Input() initialTimeWindow: TimeWindow;
  @Input() showQuickSelections = true;
  @Input() showTimeSelection = true;
  @Input() showSubDaySelections = true;
  
  // New Signal-based output
  timeWindowChange = output<TimeWindow>();

  isPopupOpen = false;
  currentSelectionText = 'Posledních 24 hodin';
  
  customStartTime: string;
  customEndTime: string;

  selectedRangeValue: DateRange<Date | null> = new DateRange(null, null);

  private uiDebugEnabled = true;

  constructor(
    private cd: ChangeDetectorRef,
    private readonly selectionModel: MatRangeDateSelectionModel<Date>,
    private readonly selectionStrategy: DefaultMatCalendarRangeStrategy<Date>,
  ) {}

  ngOnInit(): void {
    if (this.initialTimeWindow) {
      this.updateStateFromTimeWindow(this.initialTimeWindow);
    } else {
      this.selectQuickRange('day', false);
    }
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
    this.selectedRangeValue = new DateRange(new Date(timeWindow.startTs), new Date(timeWindow.endTs));
    this.selectionModel.updateSelection(this.selectedRangeValue, this);
    this.customStartTime = this.formatTime(new Date(timeWindow.startTs));
    this.customEndTime = this.formatTime(new Date(timeWindow.endTs));
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
      setTimeout(() => this.mountPopupToBody());
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

  selectedChange(date: Date | null): void {
    if (!date) return;
    const selection = this.selectionModel.selection;
    const newSelection = this.selectionStrategy.selectionFinished(date, selection);
    this.selectionModel.updateSelection(newSelection, this);
    this.selectedRangeValue = new DateRange(newSelection.start, newSelection.end);
    if (!this.showTimeSelection && newSelection.start && newSelection.end) {
      this.applyCustomRange();
    }
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
    this.isPopupOpen = false;
  }

  applyCustomRange() {
    const { start, end } = this.selectedRangeValue;
    if (!start || !end) {
      alert('Prosím, dokončete výběr rozsahu v kalendáři.');
      return;
    }
    let finalStartDate: Date, finalEndDate: Date;
    if (this.showTimeSelection) {
      if (!this.customStartTime || !this.customEndTime) {
        alert('Prosím, vyplňte časy.');
        return;
      }
      finalStartDate = this.combineDateAndTime(start, this.customStartTime);
      finalEndDate = this.combineDateAndTime(end, this.customEndTime);
    } else {
      finalStartDate = new Date(start);
      finalStartDate.setHours(0, 0, 0, 0);
      finalEndDate = new Date(end);
      finalEndDate.setHours(23, 59, 59, 999);
    }
    if (finalStartDate.getTime() < finalEndDate.getTime()) {
      const newTimeWindow = { startTs: finalStartDate.getTime(), endTs: finalEndDate.getTime() };
      this.timeWindowChange.emit(newTimeWindow);
      this.updateStateFromTimeWindow(newTimeWindow, false);
      this.isPopupOpen = false;
    } else {
      alert('Neplatný časový rozsah. Datum "Od" musí být dříve než datum "Do".');
    }
  }
  
  private combineDateAndTime(date: Date, time: string): Date {
      const [hours, minutes] = time.split(':').map(Number);
      const newDate = new Date(date);
      newDate.setHours(hours, minutes, 0, 0);
      return newDate;
  }
  
  closePopup() {
    if (this.uiDebugEnabled) {
      console.warn('[TW UI] closePopup');
    }
    this.isPopupOpen = false;
  }

  private mountPopupToBody(): void {
    const popupEl = this.popupContainer?.nativeElement;
    if (!popupEl) {
      return;
    }

    if (popupEl.parentNode !== document.body) {
      document.body.appendChild(popupEl);
    }

    this.cd.detectChanges();
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

  ngOnDestroy(): void {
    const popupEl = this.popupContainer?.nativeElement;
    if (popupEl && popupEl.parentNode === document.body) {
      document.body.removeChild(popupEl);
    }
  }
}