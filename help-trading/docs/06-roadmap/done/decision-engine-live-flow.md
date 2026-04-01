---
sidebar_position: 6
title: Flusso Live (post-fix)
---

# Flusso Live (post-fix)

## Panoramica

Questa pagina descrive il flusso corretto del sistema live del `decision-engine` dopo l'applicazione dei fix documentati nella pagina principale.

Il sistema live si attiva quando:
1. Lo spot-finder ha completato l'analisi di una pipe (`POST /spot-finder/:pipeId`)
2. La modalità live è abilitata (`POST /spot-finder/live/:pipeId`)
3. I ticker con `trendOk = true` sono stati sottoscritti al `market-data-service`

Da quel momento, ogni messaggio di mercato ricevuto dal `market-data-service` viene processato dal handler live e valutato per l'emissione di un segnale BUY.

Il flusso si divide in due fasi distinte:
- **Fase 1 — Tick live** (`dataMode = "live"`): il prezzo viene solo cachato in memoria, nessuna logica viene eseguita
- **Fase 2 — Tick snapshot** (`dataMode = "snapshot"`): viene eseguita la valutazione completa del segnale

---

## Schema del flusso completo

```mermaid
flowchart TD
    A([Messaggio mercato ricevuto]) --> B{liveState.active?}
    B -- No --> Z1([IGNORA])
    B -- Sì --> C{ticker in\nliveState.tickers?}
    C -- No --> Z1
    C -- Sì --> D{dataMode?}

    D -- live --> E[Cacha prezzo e volume\nin lastLiveByTicker]
    E --> Z1

    D -- snapshot --> F{runningByTicker\nha il ticker?}
    F -- Sì --> Z1
    F -- No --> G{Rate limit ok?\nminIntervalMs}
    G -- No --> Z1
    G -- Sì --> H[Calcola effectivePrice\nlive ?? snapshot]

    H --> I{effectivePrice\nvalido?}
    I -- No --> Z1
    I -- Sì --> J[Leggi snapshot da Redis\nbus.get key]

    J --> K{Snapshot trovato\ne basePattern presente?}
    K -- No --> Z2([WARNING + SKIP])
    K -- Sì --> L[recalcFlagOkFromLiveSnapshot\nfetch candele aggiornate\ndetectTrendFlagBreakout]

    L --> M{Recalc\nriuscito?}
    M -- No --> Z3([BLOCCA — fail-safe\nnessun segnale])
    M -- Sì --> N[Calcola flags con effectivePrice\ntrendOk · flagOk\nbreakoutOk · pullbackOk · retracementOk]

    N --> O{trendOk AND flagOk AND\nalmeno un entry mode ok?}
    O -- No --> P[Aggiorna Redis\nsenza segnale]
    P --> Z1

    O -- Sì --> Q[Determina entryMode\nbreakout / pullback / retracement]
    Q --> R{effectivePrice e volume\nsoddisfano entryMode?}
    R -- No --> S([Log ENTRY PENDING])
    R -- Sì --> T{Cooldown\nscaduto?}
    T -- No --> U([Log IN COOLDOWN])
    T -- Sì --> V{riskRegime\n= RISK_ON o null?}
    V -- No --> Z4([BUY BLOCCATO\nrisk regime])
    V -- Sì --> W{Guard events\nearnings / FOMC\nmacro / dividend?}
    W -- Blocca --> Z5([BUY BLOCCATO\nguard event\nhook + evento Redis])
    W -- Ok --> X{Open block attivo?\nbreakout only}
    X -- Sì --> Z6([Segnale DEFERRED\nalta volatilità apertura])
    X -- No --> Y([🚀 BUY SIGNAL\npubblica hook + evento Redis])
```

---

## Fix 1 — Prezzo di riferimento unificato (effectivePrice)

Il fix principale introduce un **prezzo di riferimento unificato** chiamato `effectivePrice`, che sostituisce l'uso inconsistente di `price` e `livePrice` nella versione precedente.

### Logica di calcolo

```mermaid
flowchart LR
    A[lastLiveByTicker\ncache tick live] -->|last ?? ask ?? bid| B{Valore\nfinito?}
    B -- Sì --> C[effectivePrice\n= live price]
    B -- No --> D[Payload snapshot\nlast ?? ask ?? bid]
    D --> C

    C --> E[breakoutOk]
    C --> F[pullbackOk]
    C --> G[retracementOk]
    C --> H[priceOkFinal]
```

### Perché questo è importante

Nella versione precedente `breakoutOk` veniva calcolato con `price` (snapshot) e il check finale usava `livePrice`. I due valori potevano divergere rendendo impossibile soddisfare entrambe le condizioni contemporaneamente.

Con `effectivePrice` unificato tutti i check usano lo stesso valore, eliminando la possibilità di discordanza.

### Codice post-fix

