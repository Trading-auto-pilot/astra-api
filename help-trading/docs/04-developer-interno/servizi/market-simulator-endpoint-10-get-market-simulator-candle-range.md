---
title: GET /market-simulator/candle/range
---

# GET /market-simulator/candle/range

Area: `Candele`.

## Request

- Metodo: `GET`
- Path: `/market-simulator/candle/range`
- Input noto: Recupera un intervallo di candele per un ticker (utile per preview da frontend).

## Parametri / Body

| Parametro | In | Tipo | Obbligatorio | Default | Descrizione |
|---|---|---|---|---|---|
| `symbol` | query | `string` | Sì | — | Simbolo del ticker (es. `AAPL`). |
| `startDate` | query | `string` | Sì | — | Data di inizio ISO 8601. |
| `endDate` | query | `string` | Sì | — | Data di fine ISO 8601. |
| `tf` | query | `string` | No | `1Day` | Timeframe (es. `1Day`, `1Hour`). |

## Risposta attesa

`200 OK` (o equivalente applicativo).

```json
{
  "ok": true,
  "count": 3,
  "candles": [
    { "t": "2024-01-15T00:00:00.000Z", "o": 185.20, "h": 187.50, "l": 184.30, "c": 186.40, "v": 52341200 },
    { "t": "2024-01-16T00:00:00.000Z", "o": 186.50, "h": 188.00, "l": 185.00, "c": 187.20, "v": 48720000 },
    { "t": "2024-01-17T00:00:00.000Z", "o": 187.30, "h": 189.10, "l": 186.80, "c": 188.60, "v": 55100000 }
  ]
}
```

| Campo | Tipo | Descrizione |
|---|---|---|
| `count` | `number` | Numero di candele restituite. |
| `candles` | `object[]` | Array di candele OHLCV ordinate per data. |

## Errori comuni

| HTTP | Quando |
|---|---|
| `400` | `symbol`, `startDate` o `endDate` mancanti. |
| `401`/`403` | Autenticazione/autorizzazione non valida. |
| `500` | Errore interno o sorgente dati non raggiungibile. |

## Esempio

```bash
curl -X GET "https://api.trading.expovin.it/market-simulator/candle/range?symbol=AAPL&startDate=2024-01-15T00:00:00.000Z&endDate=2024-01-17T00:00:00.000Z&tf=1Day"
```
