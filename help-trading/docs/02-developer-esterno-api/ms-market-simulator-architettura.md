---
sidebar_position: 1
---

# Architettura e flussi

## Componenti principali

| File | Ruolo |
|---|---|
| `server.js` | Bootstrap Express: monta i router `/session`, `/subscriptions`, `/candle` tramite `serverFactory` |
| `modules/main.js` | Classe `MarketSimulator` (estende `BaseService`): coordina sessione, sottoscrizioni, tick e canale Redis |
| `lib/sessionState.js` | Singleton stato sessione: `startDate`, `endDate`, `currentDate`, `tickers`, `tf`, `dataSource` |
| `lib/candleFetcher.js` | Factory di recupero candele: astrae le tre sorgenti dati (cachemanager, file, Redis) |
| `lib/snapshotPublisher.js` | Formatta la candela nel payload IBKR e pubblica su Redis |
| `routes/session.js` | Endpoints `/session` (CRUD sessione + tick) |
| `routes/subscriptions.js` | Endpoints `/subscriptions` (stessa API di market-data-service) |
| `routes/candle.js` | Endpoints `/candle` (fetch singola, range, push custom) |

## Flusso principale — simulazione step-by-step

```
1. Frontend/orchestratore → POST /session        { startDate, endDate, tf }
2. Decision-engine        → POST /subscriptions   { tickers: ["AAPL", "MRNA"] }
3. Orchestratore          → POST /session/tick
       │
       ├─ per ogni ticker iscritto:
       │    ├─ candleFetcher.getCandle(ticker, currentDate, tf, dataSource)
       │    │    ├─ [cachemanager] GET /cachemanager/candles?symbol=X&startDate=Y&endDate=Y&tf=Z
       │    │    ├─ [file]         legge {path}/{SYMBOL}/{tf}.json
       │    │    └─ [redis]        bus.get("sim:candles:{SYMBOL}:{tf}")
       │    └─ snapshotPublisher.publishSnapshot(bus, channel, ticker, candle)
       │         → pubblica su Redis: { dataMode:"snapshot", ticker, payload:{31:close,...} }
       │
       └─ advance() → currentDate += tfMs
4. Decision-engine riceve snapshot su Redis e valuta segnali (identico a modalità live IBKR)
```

## Canale Redis

Il simulatore pubblica sullo stesso canale che il decision-engine usa in modalità live:

```
${ENV}.market-data-service.data
```

Il decision-engine non sa se i dati arrivano da IBKR o dal simulatore.

## Formato snapshot pubblicato

```json
{
  "dataMode": "snapshot",
  "ticker": "MRNA",
  "payload": {
    "31": 54.66,
    "84": 54.63,
    "86": 54.69,
    "7762": 1234567,
    "87": 1234567
  },
  "ts": 1710000000000,
  "_sim": { "t": "2024-01-15", "o": 54.10, "h": 55.20, "l": 53.90, "c": 54.66, "v": 1234567 }
}
```

I campi `31` (last), `84` (bid), `86` (ask) sono derivati dal `close` della candela storica con uno spread sintetico dello 0.05%.

## Sorgenti dati

| Sorgente | Configurazione | Note |
|---|---|---|
| `cachemanager` | default | Chiama `GET /cachemanager/candles` con range ±1 tf attorno alla data corrente |
| `file` | `dataSourceConfig.path` | Legge `{path}/{SYMBOL}/{tf}.json` — array candele normalizzato |
| `redis` | — | Chiama `bus.get("sim:candles:{SYMBOL}:{tf}")` — array candele |

## Integrazione con decision-engine (modalità simulata)

Per attivare la simulazione puntare la variabile `MARKETDATASERVICE_URL` del decision-engine all'indirizzo del market-simulator:

```bash
MARKETDATASERVICE_URL=http://market-simulator:3010
```

Il decision-engine invierà `POST /subscriptions` al simulatore invece che a `market-data-service`. I dati di mercato arriveranno poi via Redis esattamente come in modalità live.