```javascript
// Calcola effectivePrice — unico prezzo di riferimento
const liveQuote = liveState.lastLiveByTicker.get(ticker);
const effectivePrice = Number.isFinite(liveQuote?.last ?? liveQuote?.ask ?? liveQuote?.bid)
  ? (liveQuote?.last ?? liveQuote?.ask ?? liveQuote?.bid)
  : price;

// Tutti i check usano effectivePrice
const priceOk = Number.isFinite(effectivePrice) && Number.isFinite(breakLevel)
  ? effectivePrice > breakLevel + buffer
  : false;
const breakoutOk = priceOk && volumeOk;

// Check finale coerente
const priceOkFinal = entryMode === "pullback"
  ? effectivePrice >= breakLevelPullback && effectivePrice <= breakLevelPullback + pullbackBuffer
  : entryMode === "retracement"
    ? effectivePrice <= retracementEntryLimit
    : effectivePrice >= entryLimit; // breakout
```

---

## Fix 2 — Separazione dei tre scenari di ingresso

Il fix chiarisce la distinzione tra tre scenari di ingresso, prima confusi sotto un'unica variabile `pullbackOk`.

### I tre scenari

```mermaid
flowchart TD
    subgraph BREAKOUT["🔼 Breakout"]
        B1["effectivePrice > breakLevel + buffer"]
        B2[volumeOk]
        B1 & B2 --> B3["entryMode = breakout\nentry = breakLevel + buffer\nSL = flagLow - 0.2 × ATR"]
    end

    subgraph PULLBACK["↩️ Pullback sul breakout"]
        P1["breakoutRecent = true"]
        P2["breakLevel ≤ effectivePrice ≤ breakLevel + buffer"]
        P1 & P2 --> P3["entryMode = pullback\nentry = breakLevel + buffer\nSL = flagLow - 0.2 × ATR"]
    end

    subgraph RETRACEMENT["📉 Retracement su supporto"]
        R1["effectivePrice ≤ retracementEntryLimit\n= supportZone.low + zoneFillK × width"]
        R1 --> R2["entryMode = retracement\nentry = retracementEntryLimit\nSL = min(structuralSL, volatilitySL)"]
    end
```

### Priorità di selezione

```mermaid
flowchart TD
    A{breakoutOk?} -- Sì --> B[entryMode = breakout]
    A -- No --> C{pullbackOk?}
    C -- Sì --> D[entryMode = pullback]
    C -- No --> E{retracementOk?}
    E -- Sì --> F[entryMode = retracement]
    E -- No --> G([entryMode = null\nnessun segnale])
```

### Codice post-fix

```javascript
// Breakout: prezzo sopra il flag high
const priceBreakoutOk = effectivePrice > breakLevel + buffer;
const breakoutOk = priceBreakoutOk && volumeOk;

// Pullback sul breakout: prezzo rientrato vicino al breakout level
const pullbackOk = breakoutRecent &&
  effectivePrice >= breakLevel &&
  effectivePrice <= breakLevel + buffer;

// Retracement su supporto: prezzo sceso nella zona di supporto
const retracementOk =
  Number.isFinite(retracementEntryLimit) &&
  effectivePrice <= retracementEntryLimit;

// Priorità: breakout > pullback > retracement
const entryMode = breakoutOk ? "breakout"
  : pullbackOk ? "pullback"
  : retracementOk ? "retracement"
  : null;
```

---

## Fix 3 — Recalc del flag con politica fail-safe

Il fix introduce una politica **fail-safe** per il recalc del flag: se non è possibile ricalcolare il pattern con dati freschi, il segnale viene bloccato invece di usare dati potenzialmente stantii da Redis.

### Flusso del recalc

```mermaid
flowchart TD
    A([recalcFlagOkFromLiveSnapshot]) --> B{cachemanagerUrl\nconfigurato?}
    B -- No --> F([Restituisce null])

    B -- Sì --> C{Candele in cache locale\nancora fresche?\nLIVE_SIGNAL_CANDLE_CACHE_TTL_MS}
    C -- Sì --> D[Usa candele\nin memoria]
    C -- No --> E[Fetch HTTP\nGET /candles?symbol=...&tf=signalTf]

    E --> E2{Risposta ok e\ncandele sufficienti?}
    E2 -- No --> E3{Cache locale\ndisponibile?}
    E3 -- Sì --> D
    E3 -- No --> F

    E2 -- Sì --> E4[Salva in cache locale]
    E4 --> D

    D --> G[Aggiorna ultimo candle\ncon effectivePrice e volume]
    G --> H[detectTrendFlagBreakout\nsu candele aggiornate]
    H --> I([Restituisce pattern\ncon flagOk fresco])
```

### Politica post-fix sul risultato null

```javascript
const recalculatedPattern = await recalcFlagOkFromLiveSnapshot({
  ticker, price: effectivePrice, volume, cachemanagerUrl, logger,
});

// Fail-safe: se il recalc non è disponibile, non emettere segnali
if (recalculatedPattern === null) {
  logger?.warning?.(
    `[live] flagOk recalc non disponibile ticker=${ticker} — segnale bloccato (fail-safe)`
  );
  await bus.set(key, updated, { EX: SNAPSHOT_TTL_SECONDS });
  return true;
}

const flagOk = recalculatedPattern.flagOk;
```

### Perché fail-safe e non fail-open

