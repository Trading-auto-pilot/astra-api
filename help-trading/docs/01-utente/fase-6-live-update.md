---
sidebar_position: 8
---

# Fase 6 — Live Daily Update e segnali di ingresso in tempo reale

La Fase 6 è eseguita dal microservizio `decision-engine` in modalità live. Dopo che la Fase 5 ha calcolato i livelli operativi di ingresso e li ha persistiti in Redis, la Fase 6 monitora in tempo reale i tick di mercato per ogni ticker in snapshot e verifica se le condizioni di ingresso si avverano durante la sessione di trading.

Quando tutte le condizioni sono soddisfatte, pubblica un segnale `ENTRY_SIGNAL` sul canale Redis `{ENV}.hooks`, consumato dall'`alertingservice` per notificare l'utente.

**Frequenza:** continua, durante la sessione di mercato (attivata manualmente o tramite scheduler dopo la Fase 5).

---

## Scheda operativa

| Voce | Dettaglio |
|---|---|
| Scopo | Monitorare in tempo reale i ticker del ranking e segnalare l'ingresso quando le condizioni tecniche + macro si verificano. |
| Punto di partenza | Snapshot Redis Fase 5 (livelli operativi) + tick live da `market-data-service` + score macro da `liquidity-manager`. |
| Deliverable | Evento `ENTRY_SIGNAL` pubblicato sul canale Redis `{ENV}.hooks` (consumato da `alertingservice`). |
| Microservizi coinvolti | `decision-engine`, `market-data-service` (tick), `cachemanager` (candle intraday), `liquidity-manager` (regime macro). |

---

## Punto di ingresso (trigger)

La Fase 6 si attiva tramite il tab **"Live Daily"** dell'interfaccia utente, oppure via API:

```http
GET /decision-engine/spot-finder/live/:pipeId
```

Al momento dell'attivazione, il `decision-engine`:

1. Carica lo snapshot Redis della Fase 5 per la pipe specificata (data odierna)
2. Estrae tutti i ticker con almeno un livello `actionable: true`
3. Si sottoscrive ai ticker su `market-data-service` (canale Redis `{ENV}.trend`) per ricevere aggiornamenti live
4. Avvia il loop di monitoraggio

Per fermare il live:

```http
DELETE /decision-engine/spot-finder/live/:pipeId
```

---

## Elaborazione (cosa succede per ogni tick)

Per ogni aggiornamento di prezzo ricevuto da `market-data-service`, il motore esegue i seguenti check in sequenza:

### Step 1: Verifica pattern tecnico (da snapshot Fase 5)

Il motore confronta il prezzo corrente con i livelli dell'ultimo snapshot Redis per quel ticker.

Per ogni livello di ingresso nello snapshot, calcola:

| Controllo | Condizione |
|---|---|
| **trendOk** | EMA20 > EMA50 su timeframe `1h` (pre-calcolato in Fase 5) |
| **flagOk** | Range ultime 20 candele orarie < `max(flagAtrK × ATR, 0.25% del prezzo)` |
| **breakoutOk** | Prezzo live > massimo flag con volume ≥ media 20 periodi × 1.2 |
| **pullbackOk** | Prezzo live ritocca il livello di breakout precedente con volume decrescente |

Il setup tecnico è valido se: `trendOk AND flagOk AND (breakoutOk OR pullbackOk)`.

Se nessun livello supera il check tecnico, il tick viene scartato senza ulteriori elaborazioni.

---

### Step 2: Verifica regime macro — riskOn check

Prima di emettere un segnale, il motore verifica che il mercato sia in regime **RISK_ON** interrogando il `liquidity-manager`:

```http
GET /liquidity-manager/liquidity-score
```

La risposta viene **cachata in memoria per `RISK_ON_TTL_MS`** (default 60 secondi) per evitare overhead eccessivo su ogni tick.

| Campo risposta | Significato |
|---|---|
| `riskRegime` | `"RISK_ON"` \| `"RISK_OFF"` \| `"NEUTRAL"` |
| `score` | Score numerico del regime macro |

**Condizione richiesta:** `riskRegime === "RISK_ON"`.

Se il regime è diverso da `RISK_ON`, il segnale viene bloccato con log `[BLOCKED] riskOn check failed` e il tick viene scartato.

---

### Step 3: Verifica range candela intraday (solo modalità breakout)

Per i livelli di tipo **breakout**, viene eseguito un check aggiuntivo sull'ampiezza dell'ultima candela intraday:

```http
GET /cachemanager/candles/latest?symbol={TICKER}&tf=1min
```

