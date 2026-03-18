# Custom "Miikue" Components Documentation

This document provides an overview and usage examples for the custom Angular components prefixed with `miikue-`.

---

## 1. Miikue LED (`<tb-miikue-led>`)

A simple, circular LED-like component that displays a solid color.

### Inputs

| Input  | Type     | Optional | Description                                  |
|--------|----------|----------|----------------------------------------------|
| `color`| `string` | Yes      | The color of the LED (e.g., `'green'`, `'#FF5733'`). Defaults to a dark gray. |
| `size` | `number` | Yes      | The diameter of the LED in pixels. Defaults to `20`. |

### Example

```html
<!-- Displays a 50px wide green LED -->
<tb-miikue-led color="green" [size]="50"></tb-miikue-led>
```

---

## 2. Miikue Signalization (`<tb-miikue-signalization>`)

Displays a text label next to an LED. The LED color changes based on an incoming `value` and a `mapping` condition.

### Inputs

| Input     | Type     | Optional | Description                                  |
|-----------|----------|----------|----------------------------------------------|
| `text`      | `string` | Yes      | The text label displayed next to the LED.    |
| `value`     | `any`    | Yes      | The current data value that determines if the LED is 'on'. |
| `mapping`   | `string` | Yes      | A condition for the 'on' state. Can be a single value (`1`), multiple values (`1|2`), or a range (`4-8`). If `value` matches, the LED turns on. |
| `colorOn`   | `string` | Yes      | The color of the active (on) LED. Defaults to `'green'`. |
| `colorOff`  | `string` | Yes      | The color of the inactive (off) LED. Defaults to `'grey'`. |
| `size`      | `number` | Yes      | Sets an explicit size for the LED. Defaults to `20`. The font size is derived as `size * 0.8`. |

### Example

```html
<!-- LED is ON (green) because value '5' is in the range '4-8' -->
<tb-miikue-signalization
  text="System Active"
  mapping="4-8"
  [value]="5"
></tb-miikue-signalization>

<!-- LED is OFF (red) because value 'inactive' does not match 'active' -->
<tb-miikue-signalization
  text="Status"
  mapping="active"
  value="inactive"
  colorOff="red"
></tb-miikue-signalization>
```

---

## 3. Miikue Value (`<tb-miikue-value>`)

Displays a text label and a corresponding value. The component is designed for key-value pairs with static sizing.

### Inputs

| Input  | Type     | Optional | Description                                  |
|--------|-----------|----------|----------------------------------------------|
| `text` | `string`  | Yes      | The label (key).                             |
| `value`| `string`  | Yes      | The value to be displayed.                   |
| `color`| `string`  | Yes      | The color of the `value` text.               |
| `size` | `number`  | Yes      | Sets an explicit font size for the `value` text. If not provided, defaults to `22px`. The label's font size defaults to `18px`, or is derived as `size - 4` if `size` is provided. |

### Example

```html
<!-- Default sizing. The text "25.4 °C" will be colored red. -->
<tb-miikue-value text="Temperature" value="25.4 °C" color="red"></tb-miikue-value>

<!-- Explicitly sized -->
<tb-miikue-value text="Humidity" value="68%" color="blue" [size]="24"></tb-miikue-value>
```

---

## 4. Miikue Time Formatter (`<tb-miikue-time-formatter>`)

Displays a human-readable duration (e.g., `1h 15m 30s`) from a millisecond timestamp. It can optionally include a text label to the left of the time. The component is responsive and will adjust its font size based on the container's height, unless an explicit `size` is provided.

### Inputs

| Input     | Type     | Optional | Description                                  |
|-----------|----------|----------|----------------------------------------------|
| `text`      | `string` | Yes      | An optional label to display to the left of the time. |
| `value`     | `number` | Yes      | The duration in milliseconds.                |
| `color`     | `string` | Yes      | The color of the text. Defaults to `#333`. |
| `precision` | `string` | Yes      | The smallest unit to display (`'d'`, `'h'`, `'m'`, `'s'`, `'ms'`). Defaults to `'ms'`. |
| `size`      | `number` | Yes      | Overrides responsive sizing with an explicit font size. |

