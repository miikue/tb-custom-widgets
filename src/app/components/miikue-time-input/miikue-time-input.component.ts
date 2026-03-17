import { Component, forwardRef, Input } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Component({
  selector: 'app-miikue-time-input',
  templateUrl: './miikue-time-input.component.html',
  styleUrls: ['./miikue-time-input.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => MiikueTimeInputComponent),
      multi: true
    }
  ]
})
export class MiikueTimeInputComponent implements ControlValueAccessor {

  @Input() disabled = false;
  
  hours = 0;
  minutes = 0;

  private onChange = (value: string) => {};
  private onTouched = () => {};

  writeValue(value: string): void {
    if (value && typeof value === 'string' && value.includes(':')) {
      const [h, m] = value.split(':').map(Number);
      this.hours = isNaN(h) ? 0 : h;
      this.minutes = isNaN(m) ? 0 : m;
    } else {
      this.hours = 0;
      this.minutes = 0;
    }
  }

  registerOnChange(fn: any): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  setDisabledState?(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  updateHour(delta: number): void {
    if (this.disabled) return;
    this.hours = (this.hours + delta + 24) % 24;
    this.propagateChange();
  }

  updateMinute(delta: number): void {
    if (this.disabled) return;
    this.minutes = (this.minutes + delta + 60) % 60;
    this.propagateChange();
  }

  private propagateChange(): void {
    this.onTouched();
    const timeString = `${this.pad(this.hours)}:${this.pad(this.minutes)}`;
    this.onChange(timeString);
  }

  pad(num: number): string {
    return num.toString().padStart(2, '0');
  }
}