Usare un `flagOk` stantio da Redis significa valutare un pattern calcolato ore prima, quando il prezzo era in una posizione diversa. Un falso segnale in condizioni di mercato cambiate è più pericoloso di un segnale mancato. La politica conservativa è preferibile in un sistema di trading automatico.

---

## Fix 4 — Reintroduzione del rate limit per ticker

Il fix reintroduce il rate limit per ticker che era presente nella versione originale ma rimosso nel refactoring.

### Logica del doppio guard

```mermaid
flowchart TD
    A([Snapshot ricevuto\nper ticker X]) --> B{runningByTicker\nha ticker X?}
    B -- Sì --> Z([SKIP\nrun in corso])
    B -- No --> C{"now - lastRun\n< minIntervalMs?"}
    C -- Sì --> Z2([SKIP\nrate limited])
    C -- No --> D["lastRunByTicker.set(ticker, now)"]
    D --> E["runningByTicker.add(ticker)"]
    E --> F[Esegui\nupdateSnapshotFlagsFromLive]
    F --> G["runningByTicker.delete(ticker)"]
```

### Parametri configurabili

| Variabile env | Default | Descrizione |
|---|---|---|
| `LIVE_RECALC_INTERVAL_MS` | `60000` | Intervallo minimo tra due valutazioni dello stesso ticker (ms) |

### Codice post-fix

```javascript
const now = Date.now();

// Guard 1: nessun run in corso per questo ticker
if (liveState.runningByTicker.has(ticker)) {
  logger?.trace?.(`[live][trace] snapshot skipped ticker=${ticker}: run in corso`);
  return;
}

// Guard 2: rate limit
const lastRun = liveState.lastRunByTicker.get(ticker) || 0;
if (now - lastRun < liveState.minIntervalMs) {
  logger?.trace?.(
    `[live][trace] snapshot rate-limited ticker=${ticker} ` +
    `nextRunIn=${Math.ceil((liveState.minIntervalMs - (now - lastRun)) / 1000)}s`
  );
  return;
}

liveState.lastRunByTicker.set(ticker, now);
liveState.runningByTicker.add(ticker);

try {
  await updateSnapshotFlagsFromLive(ticker, effectivePrice, volume, dataMode, ts, liveData, deps);
} finally {
  liveState.runningByTicker.delete(ticker);
}
```

---

## Configurazione e dipendenze

### Variabili d'ambiente rilevanti

| Variabile | Default | Descrizione |
|---|---|---|
| `LIVE_RECALC_INTERVAL_MS` | `60000` | Rate limit tra valutazioni dello stesso ticker (ms) |
| `LIVE_SIGNAL_CANDLE_CACHE_TTL_MS` | `120000` | TTL cache locale delle candele signal per ticker (ms) |
| `LIVE_INTRADAY_TF` | `1min` | Timeframe per il check del candle range sul breakout |
| `MARKET_OPEN_UTC` | `14:30` | Orario apertura NYSE in UTC per il blocco apertura |
| `BREAKOUT_OPEN_BLOCK_MINUTES` | `25` | Minuti dall'apertura in cui i breakout sono bloccati |
| `RISK_ON_TTL_MS` | `60000` | TTL della cache del regime di rischio da liquidity-manager |
| `FMP_API_KEY` | — | API key Financial Modeling Prep (richiesta per i guard) |
| `DE_EARNINGS_GUARD_ENABLED` | `true` | Abilita il guard earnings |
| `EARNINGS_BLOCK_WEEKS` | `2` | Settimane di blocco prima/dopo earnings |
| `DE_FOMC_GUARD_ENABLED` | `true` | Abilita il guard FOMC |
| `DE_FOMC_BLOCK_DAYS` | `2` | Giorni di blocco prima del FOMC |
| `DE_MACRO_GUARD_ENABLED` | `true` | Abilita il guard macro (CPI, NFP) |
| `DE_MACRO_BLOCK_DAYS` | `1` | Giorni di blocco prima di eventi macro |
| `DE_DIVIDEND_GUARD_ENABLED` | `true` | Abilita il guard ex-dividend |
| `DE_DIVIDEND_BLOCK_DAYS` | `3` | Giorni di blocco prima dell'ex-date |
| `DE_DOLLARS_PER_TRADE` | `5000` | Capitale default per trade se capital-manager non disponibile |
| `DE_ORDER_TIF` | `DAY` | Time in force degli ordini IBKR |

### Dipendenze esterne del flusso live

```mermaid
flowchart LR
    MDS[market-data-service] -->|tick live + snapshot| DE[decision-engine]

    DE -->|GET /candles| CM[cachemanager]
    DE -->|GET /liquidity-score| LM[liquidity-manager]
    DE -->|POST /allocation/quote\nPOST /allocation/reserve\nPOST /allocation/release| CAP[capital-manager]
    DE -->|POST /order| BE[broker-executor-ibkr]
    DE -->|GET /accounts| IB[ibkr-bridge]
    DE -->|publish events + hooks| RD[(Redis)]
```

Tutte le dipendenze sono chiamate in modo asincrono e non bloccano il flusso in caso di errore, ad eccezione di `capital-manager` in fase di quote: se risponde con rejection, l'ordine viene bloccato.