### Example

```html
<!-- With a label -->
<tb-miikue-time-formatter
  text="Uptime"
  [value]="4860000"
  precision="m"
  color="purple"
></tb-miikue-time-formatter>

<!-- Without a label, letting responsive sizing take effect -->
<tb-miikue-time-formatter [value]="120000" precision="h"></tb-miikue-time-formatter>
```

---

## 5. Miikue LED List (`<tb-miikue-led-list>`)

Displays a title and a horizontal list of LEDs, each with its own label underneath. The LEDs change color based on an incoming `value`.

### Inputs

| Input        | Type     | Optional | Description                                  |
|--------------|----------|----------|----------------------------------------------|
| `text`       | `string` | Yes      | The main title for the component.            |
| `mapping`    | `string` | Yes      | A space-separated string of `key=value` pairs defining the LEDs. The `key` is used for matching with the `value` input (can be `1|2` for multiple matches), and the `value` is displayed as the LED's label. E.g., `'1=OFF 2=ON 3|4=FAULT'`. |
| `value`      | `any`    | Yes      | The current data value that determines which LED is 'on'. If `value` matches a `key` in `mapping`, that LED turns on. |
| `colorOn`    | `string` | Yes      | The color of the active (on) LED. Defaults to `'green'`. |
| `colorOff`   | `string` | Yes      | The color of inactive (off) LEDs. Defaults to `'grey'`. |
| `sizeText`   | `number` | Yes      | Explicit font size for the main title. Defaults to `16`. |
| `sizeLed`    | `number` | Yes      | Explicit size (diameter) for each LED. Defaults to `20`. |
| `sizeLedText`| `number` | Yes      | Explicit font size for the labels under each LED. Defaults to `14`. |

### Example

```html
<!-- Example with mapping, value, and custom colors -->
<div style="width: 400px; height: 150px; border: 1px solid #ccc;">
  <tb-miikue-led-list
    text="System Status"
    mapping="1=OFF 2=ON 3|4=FAULT"
    [value]="2"
    colorOn="blue"
    colorOff="black"
  ></tb-miikue-led-list>
</div>

<!-- Example with default colors and mapping -->
<div style="width: 400px; height: 150px; border: 1px solid #ccc;">
  <tb-miikue-led-list
    text="Load Level"
    mapping="0=0% 1=25% 2=50% 3=75% 4=100%"
    [value]="3"
  ></tb-miikue-led-list>
</div>
```

---

## 6. Miikue Label (`<tb-miikue-label>`)

A simple component for displaying a centered text label.

### Inputs

| Input  | Type      | Optional | Description                                  |
|--------|-----------|----------|----------------------------------------------|
| `text`   | `string`  | Yes      | The text to display.                         |
| `size`   | `number`  | Yes      | The font size in pixels. Defaults to `25`.   |
| `bold`   | `boolean` | Yes      | Whether the text should be bold. Defaults to `true`. |
| `top`    | `number`  | Yes      | The space above the label in pixels. Defaults to `0`. |
| `bottom` | `number`  | Yes      | The space below the label in pixels. Defaults to `0`. |

### Example

```html
<!-- Displays "Main Title" with a font size of 30px and 10px margin below -->
<tb-miikue-label
  text="Main Title"
  [size]="30"
  [bottom]="10"
></tb-miikue-label>

<!-- Displays "Normal Text" that is not bold -->
<tb-miikue-label
  text="Normal Text"
  [bold]="false"
></tb-miikue-label>
```

---

## 7. Miikue Dial Pretok (`<tb-miikue-dial-pretok>`)

A responsive gauge widget designed to display power delivery (negative values) and consumption (positive values). It features a semi-circular dial with dynamic coloring and labels.

