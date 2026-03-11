---
sidebar_position: 3
---

# File e ruoli

## Struttura directory

```
market-simulator/
├── server.js
├── modules/
│   └── main.js
├── lib/
│   ├── sessionState.js
│   ├── candleFetcher.js
│   └── snapshotPublisher.js
├── routes/
│   ├── session.js
│   ├── subscriptions.js
│   └── candle.js
├── Dockerfile
├── package.json
└── release.json
```

## Tabella file e ruoli

| File | Ruolo | Note implementative |
|---|---|---|
| `server.js` | Entry point REST | Usa `createMicroserviceServer` da `shared/serverFactory`; monta i tre router su `/session`, `/subscriptions`, `/candle` |
| `modules/main.js` | Classe `MarketSimulator` (estende `BaseService`) | Coordina sessione e tick; delega recupero candele a `candleFetcher` e pubblicazione a `snapshotPublisher`; espone metodi richiamati dalle routes via `getService()` |
| `lib/sessionState.js` | Singleton stato sessione | Gestisce `startDate`, `endDate`, `currentDate`, `tf`, `tickers`, `dataSource`, `dataSourceConfig`, `tickCount`; espone `configure()`, `advance()`, `stop()`, `addTickers()`, etc. |
| `lib/candleFetcher.js` | Astrazione sorgente dati | Factory `createCandleFetcher({ cachemanagerUrl })`; supporta tre sorgenti: cachemanager (HTTP), file (fs.readFileSync), redis (bus.get); normalizza i campi candela (`t, o, h, l, c, v`) |
| `lib/snapshotPublisher.js` | Publisher Redis | `publishSnapshot(bus, channel, ticker, candle)`: mappa `close` → field 31, calcola spread sintetico bid/ask (fields 84/86), pubblica messaggio `{ dataMode:"snapshot", ... }` |
| `routes/session.js` | Router `/session` | `POST /`, `GET /`, `DELETE /`, `POST /tick`; valida date e delega a `svc.configureSession()`, `svc.tick()`, etc. |
| `routes/subscriptions.js` | Router `/subscriptions` | Implementa stessa API di `market-data-service`: `POST /`, `GET /`, `DELETE /`, `DELETE /:symbol` |
| `routes/candle.js` | Router `/candle` | `GET /` (singola), `GET /range` (range), `POST /push` (candela custom → snapshot) |

## Dipendenze condivise

Le librerie `shared/` forniscono:

- `BaseService` — Redis bus, logger, settings, URL servizi dipendenti (`this.cachemanagerUrl`, etc.)
- `serverFactory` — Bootstrap Express, middleware auth, routes standard
- `RedisBus` — `bus.publish()`, `bus.get()`, `bus.set()`
