---
sidebar_position: 2
---

# Endpoint

Tutti gli endpoint usano il prefisso `/market-simulator` via Traefik.

## Sessione

| Metodo | Path | Auth | Parametri | Risposta | Note |
|---|---|---|---|---|---|
| `POST` | `/session` | JWT | Body: `startDate`, `endDate`, `tf?`, `dataSource?`, `dataSourceConfig?` | `{ ok, session }` | Configura o resetta la sessione |
| `GET` | `/session` | JWT | — | `{ ok, session }` | Stato corrente (date, tf, tickers, tickCount…) |
| `DELETE` | `/session` | JWT | — | `{ ok }` | Ferma la sessione e svuota tickers |
| `POST` | `/session/tick` | JWT | — | `{ ok, publishedDate, nextDate, hasMore, results[] }` | Avanza di un passo e pubblica snapshot su Redis |

### Body POST /session

```json
{
  "startDate": "2024-01-01T00:00:00Z",
  "endDate": "2024-03-31T00:00:00Z",
  "tf": "1Day",
  "dataSource": "cachemanager",
  "dataSourceConfig": {}
}
```

| Campo | Tipo | Obbligatorio | Valori |
|---|---|---|---|
| `startDate` | ISO string | ✓ | Data inizio simulazione |
| `endDate` | ISO string | ✓ | Data fine simulazione (esclusa) |
| `tf` | string | — | `1min`, `5min`, `15min`, `30min`, `1Hour`, `4Hour`, `1Day`, `1Week`, `1Month` (default: `1Day`) |
| `dataSource` | string | — | `cachemanager` (default), `file`, `redis` |
| `dataSourceConfig` | object | — | `{ "path": "/data/sim" }` per `file`; vuoto per gli altri |

### Risposta POST /session/tick

```json
{
  "ok": true,
  "publishedDate": "2024-01-15T00:00:00.000Z",
  "nextDate": "2024-01-16T00:00:00.000Z",
  "hasMore": true,
  "tickCount": 11,
  "channel": "DEV.market-data-service.data",
  "results": [
    { "ticker": "AAPL", "ok": true, "close": 185.92, "date": "2024-01-15" },
    { "ticker": "MRNA", "ok": false, "error": "candle not found" }
  ]
}
```

## Sottoscrizioni

Stessa API di `market-data-service` — il decision-engine non richiede modifiche.

| Metodo | Path | Auth | Parametri | Risposta |
|---|---|---|---|---|
| `POST` | `/subscriptions` | JWT | Body: `{ "tickers": ["AAPL", "MRNA"] }` | `{ ok, subscribed[] }` |
| `GET` | `/subscriptions` | JWT | — | `{ ok, subscribed[] }` |
| `DELETE` | `/subscriptions` | JWT | — | `{ ok, subscribed: [] }` — svuota tutto |
| `DELETE` | `/subscriptions/:symbol` | JWT | Path `symbol` | `{ ok, subscribed[] }` |

## Candele

| Metodo | Path | Auth | Parametri | Risposta |
|---|---|---|---|---|
| `GET` | `/candle` | JWT | Query: `symbol`, `date`, `tf?`, `source?` | `{ ok, candle }` |
| `GET` | `/candle/range` | JWT | Query: `symbol`, `startDate`, `endDate`, `tf?` | `{ ok, count, candles[] }` |
| `POST` | `/candle/push` | JWT | Body: `{ symbol, candle: { t, o, h, l, c, v } }` | `{ ok, symbol, candle }` |

### GET /candle — parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `symbol` | string | ✓ | Ticker (es. `AAPL`) |
| `date` | ISO string | ✓ | Data della candela da recuperare |
| `tf` | string | — | Timeframe (default: `1Day`) |
| `source` | string | — | Override sorgente: `cachemanager`, `file`, `redis` |

### POST /candle/push — inietta candela custom

Permette di modificare una candela dal frontend e inviarla come snapshot al decision-engine.

```json
{
  "symbol": "MRNA",
  "candle": {
    "t": "2024-01-15T14:30:00Z",
    "o": 53.50,
    "h": 55.10,
    "l": 53.20,
    "c": 54.00,
    "v": 980000
  }
}
```

## Endpoint standard (ereditati da BaseService)

| Metodo | Path | Descrizione |
|---|---|---|
| `GET` | `/release` | Versione e release notes |
| `GET` | `/settings` | Configurazione corrente |
| `PUT` | `/settings` | Aggiorna settings |
| `POST` | `/settings/reload` | Ricarica settings da datahub |
| `GET` | `/status/health` | Health check |
| `GET` | `/status/info` | Info servizio |
| `GET` | `/status/metrics` | Metriche operative |
