---
sidebar_position: 1
title: Piano Implementativo Completo
---

# Piano Implementativo Completo

> **Documento di lavoro** — aggiornato il 26 marzo 2026
> Basato su sessione di brainstorm architetturale.
> Riferimento: codebase `market-simulator` v1.1.0, `decision-engine`, `liquidity-manager`.
> **Aggiornamento:** `sim-engine` e `sim-engine` (modulo broker) unificati in un singolo microservizio `sim-engine`. Nessuna modifica agli altri microservizi. Nessuna modifica agli altri microservizi — solo variabili d'ambiente cambiano in ambiente di simulazione.

---

## Indice

1. [Principi architetturali](#1-principi-architetturali)
2. [Architettura a strati](#2-architettura-a-strati)
3. [sim-engine — microservizio unico di simulazione](#3-sim-engine--microservizio-unico-di-simulazione)
4. [SimClock — il cuore del sistema](#4-simclock--il-cuore-del-sistema)
5. [SimScheduler — scheduler virtuale](#5-simscheduler--scheduler-virtuale)
6. [Liquidity Manager — backfill storico](#6-liquidity-manager--backfill-storico)
7. [Capital Manager in simulazione](#7-capital-manager-in-simulazione)
8. [Modalità di esecuzione](#8-modalità-di-esecuzione)
9. [Responsabilità di scrittura DB](#9-responsabilità-di-scrittura-db)
10. [Spot Instance — ambiente dedicato](#10-spot-instance--ambiente-dedicato)
11. [Schema DB — tabelle risultati](#11-schema-db--tabelle-risultati)
12. [Piano di implementazione a sprint](#12-piano-di-implementazione-a-sprint)
13. [Analisi velocità simulazione](#13-analisi-velocità-simulazione)

---

## 1. Principi architetturali

### 1.1 Il tempo è un dato, non il sistema operativo

Ogni componente che oggi chiama `Date.now()` o `new Date()` deve passare attraverso `SimClock.now()`. In modalità live ritorna `Date.now()`. In modalità simulata ritorna il timestamp dell'ultima candela ricevuta. Il decision-engine non sa in quale modalità sta girando — lo determina automaticamente dalla presenza o assenza di un tempo iniettato nel SimClock.

### 1.2 Il simulatore è un sostituto drop-in — zero modifiche agli altri microservizi

**Questa è la prerogativa irrinunciabile del sistema di simulazione.** Il software messo in simulazione è identico al software live al byte. L'unica cosa che cambia sono le variabili d'ambiente che puntano al `sim-engine` invece dei servizi reali:

```bash
# Ambiente LIVE/PAPER — invariato
MARKETDATASERVICE_URL=http://market-data-service:3002
BROKER_URL=http://brokerExecutor-ibkr:3005

# Ambiente SIMUL — unica modifica
MARKETDATASERVICE_URL=http://sim-engine:3010/marketservice
BROKER_URL=http://sim-engine:3010/broker
```

Il `sim-engine` è un **singolo microservizio** che unifica le responsabilità di `market-simulator` e `broker-mock`. Espone due path prefix distinti che replicano esattamente le API dei servizi reali che sostituisce:

- `/marketservice/*` — replica l'API di `market-data-service` (candele, subscriptions)
- `/broker/*` — replica l'API di `brokerExecutor-ibkr` (ordini, posizioni, account)

Il DE chiama `${MARKETDATASERVICE_URL}/candle` e `${BROKER_URL}/orders` — il path prefix è trasparente perché le URL base già contengono il prefisso. Nessun microservizio sa di essere in simulazione. Nessun codice viene modificato. Nessun rischio di divergenza tra live e simulato.

### 1.3 Un solo container, due interfacce

Unificare `market-simulator` e `broker-mock` in `sim-engine` porta vantaggi concreti oltre alla semplicità di deployment:

- Il fill engine ha accesso diretto alle candele correnti **in-process** — nessuna chiamata HTTP tra i due moduli per il mark-to-market e il tentativo di fill
- Un solo container da pullare, avviare e monitorare sulla spot instance
- Lo stato del portafoglio e le candele correnti sono nello stesso processo — consistenza garantita senza sincronizzazione

La separazione logica rimane intatta: `candleFetcher`, `sessionState`, `fillEngine`, `accountState` sono moduli distinti dentro `sim-engine`. Solo il deployment è unificato.

### 1.4 Il broker mock è la fonte di verità per il capitale

Il capital manager è stateless — calcola tutto dai dati del broker in real time. In simulazione il broker mock mantiene lo stato interno del portafoglio (cash, posizioni aperte, NAV mark-to-market) e risponde agli stessi endpoint che il capital manager interroga oggi su IBKR. Zero modifiche al capital manager.

### 1.5 La velocità è decoupled dalla correttezza

A qualsiasi velocità di replay — 1x, 100x, ∞x — la sequenza causale degli eventi è identica. Un tick avanza il clock, il DE processa, il broker risponde. L'ordine non cambia mai.

### 1.6 Il liquidity index è un lookup, non un calcolo

Il `liquidity-manager` non viene avviato sulla spot instance. L'indice è pre-calcolato una volta sola e letto dalla tabella `liquidity_index_daily` per data virtuale. Zero differenze tra live e sim nel codice del DE.

---

## 2. Architettura a strati

```
┌─────────────────────────────────────────────────────────────┐
│  FASE 0 — pre-calcolo (ambiente LIVE/PAPER, una tantum)     │
│  liquidity-manager POST /backfill → liquidity_index_daily   │
│  ranking backfill → ast_ranking_daily                       │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  SPOT INSTANCE — on demand                                  │
│                                                             │
│  Layer 0: sim-controller                                    │
│    pre-check · configura sessione · loop · raccoglie result │
│                                                             │
│  Layer 1: sim-engine:SIMUL  (microservizio unico)           │
│    /marketservice/*  replay candele · SimClock broadcast    │
│    /broker/*         fill logic · account · posizioni       │
│    moduli interni: candleFetcher · fillEngine · accountState│
│    cachemanager locale (copia da LIVE) → min. chiamate FMP  │
│                                                             │
│  Layer 2: Redis locale                                      │
│    read layer: candles · ranking · liquidity (preloaded)    │
│    write queue: trades · snapshots → db-writer              │
│                                                             │
│  Layer 3: microservizi invariati (stessa immagine del LIVE) │
│    decision-engine · tickerscanner · capital-manager        │
│    SimClock.now() ← candle.t                                │
│    SimScheduler → EOD / BOD / scan                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  DB LIVE/PAPER — tabelle permanenti                         │
│  sim_runs · sim_trades · sim_daily_snapshots                │
│  sim_ticker_stats · sim_trade_legs (opzionale)              │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. sim-engine — microservizio unico di simulazione

### 3.1 Struttura del progetto

`sim-engine` sostituisce i due microservizi separati (`market-simulator` e `broker-mock`) con un unico container. La struttura rispecchia la separazione logica dei moduli mantenendo un deployment unificato:

```
sim-engine/
  server.js              ← entry point, registra i due router sotto path prefix
  modules/
    main.js              ← SimEngine extends BaseService, inizializza tutti i moduli
  lib/
    candleFetcher.js     ← lettura candele da cachemanager/Redis/file
    sessionState.js      ← stato sessione (SimClock, ticker, range, tf)
    fillEngine.js        ← fill logic MIN/MAX, slippage, commissioni
    accountState.js      ← cash, posizioni, NAV mark-to-market
    snapshotPublisher.js ← pubblica candele su Redis (inject mode)
  routes/
    marketservice/       ← replica API di market-data-service
      session.js         ← POST/GET/DELETE /marketservice/session
      subscriptions.js   ← POST/GET/DELETE /marketservice/subscriptions
      candle.js          ← GET /marketservice/candle, GET /marketservice/candle/range
    broker/              ← replica API di brokerExecutor-ibkr
      orders.js          ← POST/GET/DELETE /broker/orders
      positions.js       ← GET /broker/positions, /broker/positions/value
      account.js         ← GET /broker/account, /broker/account/buying-power
      reset.js           ← POST /broker/reset
```

### 3.2 server.js — routing per path prefix

```javascript
// sim-engine/server.js
const { createMicroserviceServer } = require('../shared/serverFactory');
const SimEngine = require('./modules/main');

const createSessionRouter       = require('./routes/marketservice/session');
const createSubscriptionsRouter = require('./routes/marketservice/subscriptions');
const createCandleRouter        = require('./routes/marketservice/candle');
const createOrdersRouter        = require('./routes/broker/orders');
const createPositionsRouter     = require('./routes/broker/positions');
const createAccountRouter       = require('./routes/broker/account');
const createResetRouter         = require('./routes/broker/reset');

createMicroserviceServer({
  ServiceClass:  SimEngine,
  microservice:  'sim-engine',
  moduleName:    'RESTServer',
  moduleVersion: '1.0.0',
  defaultPort:   3010,

  routes: [
    // Path prefix /marketservice → replica market-data-service API
    { path: '/marketservice/session',       router: createSessionRouter,       protected: true },
    { path: '/marketservice/subscriptions', router: createSubscriptionsRouter, protected: true },
    { path: '/marketservice/candle',        router: createCandleRouter,        protected: true },

    // Path prefix /broker → replica brokerExecutor-ibkr API
    { path: '/broker/orders',    router: createOrdersRouter,   protected: true },
    { path: '/broker/positions', router: createPositionsRouter, protected: true },
    { path: '/broker/account',   router: createAccountRouter,   protected: true },
    { path: '/broker/reset',     router: createResetRouter,     protected: true },

    // Endpoint di controllo simulazione (usati dal sim-controller)
    { path: '/sim', router: createSimControlRouter, protected: true },
  ],
});
```

### 3.3 Variabili d'ambiente in simulazione

```bash
# .env.live — invariato, mai toccato
MARKETDATASERVICE_URL=http://market-data-service:3002
BROKER_URL=http://brokerExecutor-ibkr:3005

# .env.sim — unica modifica per tutti i microservizi che usano questi URL
MARKETDATASERVICE_URL=http://sim-engine:3010/marketservice
BROKER_URL=http://sim-engine:3010/broker
```

Il DE costruisce le URL come `${MARKETDATASERVICE_URL}/candle` e `${BROKER_URL}/orders`. Il path prefix è incluso nella base URL — trasparente per il chiamante.

### 3.4 Vantaggio in-process: fill engine accede alle candele direttamente

Il beneficio principale dell'unificazione è che `fillEngine` e `candleFetcher` girano nello stesso processo. Ad ogni tick il sim-controller chiama un solo endpoint:

```javascript
// POST /sim/tick — un'unica chiamata, tutto avviene in-process
async function tick(req, res) {
  const date = state.currentDate;

  // 1. Fetch candele per tutti i ticker (candleFetcher — in-process)
  const candles = await fetchAllCandles(state.tickers, date, state.tf);

  // 2. Fill engine usa le stesse candele direttamente — zero HTTP
  await fillEngine.processPendingOrders(candles);

  // 3. Account state aggiorna MtM con le stesse candele — zero HTTP
  accountState.updateMarkToMarket(candles);

  // 4. Avanza SimClock
  const hasMore = sessionState.advance();

  res.json({ ok: true, candles, hasMore, date });
}
```

Senza unificazione questo richiederebbe due chiamate HTTP separate e un passaggio di dati tra processi. In-process è un accesso diretto a memoria — sub-millisecondo.

### 3.5 API completa esposta da sim-engine

```
# Marketservice — identica a market-data-service
POST   /marketservice/session              → configura sessione
GET    /marketservice/session              → stato sessione
DELETE /marketservice/session              → stop sessione
POST   /marketservice/session/tick         → avanza un tick (sync mode)
POST   /marketservice/subscriptions        → subscribe tickers
GET    /marketservice/subscriptions        → lista ticker
DELETE /marketservice/subscriptions/:sym   → unsubscribe
GET    /marketservice/candle               → candela singola
GET    /marketservice/candle/range         → range candele
POST   /marketservice/candle/push          → inietta candela custom

# Broker — identica a brokerExecutor-ibkr
POST   /broker/orders                      → piazza ordine
GET    /broker/orders                      → ordini pendenti
GET    /broker/orders/:id                  → stato ordine + candles_to_fill
DELETE /broker/orders/:id                  → cancella ordine
GET    /broker/positions                   → posizioni aperte con MtM
GET    /broker/positions/value             → valore aggregato
GET    /broker/account                     → nav, cash, invested, buying_power
GET    /broker/account/buying-power        → max investabile
POST   /broker/reset                       → azzera stato pre-run

# Controllo simulazione — usati dal sim-controller
POST   /sim/tick                           → tick sync (chiama marketservice + broker internamente)
POST   /sim/reset                          → reset completo (sessione + broker)
GET    /sim/status                         → stato completo (sessione + portafoglio)
```

---

## 4. SimClock — il cuore del sistema

### 4.1 Implementazione

Nuovo file `shared/SimClock.js` — singleton importato da tutti i moduli del DE:

```javascript
// shared/SimClock.js
const SimClock = {
  _t: null,

  // Ritorna il tempo virtuale se in sim, altrimenti Date.now()
  now() {
    return this._t ?? Date.now();
  },

  isLive() {
    return this._t === null;
  },

  isSimulated() {
    return this._t !== null;
  },

  // Chiamato dal market data handler ad ogni candela ricevuta
  advance(timestampMs) {
    this._t = timestampMs;
  },

  reset() {
    this._t = null;
  },

  // Utility che replicano l'interfaccia di Date
  toDate() {
    return new Date(this.now());
  },

  // Ritorna la data nel formato YYYY-MM-DD — usato per query DB
  dayOf() {
    return new Date(this.now()).toISOString().slice(0, 10);
  },

  // Ritorna l'ora UTC corrente (0-23)
  hourOf() {
    return new Date(this.now()).getUTCHours();
  },
};

module.exports = SimClock;
```

### 4.2 Integrazione nel market data handler del DE

```javascript
// decision-engine/lib/marketDataHandler.js
const SimClock   = require('../../shared/SimClock');
const Scheduler  = require('../../shared/SimScheduler');

function handleMarketData(message) {
  if (message.type === 'marketData' && message.ts) {
    SimClock.advance(message.ts);
    Scheduler.tick(); // controlla se attraversiamo soglie temporali
  }
  // tutto il resto rimane invariato
  processSnapshot(message);
}
```

### 4.3 Refactor nel DE — sostituzione Date.now()

Il refactor è un grep guidato. Ogni occorrenza di `Date.now()` o `new Date()` usata come "ora corrente" diventa `SimClock.now()` o `SimClock.toDate()`.

**Non vanno sostituiti:**
- `new Date(someIsoString)` — parsing di una stringa, non "ora corrente"
- `new Date(timestamp)` — conversione da numero, non "ora corrente"
- `Date.now()` usato per misurare performance/latenza reale (es. log timing)

---

## 5. SimScheduler — scheduler virtuale

Sostituisce i cron job del DE con un sistema basato su eventi temporali derivati dal SimClock.

### 5.1 Implementazione

```javascript
// shared/SimScheduler.js
const SimClock = require('./SimClock');
const EventEmitter = require('events');

class SimScheduler extends EventEmitter {
  constructor() {
    super();
    this._lastDay  = null;
    this._lastHour = null;
  }

  // Chiamato dopo ogni SimClock.advance()
  tick() {
    const now  = SimClock.toDate();
    const day  = SimClock.dayOf();
    const hour = SimClock.hourOf();

    // Attraversamento di mezzanotte → EOD del giorno uscente + BOD del nuovo
    if (this._lastDay && day !== this._lastDay) {
      this.emit('eod', { date: this._lastDay });
      this.emit('bod', { date: day });
    }

    // Attraversamento soglia oraria
    if (this._lastHour !== null && hour !== this._lastHour) {
      this.emit('hourly', { hour, date: day });
    }

    // Market close (16:00 UTC per mercati US)
    if (this._lastHour !== null && this._lastHour < 16 && hour >= 16) {
      this.emit('market-close', { date: day });
    }

    this._lastDay  = day;
    this._lastHour = hour;
  }

  reset() {
    this._lastDay  = null;
    this._lastHour = null;
  }
}

module.exports = new SimScheduler(); // singleton
```

### 5.2 Registrazione listener nel DE

```javascript
// decision-engine/modules/main.js (o equivalente bootstrap)
const Scheduler = require('../../shared/SimScheduler');

Scheduler.on('eod',          ({ date }) => runEODBatch(date));
Scheduler.on('bod',          ({ date }) => runMorningSetup(date));
Scheduler.on('market-close', ({ date }) => runMarketCloseRoutine(date));
```

In live questi eventi vengono emessi quando il clock reale avanza normalmente. In simulazione vengono emessi quando il replay delle candele attraversa le soglie. La logica EOD/BOD è identica nei due casi.

---

## 6. Liquidity Manager — backfill storico

### 6.1 Concetto

Il liquidity index viene calcolato **una volta sola** per gli ultimi 2 anni e persistito in tabella. In simulazione viene semplicemente letto per data virtuale. Il `liquidity-manager` non viene avviato sulla spot instance.

L'EMA deve essere calcolata in sequenza cronologica — ogni giorno dipende dall'EMA del giorno precedente. Non è parallelizzabile per data.

### 6.2 Schema tabella

```sql
CREATE TABLE liquidity_index_daily (
  date                DATE        PRIMARY KEY,
  score_raw           DECIMAL(6,2),   -- score istantaneo del giorno
  score_ema           DECIMAL(6,2),   -- EMA(alpha=0.2) pre-calcolata
  score_ema_fast      DECIMAL(6,2),   -- EMA(alpha=0.3) — solo se implementata 2B
  score_ema_slow      DECIMAL(6,2),   -- EMA(alpha=0.1) — solo se implementata 2B
  regime              VARCHAR(16),    -- RISK_ON / NEUTRAL / RISK_OFF / UNKNOWN
  confidence          DECIMAL(4,3),   -- 0.000–1.000
  alpha_effective     DECIMAL(4,3),   -- alpha usato (scalato per confidence)
  decay_applied       BOOLEAN,        -- true se quel giorno era in decay
  ema_staleness_days  INT DEFAULT 0,  -- giorni senza aggiornamento pieno
  created_at          TIMESTAMP DEFAULT NOW()
);
```

### 6.3 Endpoint backfill

```javascript
// POST /liquidity/backfill
// body: { startDate, endDate }
//
// IMPORTANTE: avviare il calcolo da (startDate - 30gg) per il warm-up dell'EMA.
// I primi 30 giorni vengono calcolati ma NON salvati (o salvati con flag warm_up=true).
// Questo evita che i primi tick della sim partano con un'EMA "fredda".

async function backfill({ startDate, endDate }) {
  const warmupStart = subtractDays(startDate, 30);
  const days = getTradingDays(warmupStart, endDate); // solo giorni di trading

  let prevEma = null;
  let prevRegime = 'NEUTRAL';

  for (const date of days) {
    // Recupera dati storici dal cachemanager
    const { vix, spy, dxy, creditSpread } = await fetchHistoricalInputs(date);

    // Calcola score con la stessa formula del calcolo live
    const { score, confidence } = computeScore({ vix, spy, dxy, creditSpread });

    // Inizializza EMA al primo giorno
    if (prevEma === null) prevEma = score;

    // Applica logica EMA con scaling per confidence (da documento miglioramenti)
    const alpha_base = getSetting('LIQ_EMA_ALPHA') || 0.2;
    const LIQ_CONFIDENCE_MIN = getSetting('LIQ_CONFIDENCE_MIN_FOR_UPDATE') || 0.30;

    let score_ema, alpha_effective, decay_applied;
    if (confidence >= LIQ_CONFIDENCE_MIN) {
      alpha_effective = alpha_base * confidence;
      score_ema       = alpha_effective * score + (1 - alpha_effective) * prevEma;
      decay_applied   = false;
    } else {
      const NEUTRAL     = getSetting('LIQ_EMA_NEUTRAL_TARGET') || 50;
      const DECAY_RATE  = getSetting('LIQ_EMA_DECAY_RATE') || 0.05;
      alpha_effective   = 0;
      score_ema         = prevEma + DECAY_RATE * (NEUTRAL - prevEma);
      decay_applied     = true;
    }

    // Regime con hysteresis
    const regime = computeRegimeWithHysteresis(score_ema, prevRegime);

    // Salva solo se oltre il warm-up period
    if (date >= startDate) {
      await db.upsert('liquidity_index_daily', {
        date, score_raw: score, score_ema, regime,
        confidence, alpha_effective, decay_applied,
      });
    }

    prevEma    = score_ema;
    prevRegime = regime;
  }
}
```

### 6.4 Job giornaliero (aggiornamento live)

Il job live giornaliero aggiunge semplicemente la riga del giorno corrente con la stessa logica del backfill. La tabella cresce di una riga al giorno.

### 6.5 Pre-check nel sim-controller

Prima di avviare qualsiasi sessione di simulazione:

```javascript
async function preCheck({ startDate, endDate }) {
  const missing = await db.query(`
    SELECT d.date
    FROM generate_series(:startDate::date, :endDate::date, '1 day') AS d(date)
    WHERE EXTRACT(DOW FROM d.date) NOT IN (0, 6)  -- escludi weekend
      AND d.date NOT IN (
        SELECT date FROM liquidity_index_daily
      )
  `, { startDate, endDate });

  if (missing.length > 0) {
    throw new Error(
      `Backfill incompleto: mancano ${missing.length} giorni. ` +
      `Primo mancante: ${missing[0].date}. ` +
      `Esegui POST /liquidity/backfill prima di avviare la simulazione.`
    );
  }
}
```

### 6.6 Lettura nel DE (invariata rispetto al live)

```javascript
// Il DE fa sempre e solo questa query — uguale in live e in sim
const liqData = await db.queryOne(`
  SELECT score_ema, regime, confidence
  FROM liquidity_index_daily
  WHERE date = :date
`, { date: SimClock.dayOf() }); // ← unica differenza: usa SimClock
```

---

## 7. Capital Manager in simulazione

### 7.1 Zero modifiche al codice

Il capital manager è stateless — calcola tutto dai dati del broker ad ogni chiamata. In simulazione punta semplicemente al path `/broker` del `sim-engine` invece che a IBKR:

```bash
# .env.live
BROKER_URL=http://brokerExecutor-ibkr:3005

# .env.sim
BROKER_URL=http://sim-engine:3010/broker
```

### 7.2 Endpoint broker mock richiesti dal capital manager

| Endpoint | Dato restituito | Uso nel capital manager |
|---|---|---|
| `GET /account` | `nav`, `cash`, `invested`, `buying_power` | Base per calcolo `maxInvestable` |
| `GET /positions` | lista posizioni con `currentPrice`, `unrealizedPnl` | Esposizione corrente per ticker |
| `GET /positions/value` | valore aggregato mark-to-market | Calcolo `investedPct` |
| `GET /account/buying-power` | `max_investable` | Guardrail finale prima di ogni ordine |

### 7.3 Consistenza NAV

Il NAV restituito da `GET /account` riflette sempre i prezzi dell'ultimo tick ricevuto dal broker mock. Questo garantisce che il capital manager, quando calcola quanto può investire, stia usando il valore reale del portafoglio al momento corrente della simulazione — non quello del tick precedente.

---

## 8. Modalità di esecuzione

### 8.1 Passive (già implementata)

Il DE fa `GET /candle` per ogni decisione. Il simulatore serve la candela on-demand. Utile per debug passo-passo. Non adatta per backtest veloci.

### 8.2 Inject (già implementata)

Il simulatore pubblica le candele su Redis a `intervalMs`. Il DE le consuma come farebbe con il market-data-service live. Adatta fino a ~50-100x di accelerazione.

### 8.3 Sync — per velocità massima (da implementare)

Bypass Redis. Il simulatore chiama direttamente il DE via HTTP e aspetta la risposta prima di avanzare al tick successivo. Niente timer, niente backpressure. Permette di simulare anni in secondi.

**Flusso sync:**
```
Simulator → POST /sim/tick { candles: { AAPL: {...}, MSFT: {...} } }
DE processa tutto in sequenza sincrona
DE risponde { done: true, orders: [...] }
Simulator avanza al tick successivo
```

**Endpoint da aggiungere al DE:**

```javascript
// decision-engine/routes/sim.js
router.post('/sim/tick', async (req, res) => {
  const { candles } = req.body; // { TICKER: candleObj, ... }

  for (const [ticker, candle] of Object.entries(candles)) {
    // Avanza SimClock al timestamp della candela
    SimClock.advance(new Date(candle.t).getTime());
    Scheduler.tick();

    // Processa la candela esattamente come in inject mode
    await handleMarketData({
      type: 'marketData',
      ts: new Date(candle.t).getTime(),
      ticker,
      dataMode: 'snapshot',
      payload: {
        '31': candle.c,
        '84': candle.c * 0.9995,
        '86': candle.c * 1.0005,
        '7762': candle.v,
      },
    });
  }

  res.json({ done: true });
});
```

**Nota:** in sync mode Redis non è necessario. Tutta la comunicazione è HTTP. Il Redis locale sulla spot instance può essere omesso per semplicità.

### 8.4 Analisi velocità

| Scenario | Tick | @ 10ms/tick | @ 30ms/tick | Giudizio |
|---|---|---|---|---|
| 6 mesi daily | 126 | ~1.3s | ~4s | Ottimo |
| 18 mesi daily | 378 | ~4s | ~11s | Ottimo |
| 18 mesi orarie | ~2.450 | ~25s | ~73s | Ok |
| 18 mesi 15min | ~9.800 | ~98s | ~5 min | Parallelismo utile |

Per daily timeframe la sync mode è ampiamente sufficiente senza parallelismo. Il parallelismo diventa interessante per:
- Timeframe sub-orari
- **Parameter sweep**: 10-20 varianti della stessa sim in parallelo per trovare i parametri ottimali

---

## 9. Responsabilità di scrittura DB

La separazione è netta: ogni componente scrive solo quello che **effettivamente conosce** nel momento in cui lo conosce.

### 9.1 Broker mock → `sim_trades`

Scritto al momento esatto del fill. Il broker mock è l'unico che conosce:
- `fill_price`, `slippage`, `commission`
- `candles_to_fill` — quante candele sono passate prima del fill
- `tp_adjustments`, `sl_adjustments` — modifiche durante la vita del trade
- `exit_reason` — STOP_LOSS / TAKE_PROFIT / SIGNAL_EXIT / EOD_FORCED
- `max_adverse_excursion`, `max_favorable_excursion` — aggiornati tick per tick, scritti alla chiusura
- `has_partial_exits`, `partial_exits_count`, `partial_exit_pnl`

### 9.2 Sim-controller → `sim_daily_snapshots`

Scritto a fine di ogni giornata virtuale (evento `SimScheduler.on('eod')`). Il sim-controller è l'unico che conosce:
- `portfolio_value` mark-to-market aggregato (da `GET /account` sul broker mock)
- `drawdown_pct` dal picco storico — calcolato mantenendo il peak in memoria
- `reserved_cash_pct`, `max_investable_pct` — stato del capital manager
- `trades_opened`, `trades_closed` nel giorno — conteggio dei fill del tick

### 9.3 Sim-controller → `sim_runs` e `sim_ticker_stats`

Scritti a fine run, aggregando i dati già presenti in `sim_trades` con query SQL. Sharpe, Sortino, Calmar, win rate, expectancy — calcolati in un'unica passata finale. Non serve tenerli in memoria durante la run.

---

## 10. Spot Instance — ambiente dedicato

### 10.1 Filosofia

La spot instance è un ambiente temporaneo tirato su a richiesta, identico all'ambiente dev-spot già pianificato. Si avvia, esegue la simulazione, si distrugge. I risultati sopravvivono su DB.

### 10.2 Docker tag SIMUL

Ogni immagine usata in simulazione viene taggata esplicitamente con `SIMUL`:

```bash
docker build -t trading/decision-engine:SIMUL \
             -t trading/decision-engine:SIMUL-$(git rev-parse --short HEAD) .
docker build -t trading/sim-engine:SIMUL \
             -t trading/sim-engine:SIMUL-$(git rev-parse --short HEAD) .
docker build -t trading/sim-controller:SIMUL .
```

Il `docker-compose.sim.yml` usa sempre il tag `SIMUL` — nessuna ambiguità su quale versione sta girando. Le immagini `SIMUL` possono contenere endpoint aggiuntivi (`/sim/tick`, `/sim/reset`) non presenti nelle immagini `latest`/`stable` in produzione. L'hash del commit affiancato garantisce riproducibilità assoluta tra run diverse.

### 10.3 Cloudflare Tunnel — accesso remoto

La spot instance espone il sim-controller via Cloudflare Tunnel con DNS dedicato `simul.trading.expovin.it`. Il tunnel viene avviato nello startup script e distrutto col teardown — zero configurazione DNS manuale.

```bash
# sim-startup.sh — parte del bootstrap
cloudflared tunnel --hostname simul.trading.expovin.it \
                   --url http://localhost:3030 \
                   --name sim-$(date +%s) &
```

Permette di monitorare stato della run, consultare log e intervenire manualmente durante l'esecuzione senza accesso diretto alla VM.

### 10.4 Componenti sulla spot instance

In sync mode (raccomandato):
- `sim-engine:SIMUL` — unico container che sostituisce `market-data-service` + `brokerExecutor-ibkr`
- `decision-engine:SIMUL` — identico al LIVE, solo variabili d'ambiente diverse
- `sim-controller:SIMUL`
- `cachemanager:SIMUL` — copia locale del cachemanager LIVE con i suoi dati già cascati
- Accesso in lettura al DB LIVE/PAPER (per `liquidity_index_daily`, `ast_ranking_daily`)
- Accesso in scrittura alle tabelle `sim_*` sul DB LIVE/PAPER

**Non necessari:** `liquidity-manager`, `market-data-service`, `brokerExecutor-ibkr`, `tickerscanner` (ranking pre-calcolato), Redis pub/sub (in sync mode)

### 10.5 Lifecycle automatizzato

```bash
# 1. Provisioning (GCP Spot / AWS Spot)
gcloud compute instances create sim-worker-$(date +%s) \
  --machine-type=n2-standard-4 \
  --preemptible \
  --metadata-from-file startup-script=sim-startup.sh

# sim-startup.sh:
# 2. Pull immagini Docker
docker pull trading/sim-engine:latest
docker pull trading/decision-engine:latest
docker pull trading/sim-controller:latest

# 3. docker-compose up con config sim
docker-compose -f docker-compose.sim.yml up -d

# 4. Il sim-controller prende da qui il controllo
```

### 10.6 Flusso sim-controller

```javascript
async function runSimulation(config) {
  const { startDate, endDate, tickers, tf, speed } = config;

  // Step 1: pre-check dati disponibili
  await preCheck({ startDate, endDate });

  // Step 2: crea record run sul DB permanente
  const runId = await db.insert('sim_runs', {
    start_date: startDate,
    end_date: endDate,
    tickers,
    tf,
    config_snapshot: await snapshotCurrentConfig(), // tutti i settings DE+CM+LM
    initial_capital: await getCapital(),
    status: 'RUNNING',
  });

  // Step 3: reset stato DE e broker mock
  await fetch(`${DE_URL}/sim/reset`, { method: 'POST' });
  await fetch(`${BROKER_URL}/reset`,  { method: 'POST' });

  // Step 4: configura sessione sul sim-engine
  await fetch(`${SIM_URL}/marketservice/session`, {
    method: 'POST',
    body: JSON.stringify({ startDate, endDate, tf, tickers, mode: 'sync' }),
  });

  // Step 5: loop tick
  let hasMore = true;
  while (hasMore) {
    const result = await fetch(`${SIM_URL}/marketservice/session/tick`).then(r => r.json());
    hasMore = result.hasMore;
    // raccoglie snapshot giornaliero se cambio di data
    await maybeFlushDailySnapshot(runId, result);
  }

  // Step 6: flush risultati finali
  const finalStats = await computeFinalStats(runId);
  await db.update('sim_runs', runId, {
    ...finalStats,
    status: 'COMPLETED',
    completed_at: new Date(),
    final_capital: await getPortfolioValue(),
  });

  // Step 7: segnale per teardown sicuro
  await markReadyForTeardown(runId);
}
```

### 10.7 Teardown sicuro

Il teardown script attende che `sim_runs.status = 'COMPLETED'` sia scritto sul DB prima di distruggere l'instance. Se la instance viene killata prima (preemption), il record rimane in stato `RUNNING` — segnale inequivocabile che la run è incompleta.

```bash
# sim-teardown.sh
MAX_WAIT=300 # 5 minuti
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
  STATUS=$(psql $DB_URL -t -c "SELECT status FROM sim_runs WHERE run_id='$RUN_ID'")
  if [ "$STATUS" = "COMPLETED" ]; then
    echo "Run completata, teardown sicuro"
    gcloud compute instances delete $INSTANCE_NAME --quiet
    exit 0
  fi
  sleep 10
  ELAPSED=$((ELAPSED + 10))
done
echo "TIMEOUT — run non completata, instance preservata per debug"
```

---

## 11. Schema DB — tabelle risultati

Tutte le tabelle risiedono sul DB LIVE/PAPER e sopravvivono alla spot instance.

### 11.1 sim_runs

```sql
CREATE TABLE sim_runs (
  run_id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                    TIMESTAMP DEFAULT NOW(),
  completed_at                  TIMESTAMP,
  status                        VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
    -- RUNNING / COMPLETED / FAILED / ABORTED

  -- Configurazione
  start_date                    DATE NOT NULL,
  end_date                      DATE NOT NULL,
  tf                            VARCHAR(10) NOT NULL,
  tickers                       JSONB NOT NULL,
  config_snapshot               JSONB NOT NULL,
    -- TUTTI i settings DE+CM+LM al momento della run — fondamentale per riproducibilità
  initial_capital               DECIMAL(15,2),
  final_capital                 DECIMAL(15,2),
  duration_seconds              INT,

  -- KPI aggregati (calcolati a fine run)
  total_return_pct              DECIMAL(8,4),
  sharpe_ratio                  DECIMAL(8,4),
  sortino_ratio                 DECIMAL(8,4),
  calmar_ratio                  DECIMAL(8,4),
    -- return annuo / max drawdown — misura rischio/rendimento
  max_drawdown_pct              DECIMAL(8,4),
  max_drawdown_duration_days    INT,
  win_rate                      DECIMAL(6,4),
  profit_factor                 DECIMAL(8,4),
    -- gross profit / gross loss — >1.5 è un buon segnale
  avg_win_pct                   DECIMAL(8,4),
  avg_loss_pct                  DECIMAL(8,4),
  expectancy                    DECIMAL(10,4),
    -- win_rate × avg_win - loss_rate × avg_loss = valore atteso per trade
  total_trades                  INT,
  total_commission              DECIMAL(12,4),
  total_slippage                DECIMAL(12,4),
  avg_holding_days              DECIMAL(8,2),
  max_concurrent_positions      INT,
  avg_cash_utilization_pct      DECIMAL(6,4),

  error_log                     TEXT
);
```

### 11.2 sim_trades

```sql
CREATE TABLE sim_trades (
  trade_id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                        UUID NOT NULL REFERENCES sim_runs(run_id),
  ticker                        VARCHAR(20) NOT NULL,
  direction                     VARCHAR(5) NOT NULL,  -- LONG / SHORT

  -- Timing (date virtuali SimClock)
  entry_date                    DATE NOT NULL,
  exit_date                     DATE,
  holding_days                  INT,

  -- Prezzi (post slippage)
  entry_price                   DECIMAL(12,4),
  exit_price                    DECIMAL(12,4),
  qty                           DECIMAL(12,4),

  -- P&L
  gross_pnl                     DECIMAL(12,4),  -- prima di commissioni e slippage
  commission                    DECIMAL(10,4),
  slippage                      DECIMAL(10,4),
  net_pnl                       DECIMAL(12,4),  -- gross - commission - slippage
  return_pct                    DECIMAL(8,4),   -- % sul capitale allocato al trade
  capital_allocated             DECIMAL(12,2),

  -- Uscita
  exit_reason                   VARCHAR(30),
    -- STOP_LOSS / TAKE_PROFIT / SIGNAL_EXIT / EOD_FORCED / MAX_HOLDING / SIM_END

  -- Contesto al momento dell'entry
  entry_signal_score            DECIMAL(8,4),   -- AST_RANKING score
  liquidity_regime_at_entry     VARCHAR(16),    -- RISK_ON / NEUTRAL / RISK_OFF
  liquidity_score_ema_at_entry  DECIMAL(6,2),

  -- Excursion (metriche fondamentali per valutare stop e target)
  max_adverse_excursion         DECIMAL(8,4),
    -- MAE: massimo movimento contro durante il trade
  max_favorable_excursion       DECIMAL(8,4),
    -- MFE: massimo movimento a favore durante il trade

  -- Modifiche TP/SL durante il trade
  tp_adjustments                INT DEFAULT 0,
  sl_adjustments                INT DEFAULT 0,

  -- Fill timing
  candles_to_fill               INT DEFAULT 0,
    -- 0 = fill immediato alla candela successiva (MARKET order)
    -- N = ordine rimasto pendente N candele prima di essere eseguito
  fill_date                     DATE,
  expired_unfilled              BOOLEAN DEFAULT FALSE,

  -- Exit parziali
  has_partial_exits             BOOLEAN DEFAULT FALSE,
  partial_exits_count           INT DEFAULT 0,
  partial_exit_pnl              DECIMAL(12,4) DEFAULT 0
);

CREATE INDEX idx_sim_trades_run    ON sim_trades(run_id);
CREATE INDEX idx_sim_trades_ticker ON sim_trades(run_id, ticker);
```

### 11.3 sim_daily_snapshots

```sql
CREATE TABLE sim_daily_snapshots (
  run_id                        UUID NOT NULL REFERENCES sim_runs(run_id),
  date                          DATE NOT NULL,
  PRIMARY KEY (run_id, date),

  -- Stato portafoglio a fine giornata
  portfolio_value               DECIMAL(15,2),
  cash                          DECIMAL(15,2),
  invested                      DECIMAL(15,2),

  -- P&L
  daily_pnl                     DECIMAL(12,4),
  cumulative_pnl                DECIMAL(12,4),
  drawdown_pct                  DECIMAL(8,4),

  -- Attività del giorno
  open_positions                INT,
  trades_opened                 INT,
  trades_closed                 INT,

  -- Contesto liquidity
  liquidity_score_ema           DECIMAL(6,2),
  liquidity_regime              VARCHAR(16),

  -- Stato capital manager
  reserved_cash_pct             DECIMAL(6,4),
  max_investable_pct            DECIMAL(6,4)
);
```

### 11.4 sim_ticker_stats

```sql
CREATE TABLE sim_ticker_stats (
  run_id                        UUID NOT NULL REFERENCES sim_runs(run_id),
  ticker                        VARCHAR(20) NOT NULL,
  PRIMARY KEY (run_id, ticker),

  total_trades                  INT,
  win_rate                      DECIMAL(6,4),
  net_pnl                       DECIMAL(12,4),
  avg_return_pct                DECIMAL(8,4),
  avg_holding_days              DECIMAL(8,2),
  best_trade_pct                DECIMAL(8,4),
  worst_trade_pct               DECIMAL(8,4),
  avg_mae                       DECIMAL(8,4),
  avg_mfe                       DECIMAL(8,4),
  contribution_pct              DECIMAL(8,4)
);
```

### 11.5 sim_trade_legs (opzionale — fase 2)

Da aggiungere quando si vorrà analizzare le exit parziali nel dettaglio. Non richiede modifiche a `sim_trades`.

```sql
CREATE TABLE sim_trade_legs (
  leg_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id      UUID NOT NULL REFERENCES sim_trades(trade_id),
  leg_type      VARCHAR(20) NOT NULL,  -- PARTIAL_EXIT / FINAL_EXIT
  date          DATE NOT NULL,
  price         DECIMAL(12,4),
  qty           DECIMAL(12,4),
  pnl           DECIMAL(12,4)
);
```

---

## 12. Piano di implementazione a sprint

### Sprint 1 — Liquidity Manager backfill (pre-requisito di tutto)

**Obiettivo:** tabella `liquidity_index_daily` popolata per gli ultimi 2 anni.

- Implementare `POST /liquidity/backfill` con warm-up period di 30 giorni
- Applicare logica EMA + hysteresis + scaling confidence dal documento miglioramenti
- Aggiornare il job live giornaliero per aggiungere la riga del giorno
- Verificare completezza dati con query di controllo

**Eseguibile sull'ambiente LIVE esistente — nessuna spot instance necessaria.**
**Ha valore indipendente dalla simulazione** — migliora già il sistema live.

**Stima:** 2-3 giorni

---

### Sprint 2 — SimClock nel decision-engine

**Obiettivo:** DE time-agnostic, pronto per la simulazione.

- Creare `shared/SimClock.js`
- Creare `shared/SimScheduler.js`
- Refactor: sostituire tutti i `Date.now()` / `new Date()` nel DE con `SimClock.now()`
- Sostituire cron job con listener `SimScheduler`
- Aggiungere `POST /sim/tick` per sync mode
- Aggiungere `POST /sim/reset` per azzerare stato prima di ogni run
- Test: verificare che in assenza di candele simulate il DE si comporti esattamente come prima

**Stima:** 3-4 giorni

---

### Sprint 3 — sim-engine completo

**Obiettivo:** microservizio unico `sim-engine` che sostituisce drop-in sia `market-data-service` che `brokerExecutor-ibkr`. Prima simulazione end-to-end completa. Zero modifiche agli altri microservizi.

- Struttura progetto `sim-engine` con routing per path prefix (`/marketservice/*` e `/broker/*`)
- Modulo `candleFetcher` — lettura da cachemanager locale / Redis / file
- Modulo `fillEngine` — fill logic basata su MIN/MAX candela
- Modulo `accountState` — cash, posizioni aperte, NAV mark-to-market
- Tracking `candles_to_fill`, MAE/MFE, gestione TP/SL, exit parziali
- `POST /sim/tick` — tick unificato in-process, zero HTTP inter-modulo
- Test end-to-end: session su 1 mese, 5 ticker

**Stima:** 4-5 giorni

---

### Sprint 4 — Schema DB e sim-controller

**Obiettivo:** simulazione completamente automatizzata con risultati persistiti.

- Creare tabelle `sim_runs`, `sim_trades`, `sim_daily_snapshots`, `sim_ticker_stats`
- Implementare `sim-controller` con pre-check, loop, flush risultati
- Calcolo KPI aggregati a fine run (Sharpe, Sortino, Calmar, MAE/MFE, expectancy)
- Test: run completa 6 mesi, verifica tutti i campi popolati correttamente

**Stima:** 3-4 giorni

---

### Sprint 5 — Spot Instance automation

**Obiettivo:** provisioning e teardown completamente automatizzati.

- Script `sim-startup.sh` e `sim-teardown.sh`
- `docker-compose.sim.yml` con tutti i servizi necessari
- Teardown sicuro: attende `status=COMPLETED` prima di distruggere
- Test: run completa 18 mesi su spot instance, verifica risultati su DB live

**Stima:** 2-3 giorni

---

### Sprint 6 — Parameter sweep (fase avanzata)

**Obiettivo:** eseguire N varianti della stessa sim in parallelo su worker multipli.

- Orchestratore che spawna N istanze sim-controller con config diverse
- Aggregatore risultati: confronto run su stesse metriche
- Utile per: ottimizzazione alpha EMA, soglie regime, stop loss, sizing

**Stima:** 3-4 giorni (dopo validazione sprint 1-5)

---

## 13. Analisi velocità simulazione

### Stime latenza per tick (sync mode)

| Operazione | Stima |
|---|---|
| Lettura candle da cachemanager/Redis | 1–3 ms |
| Lettura liquidity_index_daily da DB | 1–2 ms |
| Logica entry/exit DE | 5–20 ms |
| Fill broker mock (in-process) | < 1 ms |
| Write trade su sim_trades | 1–3 ms |
| **Totale ottimistico** | **~10 ms** |
| **Totale conservativo** | **~30 ms** |

### Tempo simulazione totale (sync mode, no Redis overhead)

| Scenario | Tick | @ 10ms/tick | @ 30ms/tick |
|---|---|---|---|
| 6 mesi daily | 126 | ~1.3s | ~4s |
| 18 mesi daily | 378 | ~4s | ~11s |
| 18 mesi orarie | ~2.450 | ~25s | ~73s |
| 18 mesi 15min | ~9.800 | ~98s | ~5 min |

### Quando serve il parallelismo

Il parallelismo sulla spot instance (multi-worker) è utile per:
1. **Timeframe sub-orari** con grandi universe di ticker
2. **Parameter sweep** — N varianti in parallelo invece che sequenziali

Per daily timeframe la sync mode single-worker è ampiamente nei target (10-20 min).

---

## Note finali

- **Prerogativa irrinunciabile — zero modifiche agli altri microservizi.** Il software in simulazione è identico al software live al byte. L'unica cosa che cambia sono due variabili d'ambiente: `MARKETDATASERVICE_URL` e `BROKER_URL` che puntano al `sim-engine`. Qualsiasi altra modifica richiederebbe di mantenere due versioni del codice — rischio di divergenza inaccettabile.

- **cachemanager locale sulla spot instance.** Quando viene creata la spot instance, i file del cachemanager dell'ambiente LIVE vengono copiati sulla VM di simulazione. In questo modo il `sim-engine` serve le candele dalla cache locale già popolata, minimizzando al minimo le chiamate al provider (FMP). Il cachemanager sulla spot instance funziona in modalità read-only: legge dalla cache esistente, non fa mai fetch dal provider durante la sim.

- **Riproducibilità:** il campo `config_snapshot` in `sim_runs` è critico. Senza sapere esattamente quali erano i parametri al momento della run, è impossibile replicarla in futuro o confrontare run diverse in modo significativo. Affiancare sempre il tag `SIMUL-{commit-hash}` all'immagine Docker usata.

- **Warm-up EMA:** avviare sempre il backfill 30 giorni prima del `startDate` effettivo. I primi tick della sim altrimenti partono con un'EMA "fredda" che non riflette il contesto macro precedente.

- **Teardown sicuro:** non distruggere mai la spot instance prima che `sim_runs.status = 'COMPLETED'` sia scritto sul DB. In caso di preemption il record rimane `RUNNING` — segnale inequivocabile di run incompleta.
