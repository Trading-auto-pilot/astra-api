---
title: DELETE /market-simulator/subscriptions
---

# DELETE /market-simulator/subscriptions

Area: `Sottoscrizioni`.

## Request

- Metodo: `DELETE`
- Path: `/market-simulator/subscriptions`
- Input noto: Nessuno; rimuove tutti i ticker dalla lista di sottoscrizione.

## Parametri / Body

Nessuno.

## Risposta attesa

`200 OK` (o equivalente applicativo).

```json
{
  "ok": true,
  "subscribed": []
}
```

## Errori comuni

| HTTP | Quando |
|---|---|
| `401`/`403` | Autenticazione/autorizzazione non valida. |
| `500` | Errore interno. |

## Esempio

```bash
curl -X DELETE "https://api.trading.expovin.it/market-simulator/subscriptions"
```
