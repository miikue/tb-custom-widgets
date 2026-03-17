import {
  Component,
  Input,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  ChangeDetectorRef,
  OnChanges,
  SimpleChanges,
} from '@angular/core';

@Component({
  selector: 'tb-miikue-time-formatter',
  templateUrl: './miikue-time-formatter.component.html',
  styleUrls: ['./miikue-time-formatter.component.scss']
})
export class MiikueTimeFormatterComponent
  implements AfterViewInit, OnDestroy, OnChanges
{
  @Input() value: number;
  @Input() color = '#333';
  @Input() precision = 'ms';
  @Input() size: number;
  @Input() text: string;

  formattedTime: string;
  dynamicFontSize: number;

  private resizeObserver: ResizeObserver;

  constructor(
    private elementRef: ElementRef,
    private cd: ChangeDetectorRef,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    const shouldFormatTime = changes.value || changes.precision;
    if (shouldFormatTime) {
      this.formatTime();
    }

    if (this.size) {
      this.dynamicFontSize = this.size;
    } else if (this.resizeObserver) {
      // If a resize observer is present, trigger a resize check
      this.onResize(this.elementRef.nativeElement.getBoundingClientRect());
    }

    // Always trigger change detection to be safe
    this.cd.detectChanges();
  }

  ngAfterViewInit(): void {
    if (this.size) {
      this.dynamicFontSize = this.size;
      this.formatTime();
      return;
    }

    this.resizeObserver = new ResizeObserver((entries) => {
      this.onResize(entries[0].contentRect);
    });
    this.resizeObserver.observe(this.elementRef.nativeElement);
    this.formatTime();
    this.onResize(this.elementRef.nativeElement.getBoundingClientRect());
  }

  ngOnDestroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }

  private formatTime(): void {
    if (this.value === null || this.value === undefined) {
      this.formattedTime = '-';
      return;
    }

    let ms = this.value;
    if (ms < 0) {
      this.formattedTime = `0${this.precision}`;
      return;
    }

    const parts: string[] = [];
    const units = ['d', 'h', 'm', 's', 'ms'];
    const conversions = {
      d: 24 * 60 * 60 * 1000,
      h: 60 * 60 * 1000,
      m: 60 * 1000,
      s: 1000,
      ms: 1,
    };

    for (const unit of units) {
      if (ms > 0) {
        const conversion = conversions[unit];
        const count = Math.floor(ms / conversion);
        if (count > 0) {
          parts.push(`${count}${unit}`);
          ms -= count * conversion;
        }
      }
      if (this.precision === unit) {
        break;
      }
    }

    if (parts.length === 0) {
      if (this.value === 0) {
        this.formattedTime = 'N/A';
      } else {
        this.formattedTime = `0${this.precision}`;
      }
    } else {
      this.formattedTime = parts.join(' ');
    }
  }

  private onResize(rect: DOMRectReadOnly): void {
    if (this.size) {
      return;
    }

    const height = rect.height;
    if (height > 0) {
      // Base font size on container height.
      const baseFontSize = height * 0.7; // 70% of height

      // Clamp the font size between 10px and 30px
      this.dynamicFontSize = Math.min(Math.max(baseFontSize, 10), 30);

      this.cd.detectChanges();
    }
  }
}

