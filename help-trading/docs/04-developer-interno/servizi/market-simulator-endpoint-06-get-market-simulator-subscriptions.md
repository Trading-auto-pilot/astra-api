---
title: GET /market-simulator/subscriptions
---

# GET /market-simulator/subscriptions

Area: `Sottoscrizioni`.

## Request

- Metodo: `GET`
- Path: `/market-simulator/subscriptions`
- Input noto: Nessuno; restituisce la lista dei ticker attualmente sottoscritti.

## Parametri / Body

Nessuno.

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
| `subscribed` | `string[]` | Lista dei ticker attualmente sottoscritti. |

## Errori comuni

| HTTP | Quando |
|---|---|
| `401`/`403` | Autenticazione/autorizzazione non valida. |
| `500` | Errore interno. |

## Esempio

```bash
curl -X GET "https://api.trading.expovin.it/market-simulator/subscriptions"
```
