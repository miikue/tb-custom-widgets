# Miikue Chart Line - Subscription a Custom Subscription

Tento dokument popisuje, jak komponenta miikue-chart-line pracuje se subscription v rezimu seconds a v rezimech min/hour (custom subscription).

Zdroj: src/app/components/common/miikue-chart-line/miikue-chart-line.component.ts

## 1. Zakladni princip

Komponenta ma 2 datove rezimy:

- seconds: pouziva puvodni data z ctx.data (default TB subscription)
- min/hour: vytvari vlastni custom subscription pres ctx.subscriptionApi.createSubscription(...)

Volba rezimu je v selectedDataDisplayMode.

## 2. Kdy se co spousti

Pri ngOnInit:

1. registrace widgetu do scope: ctx.$scope.miikueChartLineWidget = this
2. nacteni pocatecniho rezimu z nastaveni (resolveInitialDataDisplayMode)
3. applyDataDisplayModeSubscription()

Pri zmene rezimu (onDataDisplayModeChange):

1. zmeni selectedDataDisplayMode
2. vycisti hidden series a local cache
3. znovu zavola applyDataDisplayModeSubscription()
4. pokud novy rezim je seconds, vykresli data z puvodniho ctx.data pres onDataUpdated()

## 3. Rozhodovaci bod - applyDataDisplayModeSubscription

Metoda applyDataDisplayModeSubscription dela:

- seconds:
  - destroyAggregationSubscription()
  - aggregationEntries = []
  - data tecou z ctx.data

- min/hour:
  - ensureAggregationSubscription()
  - data tecou z aggregationSubscription.data

## 4. Jak funguje custom subscription (ensureAggregationSubscription)

### 4.1 Kontrola podminek

Custom subscription se nevytvori, pokud chybi:

- defaultSubscription.datasources
- subscriptionApi

V tom pripade se aggregationEntries vycisti a metoda skonci.

### 4.2 Priprava datasource pro min/hour

Komponenta vezme base datasources z default subscription a upravi data keys:

- z kazdeho key odstraneni puvodniho suffixu _min/_hour (stripAggregationSuffix)
- nasledne pripojeni suffixu podle rezimu (resolveAggregationSuffix)

Suffix je konfigurovatelny:

- min: ctx.settings.minAggregationSuffix, fallback _min
- hour: ctx.settings.hourAggregationSuffix, fallback _hour

### 4.3 Priprava options pro createSubscription

Do options se posila:

- type: resolveSubscriptionType() (fallback timeseries)
- datasources: upravene na min/hour keys
- useDashboardTimewindow: false
- displayTimewindow: true
- callbacks:
  - onDataUpdated -> onAggregationSubscriptionDataUpdated
  - onDataUpdateError -> log
  - onSubscriptionMessage -> log
  - timeWindowUpdated -> log

Navic se doplni timeWindowConfig z resolveCustomTimeWindowConfig().

### 4.4 Vytvoreni subscription

createSubscription(options, true).subscribe(...):

- ulozi handle do aggregationSubscription
- pokud je k dispozici aktivni time window a metoda onUpdateTimewindow:
  - komponenta vynuti refresh okna pres subscription.onUpdateTimewindow(...)
- zavola onAggregationSubscriptionDataUpdated()

## 5. Zpracovani dat z custom subscription

Metoda onAggregationSubscriptionDataUpdated:

1. nacte incoming data z aggregationSubscription.data
2. normalizuje data na pole (normalizeSubscriptionData)
3. udela diagnosticky snapshot (pocty bodu, prvni/posledni ts)
4. pro hour rezim varuje, pokud je 0 bodu (casto suffix mismatch)
5. mapuje incoming entries do aggregationEntries a zachovava metadata z puvodnich keys:
   - label
   - color
   - decimals
   - units
   - name bez _min/_hour suffixu
6. pokud je chart inicializovan, zavola onDataUpdated()

Diky tomu je zobrazeni konzistentni mezi rezimy seconds/min/hour.

## 6. Time window logika pro custom subscription

resolveCustomTimeWindowConfig:

- priorita:
  1) defaultSubscription.options.timeWindowConfig
  2) defaultSubscription.timeWindowConfig
  3) fallback fixed history window z activeTimeWindow

normalizeTimeWindowConfig:

- doplni history.fixedTimewindow
- prepise okno na aktualni activeTimeWindow (pokud existuje)

ensureAggregationLimit:

- pro min rezim doporuci navysit aggregation.limit podle delky okna
- pro hour rezim limit neni nasilne menit (komentar v kodu)

## 7. Uklid a lifecycle

destroyAggregationSubscription:

- vola unsubscribe() pokud existuje
- vola destroy() pokud existuje
- vynuluje reference

Volano:

- pri prepnuti na seconds
- pred vytvorenim nove custom subscription
- pri ngOnDestroy

## 8. Data zdroj pro vykresleni

getSeriesEntries vraci:

- seconds -> Object.values(ctx.data)
- min/hour -> aggregationEntries

onDataUpdated pak vzdy pracuje s vystupem getSeriesEntries, takze renderer neumi nic o tom, zda data prisla z default nebo custom subscription.

## 9. Rychly flowchart

1. User zmeni rezim (seconds/min/hour)
2. applyDataDisplayModeSubscription
3. seconds: pouzit ctx.data
4. min/hour: vytvorit custom subscription
5. callback onDataUpdated custom sub -> onAggregationSubscriptionDataUpdated
6. onDataUpdated -> ECharts repaint

## 10. Nejdulezitejsi metody

- applyDataDisplayModeSubscription
- ensureAggregationSubscription
- onAggregationSubscriptionDataUpdated
- resolveAggregationSuffix
- resolveCustomTimeWindowConfig
- ensureAggregationLimit
- destroyAggregationSubscription
- getSeriesEntries
