---
sidebar_position: 5
title: Market Simulator — Replay di dati storici come mercato live
---

# Market Simulator — Replay di dati storici come mercato live

## Obiettivo

Realizzare un microservizio `market-simulator` che consenta di **riprodurre una sessione di mercato storica come se fosse live**, rendendo il processo completamente trasparente al resto del sistema di trading.

Il simulatore riceve in ingresso una **finestra temporale** (`startDate`, `endDate`) e si sostituisce alla sorgente dati IBKR, servendo candele e tick storici — recuperati dal `cachemanager` — alla stessa velocità (o a un multiplo di essa) con cui si sarebbero presentati in tempo reale.

> **Principio chiave**: nessun microservizio downstream (`decision-engine`, `alertingservice`, `capital-manager`, ecc.) deve sapere se i dati che riceve provengono dal mercato reale o dal simulatore. Il comportamento dell'intero sistema deve essere identico.

---

## Contesto attuale — come funziona il flusso dati live

Per comprendere il punto di innesto del simulatore, è utile tracciare il flusso dati attuale:

```
IBKR Gateway
    │
    ▼
ibkr-bridge          ← proxy REST verso IBKR (snapshot, subscribe/unsubscribe)
    │
    ▼
market-data-service  ← normalizza tick, pubblica su Redis
    │
    ├──▶ Redis channel: {ENV}.trend   (tick live)
    │
    └──▶ Redis channel: {ENV}.market-data-service.data
              │
              ▼
        decision-engine  →  Fase 6 live update
        altri consumer   →  alertingservice, capital-manager, ...
```

Il `market-data-service` conosce due modalità operative:

1. **Live**: apre WS verso `ibkr-bridge` (`IBKRGW_BASE_URL`), riceve tick e li pubblica su Redis
2. **Snapshot loop**: chiama periodicamente `ibkr-bridge` (`GET /mirror/iserver/marketdata/snapshot`), normalizza e pubblica

Nessun consumer a valle tocca mai `ibkr-bridge` direttamente — tutto passa per `market-data-service` e i canali Redis.

---

## Architettura del simulatore

### Punto di intercettazione: livello `ibkr-bridge`

Il simulatore **espone la stessa superficie API di `ibkr-bridge`**. Quando la simulazione è attiva, `market-data-service` punta a `market-simulator` invece di `ibkr-bridge`:

```
cachemanager (dati storici)
    │
    ▼
market-simulator     ← emula ibkr-bridge con dati storici
    │
    ▼
market-data-service  ← invariato — crede di parlare con IBKR
    │
    ▼
Redis ({ENV}.trend, {ENV}.market-data-service.data)
    │
    ▼
decision-engine, alertingservice, capital-manager, ...   ← invariati
```

Questo approccio garantisce la massima trasparenza: l'unica differenza rispetto alla modalità live è che `MARKETSIM_URL` sostituisce `IBKRGW_BASE_URL` nella configurazione di `market-data-service`.

### Cosa espone `market-simulator` verso `market-data-service`

| Endpoint simulato | Endpoint `ibkr-bridge` originale | Comportamento |
|---|---|---|
| `GET /mirror/iserver/marketdata/snapshot` | identico | Ritorna prezzi al `simClock` corrente |
| `POST /mirror/iserver/marketdata/subscribe` | identico | Registra ticker per il replay |
| `POST /mirror/iserver/marketdata/unsubscribe` | identico | Rimuove ticker dal replay |
| `WS /v1/api/ws` | identico | Stream di tick storici a velocità simulata |
| `GET /v1/api/iserver/auth/status` | identico | Ritorna sempre `authenticated: true` |
| `POST /v1/api/iserver/tickle` | identico | No-op, risponde `ok` |

---

## Simulation clock

Il cuore del simulatore è un **orologio virtuale** (`simClock`) che avanza in base al parametro `speedMultiplier`:

```
tempo reale trascorso × speedMultiplier = avanzamento del simClock
```

Esempi:

| `speedMultiplier` | Durata di replay di 1 ora di trading |
|---|---|
| `1` (real-time) | 60 minuti |
| `60` | 1 minuto |
| `390` (1 giorno in 1 min) | ~1 minuto (sessione US: 6h 30min) |
| `2340` (1 settimana in 1 min) | ~1 minuto |

Il `simClock` si aggiorna su un loop interno ogni `tickInterval` ms (configurabile, default 500ms). Ad ogni tick del loop il simulatore:

1. Avanza il `simClock` di `tickInterval × speedMultiplier` ms
2. Individua le candele storiche (da cachemanager) il cui timestamp cade nella finestra `[simClock - tickInterval × speedMultiplier, simClock]`
3. Le emette come payload normalizzati sullo stesso formato che `market-data-service` si aspetta da IBKR

---

## Flusso di replay dettagliato

### Avvio simulazione