### Inputs

| Input | Type | Optional | Description |
|---|---|---|---|
| `ctx` | `object` | No | The ThingsBoard widget context object. Required for data access. |
| `maxLimit` | `number` | Yes | The maximum value for the scale (absolute value). E.g., if set to `400`, the scale goes from -400 to 400. Defaults to `400`. |
| `pDeliveryColor` | `string` | Yes | Color for delivery (negative values). Defaults to `#22c55e`. |
| `pConsumptionColor` | `string` | Yes | Color for consumption (positive values). Defaults to `#f97316`. |
| `pText` | `string` | Yes | Text displayed when delivering power. Defaults to `'DODÁVKA DO SÍTĚ'`. |
| `qText` | `string` | Yes | Text displayed when consuming power. Defaults to `'ODBĚR ZE SÍTĚ'`. |
| `neutralText` | `string` | Yes | Text displayed when value is 0. Defaults to `'NEČINNÉ'`. |
| `isOk` | `boolean` | Yes | Status flag. If `false`, displays 'N/A'. Defaults to `true`. |

### Data Expectations
The component expects data in `ctx.defaultSubscription.data`.
- **Index 0:** Active Power (P). Negative = Delivery, Positive = Consumption.
- **Index 1:** Reactive Power (Q).

### Example

```html
<tb-miikue-dial-pretok 
    [ctx]="ctx"
    [maxLimit]="1000"
    [isOk]="true"
    [pDeliveryColor]="'#00ff00'"
    [pConsumptionColor]="'#ff0000'">
</tb-miikue-dial-pretok>
```

---

## 8. Miikue Dial FVE (`<tb-miikue-dial-fve>`)

A responsive gauge widget for displaying Photovoltaic (FVE) production. It features a single-direction dial (0 to Max) with support for displaying power limits (reduction).

### Inputs

| Input | Type | Optional | Description |
|---|---|---|---|
| `ctx` | `object` | No | The ThingsBoard widget context object. |
| `maxLimit` | `number` | Yes | The maximum value for the scale (0 to Max). Defaults to `10000`. |
| `productionColor` | `string` | Yes | Color for the production bar. Defaults to `#eab308`. |
| `limitColor` | `string` | Yes | Color for the limit marker and zone. Defaults to `#ef4444`. |
| `limitText` | `string` | Yes | Template for text when a limit is active. Use `{value}` for percentage. Defaults to `'OMEZENO NA {value}%'`. |
| `errorText` | `string` | Yes | Text displayed when limit state is unknown. Defaults to `'NEZNÁMÝ STAV LIMITU'`. |
| `isOk` | `boolean` | Yes | Status flag. If `false`, displays 'N/A'. Defaults to `true`. |

### Data Expectations
The component expects data in `ctx.defaultSubscription.data`.
- **Index 0:** Active Production (P).
- **Index 1:** Reactive Power (Q).
- **Index 2:** Power Limit (Optional). The component parses the data key label for mapping (e.g., `MUX [1=0% 2=30% 3=60% 4=100%]`) and visualizes the active limit.

### Features
- **Dynamic Ticks:** Outer ticks show values in kW, inner ticks show limit percentages.
- **Limit Visualization:** Displays a red marker and a striped zone indicating the restricted power area.
- **Responsive:** Fully vector-based (SVG), scales to any size.

### Example

```html
<tb-miikue-dial-fve 
    [ctx]="ctx"
    [maxLimit]="15000"
    [isOk]="isOk"
    [productionColor]="'#eab308'">
</tb-miikue-dial-fve>
```
---

## 9. Miikue Regulace (`<tb-miikue-regulace>`)

A component that displays a linear switch for different regulation modes. It shows the current active mode, a related power value (PSD), and an overall regulation status.

### Inputs

