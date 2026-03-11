---
title: POST /market-simulator/session
---

# POST /market-simulator/session

Area: `Sessione`.

## Request

- Metodo: `POST`
- Path: `/market-simulator/session`
- Input noto: Body `startDate`, `endDate`, `tf?`, `dataSource?`, `dataSourceConfig?`; configura o resetta la sessione di simulazione.

## Parametri / Body

```json
{
  "startDate": "2024-01-01T00:00:00Z",
  "endDate": "2024-03-31T00:00:00Z",
  "tf": "1Day",
  "dataSource": "cachemanager",
  "dataSourceConfig": {}
}
```

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `startDate` | ISO string | ✓ | Data inizio simulazione |
| `endDate` | ISO string | ✓ | Data fine simulazione |
| `tf` | string | — | Timeframe: `1min`, `5min`, `15min`, `30min`, `1Hour`, `4Hour`, `1Day`, `1Week`, `1Month` (default: `1Day`) |
| `dataSource` | string | — | `cachemanager` (default), `file`, `redis` |
| `dataSourceConfig` | object | — | `{ "path": "/data/sim" }` per `file` |

## Risposta attesa

`200 OK` (o equivalente applicativo).

```json
{
  "ok": true,
  "session": {
    "active": true,
    "startDate": "2024-01-01T00:00:00.000Z",
    "endDate": "2024-03-31T00:00:00.000Z",
    "currentDate": "2024-01-01T00:00:00.000Z",
    "tf": "1Day",
    "dataSource": "cachemanager",
    "tickers": [],
    "tickCount": 0,
    "hasMore": true
  }
}
```

## Errori comuni

| HTTP | Quando |
|---|---|
| `400` | `startDate` o `endDate` mancanti, formato non valido, o `startDate >= endDate`. |
| `401`/`403` | Autenticazione/autorizzazione non valida. |
| `500` | Errore interno. |

## Esempio

```bash
curl -X POST "https://api.trading.expovin.it/market-simulator/session" \
  -H "Content-Type: application/json" \
  -d '{"startDate":"2024-01-01","endDate":"2024-03-31","tf":"1Day"}'
```