Il check verifica che la candela non sia troppo ampia (candele molto ampie indicano alta volatilità imprevedibile, che aumenta il rischio di slippage sull'entry):

```
candleRange = candle.high - candle.low
maxRange    = flagAtrK × atrLast

Condizione: candleRange ≤ maxRange
```

Dove:
- `atrLast` = ATR(20) dell'ultimo snapshot calcolato in Fase 5
- `flagAtrK` = parametro tier di volatilità (1.1 / 1.3 / 1.6 in base al tier)

Se `candleRange > maxRange`, il segnale viene bloccato con log `[BLOCKED] candle range too wide`.

Questa verifica **non è applicata** ai livelli di tipo **retracement** (ingresso su supporto).

---

### Step 4: Emissione segnale ENTRY_SIGNAL

Se tutti i check superati, il motore pubblica sul canale Redis `{ENV}.hooks`:

```json
{
  "event": "ENTRY_SIGNAL",
  "ticker": "AAPL",
  "pipeId": "42",
  "userId": "7",
  "entryMode": "breakout",
  "entryLimit": 182.40,
  "stopLoss": 170.00,
  "takeProfit1": 185.20,
  "takeProfit2": 194.25,
  "riskRegime": "RISK_ON",
  "riskScore": 0.74,
  "atrLast": 2.15,
  "candleRange": 1.10,
  "ts": 1709560800000
}
```

Il segnale viene inviato **una sola volta** per combinazione `(ticker, entryMode, entryLimit)` grazie all'`ALERT_COOLDOWN_MS` (anti-duplicati in-memory).

---

## Condizioni riepilogate per l'apertura di una posizione

Tutte le seguenti condizioni devono essere soddisfatte **contemporaneamente**:

| # | Condizione | Tipo | Fonte |
|---|---|---|---|
| 1 | `trendOk = true` | Tecnica | Snapshot Fase 5 (EMA20 > EMA50 su 1h) |
| 2 | `flagOk = true` | Tecnica | Snapshot Fase 5 (range compresso) |
| 3 | `breakoutOk OR pullbackOk = true` | Tecnica | Valutazione live del prezzo |
| 4 | `riskRegime = "RISK_ON"` | Macro | `liquidity-manager` (cache 60s) |
| 5 | `candleRange ≤ flagAtrK × ATR` | Intraday | `cachemanager` (solo breakout) |

Se anche solo una condizione non è verificata, il segnale non viene emesso.

---

## Parametri di pilotaggio

| Parametro | Env var | Default | Descrizione |
|---|---|---|---|
| `pipeId` | — | obbligatorio | ID pipe utente da monitorare |
| TTL cache riskOn | `RISK_ON_TTL_MS` | `60000` ms | Frequenza massima di interrogazione del liquidity-manager |
| Timeframe candle intraday | `LIVE_INTRADAY_TF` | `1min` | Timeframe per il candle range check |
| URL liquidity-manager | `LIQUIDITYMANAGER_URL` | `http://liquidity-manager:3001` | Endpoint del servizio di regime macro |
| Anti-duplicati | `ALERT_COOLDOWN_MS` | `300000` ms (5 min) | Finestra di blocco per segnali duplicati |

---

## Microservizi coinvolti

| Microservizio | Ruolo |
|---|---|
| `decision-engine` | Orchestrazione, loop di monitoraggio, emissione segnale |
| `market-data-service` | Fonte tick live via Redis pub/sub (`{ENV}.trend`) |
| `cachemanager` | Lettura ultima candela intraday via `GET /candles/latest` (cache L3 Redis) |
| `liquidity-manager` | Verifica regime macro via `GET /liquidity-score` |
| `alertingservice` | Consumatore del canale `{ENV}.hooks` — notifica email/WhatsApp all'utente |
| `scheduler` | Avvio/stop automatico del live mode (opzionale) |

---

## Avvio manuale e monitoraggio

### Avvio live mode

```http
GET /decision-engine/spot-finder/live/0
```

Risposta:

```json
{
  "ok": true,
  "type": "async",
  "jobId": "live_1772616440778_abc",
  "pipeId": "0",
  "status": "started"
}
```

### Stato del live

```http
GET /decision-engine/spot-finder/live/0/status
```

Risposta:

```json
{
  "ok": true,
  "active": true,
  "tickersMonitored": 42,
  "signalsEmitted": 3,
  "lastRiskOnCheck": {
    "ts": 1709560740000,
    "riskRegime": "RISK_ON",
    "score": 0.74
  }
}
```

### Stop live mode

```http
DELETE /decision-engine/spot-finder/live/0
```

---

## Errori comuni e recovery

| Errore | Causa probabile | Recovery |
|---|---|---|
| Nessun segnale emesso dopo ore | Fase 5 non ha prodotto snapshot per oggi | Verificare che Fase 5 sia stata eseguita: `GET /decision-engine/spot-finder/latest/0` |
| `[BLOCKED] riskOn check failed` nei log | Mercato in regime RISK_OFF o NEUTRAL | Atteso — il sistema funziona correttamente. Attendere cambio regime. |
| `[BLOCKED] candle range too wide` nei log | Alta volatilità intraday per breakout | Atteso su candele esplosive. Nessuna azione richiesta. |
| Live bloccato su `active: true` senza tick | `market-data-service` disconnesso o IBKR offline | Verificare `GET /market-data-service/subscriptions` e stato IBKR |
| Segnali duplicati per lo stesso ticker | `ALERT_COOLDOWN_MS` troppo basso | Aumentare `ALERT_COOLDOWN_MS` nelle variabili ambiente |