| Input | Type | Optional | Description |
|---|---|---|---|
| `ctx` | `object` | No | The ThingsBoard widget context object. |
| `textOn` | `string` | Yes | Text for the 'active' regulation status. Defaults to `'AKTIVNÍ'`. |
| `textOff` | `string` | Yes | Text for the 'inactive' regulation status. Defaults to `'NEAKTIVNÍ'`. |
| `isOk` | `boolean` | Yes | If `false`, the component shows 'N/A'. Defaults to `true`. |

### Data Expectations
- **Index 0 (Regulace Mode):** The data key's label must contain bracketed key-value pairs for the modes (e.g., `[1=Q0 2=QL375 3=Qmax]`). The component reads the latest value to determine the active mode.
- **Index 1 (PSD Value):** Displays a power value, including its label and units.
- **Index 2 (Regulation Status):** The data key's label contains a mapping for status (e.g., `[1=on 2=off]`). The component displays the status text based on this mapping.

### Example

```html
<tb-miikue-regulace 
    [ctx]="ctx"
    [isOk]="true">
</tb-miikue-regulace>
```

---

## 10. Miikue Communication (`<tb-miikue-communication>`)

A widget for monitoring the status of different communication layers (Modbus, Edge, Gateway) and other services. It can be displayed in a minimal view (a single LED) or a fullscreen view with detailed statuses.

### Inputs

| Input | Type | Optional | Description |
|---|---|---|---|
| `ctx` | `object` | No | The ThingsBoard widget context object. |
| `textOn` | `string` | Yes | Text for an active service. Defaults to `'AKTIVNÍ'`. |
| `textOff` | `string` | Yes | Text for an inactive service. Defaults to `'NEAKTIVNÍ'`. |
| `fullscreen` | `boolean` | Yes | If `true`, shows a detailed list of all services. Defaults to `false`. |

### Outputs
| Output | Type | Description |
|---|---|---|
| `statusPing` | `EventEmitter<boolean>` | Emits `true` if core services (Modbus, Edge, Gateway) are OK, `false` otherwise. This can be used to trigger alarms. |

### Data Expectations
Data keys must be tagged in their labels:
- **Core Services:** Use `[modbus]`, `[edge]`, or `[gw]`. The component expects a boolean-like value (true/false, 1/0).
- **Extra Services:** Any other data key is treated as an extra service. The label can contain a mapping like `[1=on 2=off]` to define states and colors.

### Hierarchical Logic
The component enforces a dependency hierarchy between the core services: `Edge` -> `Gateway` -> `Modbus`.

- If the **Edge** service fails (is not in an "OK" state), the **Gateway** and **Modbus** services will be automatically displayed as inactive (grayed out), regardless of their actual data.
- If the **Edge** service is OK, but the **Gateway** service fails, the **Modbus** service will be displayed as inactive.

This ensures that the status of dependent services accurately reflects the state of the underlying infrastructure.

### Example

```html
<tb-miikue-communication 
    [ctx]="ctx"
    [fullscreen]="false"
    (statusPing)="onCommAlarm($event)">
</tb-miikue-communication>
```

---

## 11. Miikue Energie (`<tb-miikue-energie>`)

A powerful component for visualizing energy consumption history. It features a bar chart for daily values, statistics (min, max, avg), and an interactive fullscreen mode with date range selection.

### Inputs

| Input | Type | Optional | Description |
|---|---|---|---|
| `ctx` | `object` | No | The ThingsBoard widget context object. |
| `isOk` | `boolean` | Yes | If `false`, displays 'N/A'. Defaults to `true`. |
| `daysCount` | `number` | Yes | The default number of days to show in the history view. Defaults to `7`. |
| `fullscreen` | `boolean` | Yes | Toggles the detailed fullscreen view. Defaults to `false`. |

