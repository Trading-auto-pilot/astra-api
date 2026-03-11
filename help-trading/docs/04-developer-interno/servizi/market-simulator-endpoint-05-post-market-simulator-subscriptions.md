---
title: POST /market-simulator/subscriptions
---

# POST /market-simulator/subscriptions

Area: `Sottoscrizioni`.

## Request

- Metodo: `POST`
- Path: `/market-simulator/subscriptions`
- Input noto: Array di ticker da aggiungere alla lista di sottoscrizione della sessione corrente.

## Parametri / Body

```json
{
  "tickers": ["AAPL", "MRNA"]
}
```

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `tickers` | `string[]` | Sì | Lista di simboli da sottoscrivere. |

## Risposta attesa

`200 OK` (o equivalente applicativo).

```json
{
  "ok": true,
  "subscribed": ["AAPL", "MRNA"]
}
```

| Campo | Tipo | Descrizione |
|---|---|---|
| `subscribed` | `string[]` | Lista completa dei ticker attualmente sottoscritti. |

## Errori comuni

| HTTP | Quando |
|---|---|
| `400` | `tickers` mancante o non è un array non vuoto. |
| `401`/`403` | Autenticazione/autorizzazione non valida. |
| `500` | Errore interno. |

## Esempio

```bash
curl -X POST "https://api.trading.expovin.it/market-simulator/subscriptions" \
  -H "Content-Type: application/json" \
  -d '{"tickers": ["AAPL", "MRNA"]}'
```
