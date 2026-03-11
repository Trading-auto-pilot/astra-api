---
title: GET /market-simulator/candle
---

# GET /market-simulator/candle

Area: `Candele`.

## Request

- Metodo: `GET`
- Path: `/market-simulator/candle`
- Input noto: Recupera una singola candela dalla sorgente dati configurata.

## Parametri / Body

| Parametro | In | Tipo | Obbligatorio | Default | Descrizione |
|---|---|---|---|---|---|
| `symbol` | query | `string` | Sì | — | Simbolo del ticker (es. `AAPL`). |
| `date` | query | `string` | Sì | — | Data ISO 8601 (es. `2024-01-15T00:00:00.000Z`). |
| `tf` | query | `string` | No | `1Day` | Timeframe (es. `1Day`, `1Hour`). |
| `source` | query | `string` | No | `cachemanager` | Sorgente dati: `cachemanager`, `file`, `redis`. |

## Risposta attesa

`200 OK` (o equivalente applicativo).

```json
{
  "ok": true,
  "candle": {
    "t": "2024-01-15T00:00:00.000Z",
    "o": 185.20,
    "h": 187.50,
    "l": 184.30,
    "c": 186.40,
    "v": 52341200
  }
}
```

| Campo | Tipo | Descrizione |
|---|---|---|
| `candle.t` | `string` | Timestamp della candela (ISO 8601). |
| `candle.o` | `number` | Prezzo di apertura. |
| `candle.h` | `number` | Prezzo massimo. |
| `candle.l` | `number` | Prezzo minimo. |
| `candle.c` | `number` | Prezzo di chiusura. |
| `candle.v` | `number` | Volume. |

## Errori comuni

| HTTP | Quando |
|---|---|
| `400` | `symbol` o `date` mancanti. |
| `404` | Nessuna candela trovata per il simbolo/data specificati. |
| `401`/`403` | Autenticazione/autorizzazione non valida. |
| `500` | Errore interno o sorgente dati non raggiungibile. |

## Esempio

```bash
curl -X GET "https://api.trading.expovin.it/market-simulator/candle?symbol=AAPL&date=2024-01-15T00:00:00.000Z&tf=1Day"
```