### Features
- **Historical Chart:** Displays daily energy data as a bar chart.
- **Progressive Loading:** Fetches data in chunks for better performance.
- **Interactive Tooltip:** Shows value and date on hover or touch.
- **Fullscreen Mode:** Now uses `<app-miikue-time-window-selector>` for flexible date and time range selection.
- **Statistics:** Calculates and displays Minimum, Maximum, Average, and Total values for the selected period.

### Data Expectations
- **Index 0 (Daily Value):** The primary data key for daily energy consumption. The component will fetch its history.
- **Index 1 (Total Value):** A secondary data key for a cumulative total.

### Example

```html
<tb-miikue-energie
    [ctx]="ctx"
    [daysCount]="14"
    [fullscreen]="false">
</tb-miikue-energie>
```

---

## 12. Miikue Stavy (`<tb-miikue-stavy>`)

A generic component for displaying a list of statuses. It shows a summary LED in the compact view and a detailed list in fullscreen. The color and text of each status are determined by a flexible mapping syntax.

### Inputs

| Input | Type | Optional | Description |
|---|---|---|---|
| `ctx` | `object` | No | The ThingsBoard widget context object. |
| `title` | `string` | Yes | The main title for the component. Defaults to `'Stavy'`. |
| `isOk` | `boolean` | Yes | If `false`, all statuses are shown as 'N/A' with a grey color. |
| `textOn` | `string` | Yes | Default text for the `on` state. Defaults to `'ON'`. |
| `textOff`| `string` | Yes | Default text for the `off` state. Defaults to `'OFF'`. |
| `textMix`| `string` | Yes | Default text for the `mix` state. Defaults to `'MIX'`. |
| `colorOn`| `string` | Yes | Color for the `on` state. Defaults to `#16a34a` (green). |
| `colorOff`| `string`| Yes | Color for the `off` state and unmapped values. Defaults to `#ef4444` (red). |
| `colorMix`| `string`| Yes | Color for the `mix` state. Defaults to `#f97316` (orange). |
| `fullscreen`|`boolean`| Yes | Toggles the detailed fullscreen view. Defaults to `false`. |

### Data Expectations & Mapping

The component determines the status of each item by parsing the **data key's label**. The label must follow this format:

`DisplayName [KEY=STATUS(CUSTOM_MESSAGE) KEY2=STATUS2 ...]`

- `DisplayName`: The name shown for the status row (e.g., "HDO").
- `[...]`: The mapping definition, containing one or more entries.
- `KEY`: The numeric value received from the datasource.
- `STATUS`: A keyword defining the state type:
    - `on`: Represents a normal/active state (green).
    - `off`: Represents an error/inactive state (red).
    - `mix`: Represents a warning/intermediate state (orange).
- `(CUSTOM_MESSAGE)`: An optional override for the displayed text. If not provided, the component uses the `textOn`, `textOff`, or `textMix` inputs.

### Summary LED Logic

The small summary LED has a 3-state logic:
- **Red** (`colorOff`): If any status is `off` or has an unmapped value.
- **Orange** (`colorMix`): If no status is red, but at least one is `mix`.
- **Green** (`colorOn`): If all statuses are `on`.
- **Grey**: If `isOk` is `false` or no data is available.

### Example

**Data Key Label:** `HDO [4=on(Aktivní) 7=off(Chyba HDO) 9=mix]`

| Received Value | Displayed Text | Color |
|---|---|---|
| `4` | `Aktivní` | Green |
| `7` | `Chyba HDO` | Red |
| `9` | `MIX` | Orange |
| `1` | `NEZNÁMÝ (1)` | Red |

```html
<tb-miikue-stavy
    [ctx]="ctx"
    [title]="ctx.settings.title || 'Přehled Stavů'"
    [isOk]="ctx.settings.isOk === false ? false : true"
    [colorOn]="ctx.settings.colorOn || '#16a34a'"
    [colorOff]="ctx.settings.colorOff || '#ef4444'"
    [colorMix]="ctx.settings.colorMix || '#f97316'"
    [textOn]="ctx.settings.textOn || 'ON'"
    [textOff]="ctx.settings.textOff || 'OFF'"
    [textMix]="ctx.settings.textMix || 'MIX'">
</tb-miikue-stavy>
```