```
POST /market-simulator/simulation/start
{
  "startDate": "2024-09-02",
  "endDate":   "2024-09-30",
  "tickers":   ["AAPL", "MSFT", "NVDA"],
  "speedMultiplier": 60,
  "timeframe": "1min"
}
```

1. Il simulatore imposta `simClock = startDate T09:30:00 ET`
2. Pre-fetcha le candele storiche da `cachemanager` per tutti i ticker nel range date (`GET /cachemanager/candles?symbol=AAPL&tf=1min&from=...&to=...`)
3. Costruisce un indice in memoria ordinato per timestamp: `Map<ts, CandleByTicker[]>`
4. Avvia il loop di replay

### Durante il replay

Per ogni iterazione del loop:

```
simClock += tickInterval × speedMultiplier

candlesAtSim = index.getRange(prevSimClock, simClock)
for each candle in candlesAtSim:
  emit({
    ticker: candle.symbol,
    last:   candle.close,
    high:   candle.high,
    low:    candle.low,
    volume: candle.volume,
    ts:     candle.timestamp   // timestamp storico originale
  })
```

I payload vengono:
- Bufferati per la risposta alle chiamate `GET /mirror/iserver/marketdata/snapshot` (restituisce l'ultimo prezzo per ticker al `simClock` corrente)
- Emessi sul WebSocket `/v1/api/ws` come tick stream verso `market-data-service`

### Fine simulazione

Quando `simClock > endDate T16:00:00 ET`:
- Il simulatore ferma il loop
- Pubblica un evento su Redis: `{ENV}.market-simulator.events` con payload `{ event: "SIM_ENDED", endDate, simDuration }`
- `market-data-service` può essere notificato per tornare in modalità live (o attendere istruzione manuale)

---

## Switching tra modalità live e simulazione

### Approccio runtime (raccomandato)

`market-data-service` già supporta aggiornamento dei settings via `PUT /settings`. Viene aggiunto un setting `ibkrGatewayUrl` modificabile a runtime:

```
# Attiva simulazione
PUT /market-data-service/settings
{ "ibkrGatewayUrl": "http://market-simulator:3020" }

# Ferma live IBKR, riavvia connessione verso simulatore
DELETE /market-data-service/subscriptions   (svuota sottoscrizioni)
POST   /market-data-service/subscriptions   { "tickers": [...] }

# Al termine, ripristina live
PUT /market-data-service/settings
{ "ibkrGatewayUrl": "http://ibkr-bridge:3008" }
```

### Approccio variabile d'ambiente (alternativo)

In alternativa, `market-data-service` legge `MARKETSIM_URL` all'avvio:

```yaml
# docker-compose.simulation.yml
market-data-service:
  environment:
    IBKRGW_BASE_URL: http://market-simulator:3020
```

Questo approccio richiede restart del container ma non modifiche al codice.

---

## Struttura del microservizio

```
market-simulator/
├── server.js                      # createMicroserviceServer
├── modules/
│   └── main.js                    # SimulatorService extends BaseService
├── lib/
│   ├── simulationClock.js         # loop, avanzamento simClock, gestione velocità
│   ├── candleIndex.js             # struttura dati in-memory per lookup rapido per ts
│   └── ibkrEmulator.js            # normalizzazione payload → formato ibkr-bridge
└── routes/
    ├── simulation.js              # /simulation/start|stop|status|speed
    └── ibkrMirror.js              # /mirror/... e WS /v1/api/ws (superficie ibkr-bridge)
```

### `modules/main.js` — `SimulatorService`

Eredita da `BaseService`. Proprietà aggiunte:

| Proprietà | Tipo | Descrizione |
|---|---|---|
| `this.simClock` | `Date \| null` | Ora virtuale corrente |
| `this.simConfig` | `Object \| null` | Configurazione simulazione attiva |
| `this.candleIndex` | `CandleIndex` | Indice in-memory delle candele pre-fetchate |
| `this.simLoop` | `NodeJS.Timer \| null` | Handle del loop di replay |
| `this.lastPrices` | `Map<ticker, TickPayload>` | Ultimo prezzo per ticker (per snapshot) |

### `lib/simulationClock.js`

```js
// Factory — crea e gestisce il loop di simulazione
createSimulationClock({ startDate, endDate, speedMultiplier, tickIntervalMs, onTick, onEnd })
// onTick(simTs, candlesInWindow) → chiamato ad ogni step del loop
// onEnd(simTs)                   → chiamato quando simClock supera endDate
```

### `lib/candleIndex.js`

Struttura dati che organizza le candele storiche per lookup efficiente:

```js
// Costruisce l'indice da un array flat di candele [{symbol, ts, open, high, low, close, volume}]
buildIndex(candles)

// Ritorna tutte le candele con ts ∈ [fromTs, toTs]
getRange(fromTs, toTs)  → Map<symbol, Candle>
```

---

## Endpoint REST del simulatore

Prefisso: `/market-simulator`

### Gestione simulazione

| Metodo | Path | Descrizione |
|---|---|---|
| `POST` | `/simulation/start` | Avvia simulazione con configurazione |
| `DELETE` | `/simulation/stop` | Ferma simulazione in corso |
| `GET` | `/simulation/status` | Stato corrente: simClock, progress %, ticker caricati |
| `PUT` | `/simulation/speed` | Modifica `speedMultiplier` a runtime |
| `PUT` | `/simulation/clock` | Salta a un'ora specifica nella finestra di simulazione |

### Superficie ibkr-bridge (usata da `market-data-service`)

| Metodo | Path | Descrizione |
|---|---|---|
| `GET` | `/mirror/iserver/marketdata/snapshot` | Snapshot prezzi al simClock corrente |
| `POST` | `/mirror/iserver/marketdata/subscribe` | Registra ticker (no-op se già nell'indice) |
| `POST` | `/mirror/iserver/marketdata/unsubscribe` | Deregistra ticker |
| `GET` | `/v1/api/iserver/auth/status` | Sempre `{ authenticated: true }` |
| `POST` | `/v1/api/iserver/tickle` | No-op, risponde `{ session: "sim" }` |
| `WS` | `/v1/api/ws` | Stream di tick storici |

### Endpoint standard BaseService

- `GET /release`, `GET /settings`, `PUT /settings`, `GET /status/health`, ecc.

---

## Payload di stato simulazione

```json
{
  "ok": true,
  "running": true,
  "simClock": "2024-09-15T14:32:00.000Z",
  "startDate": "2024-09-02",
  "endDate": "2024-09-30",
  "progressPercent": 46.7,
  "speedMultiplier": 60,
  "timeframe": "1min",
  "tickersLoaded": ["AAPL", "MSFT", "NVDA"],
  "candlesInIndex": 17280,
  "ticksEmittedTotal": 8130
}
```

---

## Trasparenza al sistema — schema riepilogativo

```
┌─────────────────────────────────────────────────────────┐
│                   MODALITÀ SIMULAZIONE                  │
│                                                         │
│  cachemanager ──► market-simulator ──► market-data-svc  │
│  (dati storici)   (emula ibkr-bridge)  (invariato)      │
│                                                         │
│  Redis: {ENV}.trend  ◄─────────────────────────────────┐│
│                                                         ││
│  decision-engine  ──► Fase 6 ──► ENTRY_SIGNAL ──► alert││
│  (invariato)                     (invariato)   (invariat│
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    MODALITÀ LIVE                        │
│                                                         │
│  IBKR ──► ibkr-bridge ──► market-data-svc               │
│                            (invariato)                  │
│                                                         │
│  Redis: {ENV}.trend  ◄─────────────────────────────────┐│
│                                                         ││
│  decision-engine  ──► Fase 6 ──► ENTRY_SIGNAL ──► alert││
│  (invariato)                     (invariato)   (invariat│
└─────────────────────────────────────────────────────────┘
```

L'unica differenza tra le due modalità è l'URL di `market-data-service` per i dati di mercato.

---

## Prerequisiti e limitazioni

### Prerequisiti

| Prerequisito | Motivo |
|---|---|
| `cachemanager` con storico 1min per i ticker simulati | Il simulatore preleva candele da cachemanager — se mancano, quella finestra è vuota |
| `market-data-service` aggiornato per `ibkrGatewayUrl` runtime | Permette lo switch live ↔ simulazione senza restart |
| Fase 5 eseguita sulla data di simulazione | La Fase 6 legge snapshot Redis Fase 5; per simulare Fase 6 bisogna avere snapshot pre-calcolati per le date simulate |

### Limitazioni V1

| Limitazione | Note |
|---|---|
| **Solo dati cached** | Il simulatore non scarica dati storici: usa solo ciò che `cachemanager` ha già in L2/L3. Per periodi non cached, bisogna eseguire un pre-fetch prima di avviare la simulazione. |
| **No esecuzione ordini simulata** | `brokerExecutor` rimane invariato. In modalità simulazione, le posizioni aperte andrebbero eseguite su un broker paper (IBKR paper trading) o in un layer di order simulation separato (fuori scope V1). |
| **No mercato orari serali/pre-market** | Il replay rispetta solo orari di mercato `09:30–16:00 ET` delle date nella finestra. Candele fuori orario vengono skippate. |
| **Granularità minima 1min** | Il simulatore usa candele 1min come unità base. Tick sub-minuto non sono disponibili senza dati di livello 2 (fuori scope). |
| **Indice in-memory** | Le candele vengono caricate in RAM all'avvio della simulazione. Per finestre molto ampie (es. 1 anno × 500 ticker a 1min ≈ ~130M record) potrebbe essere necessario un approccio a finestra scorrevole. |

---

## Casi d'uso principali

### 1. Test di regressione del decision-engine

Dopo modifiche al `decision-engine`, si esegue una simulazione sulla stessa finestra storica usata come riferimento e si confrontano i segnali `ENTRY_SIGNAL` emessi con quelli attesi. Permette di rilevare regressioni senza attendere una sessione live.

### 2. Validazione di una nuova pipe utente

Un nuovo set di parametri (pesi, soglie, filtri) viene testato in simulazione prima di andare live. La Fase 5 viene eseguita per ogni data della finestra simulata e la Fase 6 viene monitorata in replay.

### 3. Debug di situazioni specifiche

Dato un ticker che avrebbe dovuto triggherare un segnale in una data precisa, la simulazione permette di rieseguire quella sessione step-by-step aumentando il livello di log.

### 4. Stress test e calibrazione parametri

Si eseguono simulazioni di periodi ad alta volatilità (es. agosto 2024, marzo 2020) per verificare che i meccanismi di controllo del rischio (riskOn check, candle range check, cooldown) si comportino come atteso.

---

## Variabili d'ambiente

| Variabile | Default | Descrizione |
|---|---|---|
| `PORT` | `3020` | Porta HTTP del simulatore |
| `CACHEMANAGER_URL` | `http://cachemanager:3002` | URL per il fetch delle candele storiche |
| `SIM_TICK_INTERVAL_MS` | `500` | Frequenza del loop interno di replay (ms) |
| `SIM_DEFAULT_TIMEFRAME` | `1min` | Timeframe candele usato di default |
| `SIM_MAX_TICKERS` | `200` | Numero massimo di ticker caricabili in un'unica simulazione |
| `SIM_PREFETCH_BATCH` | `20` | Numero di ticker per batch durante il pre-fetch da cachemanager |

---

## Roadmap di implementazione

### Milestone 1 — Fondamenta e replay base

- [ ] Scaffolding microservizio con `BaseService` e `createMicroserviceServer`
- [ ] Implementare `lib/candleIndex.js` con lookup per range temporale
- [ ] Implementare `lib/simulationClock.js` con loop e `speedMultiplier`
- [ ] Route `POST /simulation/start` con pre-fetch da cachemanager
- [ ] Route `GET /simulation/status` e `DELETE /simulation/stop`

### Milestone 2 — Superficie ibkr-bridge

- [ ] Endpoint `GET /mirror/iserver/marketdata/snapshot` con prezzi al `simClock`
- [ ] Endpoint auth/tickle no-op
- [ ] WebSocket `/v1/api/ws` con stream tick al ritmo del loop
- [ ] Test manuale: puntare `market-data-service` al simulatore e verificare pubblicazione su Redis `{ENV}.trend`

### Milestone 3 — Integrazione Fase 6

- [ ] Verificare che `decision-engine` in modalità live riceva tick dal simulatore senza modifiche
- [ ] Eseguire una simulazione completa: Fase 5 su data storica + Fase 6 in replay
- [ ] Confrontare `ENTRY_SIGNAL` emessi con aspettative storiche
- [ ] Aggiungere `PUT /simulation/speed` e `PUT /simulation/clock` (seek)

### Milestone 4 — Switching runtime in `market-data-service`

- [ ] Aggiungere setting `ibkrGatewayUrl` modificabile via `PUT /market-data-service/settings`
- [ ] Logica di reconnect automatico al cambio URL
- [ ] UI: pannello simulazione nella pagina microservizio `market-data-service` in AstraAI

### Milestone 5 — Gestione finestre grandi e pre-fetch

- [ ] Pre-fetch a finestra scorrevole per simulazioni > 30 giorni o > 100 ticker
- [ ] Stima memoria pre-avvio: warning se indice supera soglia configurata
- [ ] Persistenza stato simulazione su Redis (per recovery dopo restart)

---

## Note tecnologiche

- Il microservizio **non ha dipendenze da IBKR** — interagisce solo con `cachemanager` e Redis
- Nessun accesso diretto al database (`datahub`/`dbmanager`) durante il replay — i dati storici transitano solo da cachemanager
- Il WebSocket verso `market-data-service` usa lo stesso protocollo del gateway IBKR reale: messaggi JSON con struttura `{ topic, data }` — nessuna modifica lato consumer
- Per simulazioni lunghe (mesi), il pre-fetch iniziale da cachemanager può richiedere diversi secondi: l'avvio è asincrono con stato `LOADING` restituito da `GET /simulation/status`
- La data storica contenuta nel campo `ts` dei tick emessi è quella **originale** della candela, non il `wallclock` del processo. Questo permette al `decision-engine` (e a qualsiasi componente che logga timestamp) di registrare eventi con la data simulata — utile per analisi storiche dei log.
