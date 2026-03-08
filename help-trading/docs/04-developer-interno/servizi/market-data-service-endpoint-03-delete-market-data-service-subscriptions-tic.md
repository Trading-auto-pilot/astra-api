---
title: DELETE /market-data-service/subscriptions/:ticker
---

# DELETE /market-data-service/subscriptions/:ticker

Area: `Generale`.

## Request

- Metodo: `DELETE`
- Path: `/market-data-service/subscriptions/:ticker`
- Input noto: Path `ticker` o body `tickers[]`; rimozione sottoscrizioni.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Path `ticker` o body `tickers[]`; rimozione sottoscrizioni.

## Risposta attesa

`200 OK` (o equivalente applicativo).

```json
{
  "ok": true
}
```

## Errori comuni

| HTTP | Quando |
|---|---|
| `400` | Parametri/body non validi o incompleti. |
| `401`/`403` | Autenticazione/autorizzazione non valida, se richiesta dalla route. |
| `404` | Risorsa non trovata (`id`, `jobId`, `symbol`, ecc.). |
| `500` | Errore interno o errore propagato da servizio dipendente. |

## Esempio

```bash
curl -X DELETE "https://api.trading.expovin.it/market-data-service/subscriptions/:ticker"
```
