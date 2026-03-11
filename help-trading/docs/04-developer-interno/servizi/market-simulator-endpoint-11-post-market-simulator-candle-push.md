---
title: POST /market-simulator/candle/push
---

# POST /market-simulator/candle/push

Area: `Candele`.

## Request

- Metodo: `POST`
- Path: `/market-simulator/candle/push`
- Input noto: Inietta una candela personalizzata come snapshot diretto su Redis, bypassando la sorgente dati configurata. Utile per simulare scenari specifici o testare reazioni del decision-engine a prezzi particolari.

## Parametri / Body

```json
{
  "symbol": "AAPL",
  "candle": {
    "t": "2024-01-15T00:00:00.000Z",
    "o": 185.00,
    "h": 190.00,
    "l": 183.00,
    "c": 189.50,
    "v": 60000000
  }
}
```

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `symbol` | `string` | Sì | Simbolo del ticker. |
| `candle` | `object` | Sì | Dati OHLCV della candela. |
| `candle.c` o `candle.close` | `number` | Sì | Prezzo di chiusura (almeno uno dei due). |
| `candle.t` | `string` | No | Timestamp ISO 8601. |
| `candle.o` / `candle.open` | `number` | No | Apertura. |
| `candle.h` / `candle.high` | `number` | No | Massimo. |
| `candle.l` / `candle.low` | `number` | No | Minimo. |
| `candle.v` / `candle.volume` | `number` | No | Volume. |

## Risposta attesa

`200 OK` (o equivalente applicativo).

```json
{
  "ok": true,
  "symbol": "AAPL",
  "candle": {
    "t": "2024-01-15T00:00:00.000Z",
    "o": 185.00,
    "h": 190.00,
    "l": 183.00,
    "c": 189.50,
    "v": 60000000
  }
}
```

## Errori comuni

| HTTP | Quando |
|---|---|
| `400` | `symbol` o `candle` mancanti, oppure `candle` privo di `c`/`close`. |
| `401`/`403` | Autenticazione/autorizzazione non valida. |
| `500` | Errore interno o Redis non raggiungibile. |

## Esempio

```bash
curl -X POST "https://api.trading.expovin.it/market-simulator/candle/push" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AAPL",
    "candle": { "t": "2024-01-15T00:00:00.000Z", "o": 185.00, "h": 190.00, "l": 183.00, "c": 189.50, "v": 60000000 }
  }'
```
