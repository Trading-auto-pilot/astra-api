---
title: GET /market-simulator/session
---

# GET /market-simulator/session

Area: `Sessione`.

## Request

- Metodo: `GET`
- Path: `/market-simulator/session`
- Input noto: Nessuno; restituisce lo stato corrente della sessione di simulazione.

## Parametri / Body

Nessuno.

## Risposta attesa

`200 OK` (o equivalente applicativo).

```json
{
  "ok": true,
  "session": {
    "active": true,
    "startDate": "2024-01-01T00:00:00.000Z",
    "endDate": "2024-03-31T00:00:00.000Z",
    "currentDate": "2024-01-16T00:00:00.000Z",
    "tf": "1Day",
    "dataSource": "cachemanager",
    "dataSourceConfig": {},
    "tickers": ["AAPL", "MRNA"],
    "tickCount": 11,
    "lastTickAt": "2026-03-10T14:30:00.000Z",
    "hasMore": true
  }
}
```

## Errori comuni

| HTTP | Quando |
|---|---|
| `401`/`403` | Autenticazione/autorizzazione non valida. |
| `500` | Errore interno. |

## Esempio

```bash
curl -X GET "https://api.trading.expovin.it/market-simulator/session"
```
