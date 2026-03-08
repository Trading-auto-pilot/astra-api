---
title: GET /tickerscanner/fundamentals/update-market-daily
---

# GET /tickerscanner/fundamentals/update-market-daily

Area: `Fundamentals e job tables`.

## Request

- Metodo: `GET`
- Path: `/tickerscanner/fundamentals/update-market-daily`
- Input noto: Nessuno; lista job market daily attivi.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Nessuno; lista job market daily attivi.

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
curl -X GET "https://api.trading.expovin.it/tickerscanner/fundamentals/update-market-daily"
```
