# Miikue Chart Line - Status (2026-03-27)

## Kontext
- Resime prepinani modu `seconds/min/hour`.
- `min` zacina fungovat.
- `hour` vraci series, ale vsechny `data: []` (0 bodu).
- Uzivatel overil, ze telemetry key names s `_hour` existuji.
- Nove i bezna tabulka nevidi data -> pravdepodobna pricina mimo widget (mozna chyba v generovani/zapisu dat).

## Co je implementovano v komponentu
Soubor: `src/app/components/miikue-chart-line/miikue-chart-line.component.ts`

1. Custom subscription se vytvari pro `min/hour`.
2. `seconds` jede z default subscription.
3. Prefix/suffix mapovani:
   - `min` default `_min`
   - `hour` default `_hour`
   - suffix lze prepsat pres settings: `minAggregationSuffix`, `hourAggregationSuffix`
4. Labely v grafu zustavaji puvodni (bez suffixu).
5. Timewindow je navazano na widget/default sub (ne dashboard global).
6. Pri vytvoreni custom sub se vola `onUpdateTimewindow(start,end,interval)`.
7. Diagnostic logs jsou pridane:
   - Subscription switch snapshots
   - New custom subscription options
   - Incoming custom subscription update
   - Hour mode returned zero points
   - Custom subscription callbacks: `onDataUpdateError`, `onSubscriptionMessage`, `timeWindowUpdated`

## Posledni pozorovany stav
- Pri `hour` modu:
  - `seriesCount: 6`
  - vsechny serie maji `data: []`
  - key names se suffix `_hour` sedi
- To ukazuje spis na to, ze backend/subscription vrstva nema realne body v danem case (nebo se negeneruji), ne na mismatch key names.

## Dalsi krok az budou data k dispozici
1. Znovu otestovat `hour` mod po potvrzeni, ze data realne tecou (overit i v bezne TB tabulce).
2. Pokud `hour` stale 0 bodu a tabulka uz data vidi:
   - porovnat `New custom subscription options` vs funkci tabulky
   - pripadne aktivovat fallback pro `hour` (primy telemetry fetch) s cooldown.

## Poznamka
- Stav je ulozen zamerne zde, aby slo plynule navazat pristi session.
