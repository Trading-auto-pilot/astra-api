---
sidebar_position: 2
---

# Endpoint dettagliati

## Endpoint spot-finder (pubblici via Traefik)

Prefisso esterno: `/decision-engine`.

### `GET /decision-engine/spot-finder`

Analisi singolo ticker (query `ticker` obbligatorio) con molte opzioni di tuning.

### `GET /decision-engine/spot-finder/:pipeId`

Esecuzione sincrona su una pipeline utente.

### `POST /decision-engine/spot-finder/:pipeId`

Avvio job asincrono su pipeline. Ritorna `type=async` e `jobId`.

### `GET /decision-engine/spot-finder/jobs/:jobId`

Stato job + subset risultati/errori (`limit` opzionale).

### `POST /decision-engine/spot-finder/jobs/:jobId/stop`

Cancella job in esecuzione e persiste snapshot.

### `GET /decision-engine/spot-finder/latest/:pipeId`

Recupera snapshot piu recente da Redis per pipe/user/date.

## Endpoint live

### `POST /decision-engine/spot-finder/live/:pipeId`

Toggle live mode (sottoscrive/annulla subscription ticker trend su `market-data-service`). Usato per abilitare il monitoraggio senza avviare il loop di segnalazione.

### `GET /decision-engine/spot-finder/live/:pipeId`

Avvio live asincrono con ritorno `jobId`. Carica lo snapshot Redis della Fase 5 per la pipe specificata, estrae i ticker con `actionable: true` e avvia il loop di monitoraggio real-time.

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

### `GET /decision-engine/spot-finder/live/:pipeId/status`

Stato live corrente. Restituisce il numero di ticker monitorati, segnali emessi e ultimo check del regime macro.

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

### `DELETE /decision-engine/spot-finder/live/:pipeId`

Stop live + unsubscribe ticker. Persiste snapshot e azzera il loop di monitoraggio.

---

## Logica di segnalazione live (Fase 6)

Per ogni tick ricevuto da `market-data-service`, il motore esegue i seguenti check **in sequenza**. Se uno fallisce, il tick è scartato senza proseguire:

### Check 1 — Pattern tecnico

Confronta il prezzo live con i livelli dello snapshot Fase 5. Il setup è valido se:

```
trendOk AND flagOk AND (breakoutOk OR pullbackOk)
```

- `trendOk` = EMA20 > EMA50 su 1h (pre-calcolato in Fase 5)
- `flagOk` = range ultime 20 candele orarie compresso
- `breakoutOk` = prezzo ha rotto resistenza con volume sufficiente
- `pullbackOk` = prezzo ritocca livello di breakout con volume decrescente

### Check 2 — Regime macro (riskOn)

Chiama `GET /liquidity-manager/liquidity-score` (con cache in-memory `RISK_ON_TTL_MS`, default 60s).

**Condizione:** `riskRegime === "RISK_ON"`.

Se `RISK_OFF` o `NEUTRAL`: segnale bloccato, log `[BLOCKED] riskOn check failed`.

### Check 3 — Range candela intraday (solo breakout)

Solo per livelli di tipo `breakout`. Chiama `GET /cachemanager/candles/latest?symbol=&tf=1min`.

```
candleRange = candle.high - candle.low
maxRange    = flagAtrK × atrLast
Condizione: candleRange ≤ maxRange
```

Se la candela è troppo ampia: segnale bloccato, log `[BLOCKED] candle range too wide`.

### Emissione ENTRY_SIGNAL

Se tutti i check superati, pubblica su canale Redis `{ENV}.hooks`:

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

Il segnale viene emesso **una sola volta** per combinazione `(ticker, entryMode, entryLimit)` entro la finestra `ALERT_COOLDOWN_MS` (default 5 minuti).

## Endpoint interni (scheduler/service-to-service)

Richiedono token interno (`x-internal-token`).

- `POST /internal/spot-finder/:pipeId`
- `POST /internal/spot-finder/live/:pipeId`
- `DELETE /internal/spot-finder/live/:pipeId`

## Endpoint operativi standard microservizio

- `GET /release`
- `GET /settings`
- `PUT /settings`
- `POST /settings/reload`
- `PUT /connect`
- `DELETE /connect`
- `GET /dbLogger`
- `PUT /dbLogger/:status`

## Endpoint status

Prefisso: `/status`.

- `GET /status/health`
- `GET /status/info`
- `GET /status/metrics`
- `GET /status/logLevel`
- `PUT /status/logLevel`
- `GET /status/communicationChannels`
- `PUT /status/communicationChannels`