---

## 13. Miikue Time Input (`<app-miikue-time-input>`)

A custom form control for selecting time using up/down arrow buttons. It ensures a consistent 24-hour format and is optimized for touch interaction.

### Inputs

| Input    | Type      | Optional | Description                                  |
|----------|-----------|----------|----------------------------------------------|
| `disabled` | `boolean` | Yes      | Disables the input, making it unresponsive. Defaults to `false`. |

### Features
- **24-Hour Format:** Always displays time in `HH:mm` format, regardless of system locale.
- **Up/Down Buttons:** Allows incremental changes to hours and minutes.
- **`ControlValueAccessor`:** Integrates seamlessly with Angular's `ngModel` for two-way data binding.

### Example

```html
<app-miikue-time-input [(ngModel)]="myTimeValue"></app-miikue-time-input>
```

---

## 14. Miikue Time Window Selector (`<app-miikue-time-window-selector>`)

A component for selecting a time range using an inline Material Design calendar and custom time inputs. It supports quick selection presets and is fully localized to Czech.

### Inputs

| Input               | Type          | Optional | Description                                  |
|---------------------|---------------|----------|----------------------------------------------|
| `initialTimeWindow`   | `TimeWindow`  | Yes      | Sets the initial selected time range when the component loads. Expected format: `{ startTs: number, endTs: number }` (Unix timestamps in milliseconds). |
| `showQuickSelections` | `boolean`     | Yes      | Toggles the visibility of the quick selection buttons panel (e.g., "Last 24 hours", "Last month"). Defaults to `true`. |
| `showTimeSelection`   | `boolean`     | Yes      | Toggles the visibility of the time input fields and the "Použít" (Apply) button. If `false`, selecting a date range in the calendar automatically applies the range from 00:00:00 to 23:59:59. Defaults to `true`. |
| `showSubDaySelections`| `boolean`     | Yes      | Toggles the visibility of quick selection buttons for ranges shorter than a full day (e.g., "Last hour", "Last 2 hours"). Defaults to `true`. |

### Outputs

| Output            | Type          | Description                                  |
|-------------------|---------------|----------------------------------------------|
| `timeWindowChange`  | `EventEmitter<TimeWindow>` | Emits a `TimeWindow` object (`{ startTs: number, endTs: number }`) whenever a new time range is selected and applied. |

### Features
- **Localized UI:** Fully localized to Czech (`cs-CZ`) for all date and time displays.
- **Inline Date Range Calendar:** Uses Angular Material's `<mat-calendar>` for an intuitive date range selection directly within the popup.
- **Custom Time Inputs:** Uses `<app-miikue-time-input>` for precise 24-hour time selection.
- **Quick Selection Presets:** Includes buttons for common ranges:
    - Hourly: "Poslední hodina", "Poslední 2 hodiny", "Posledních 6 hodin", "Posledních 12 hodin".
    - Daily/Weekly/Monthly/Yearly: "Posledních 24 hodin", "Posledních 7 dní", "Poslední měsíc", "Poslední 2 měsíce", "Poslední 3 měsíce", "Posledních 6 měsíců", "Poslední rok".
- **Responsive Popup:** Appears centered on the screen and closes when clicking outside.
- **Scrollable Quick Selections:** The quick selection buttons panel scrolls vertically if the list is too long.

### Example

```html
<!-- Example in a parent component (e.g., miikue-energie) -->
<app-miikue-time-window-selector
    [initialTimeWindow]="myPredefinedRange"
    (timeWindowChange)="handleTimeRangeChange($event)"
    [showQuickSelections]="true"
    [showTimeSelection]="false"
    [showSubDaySelections]="false">
</app-miikue-time-window-selector>
```
