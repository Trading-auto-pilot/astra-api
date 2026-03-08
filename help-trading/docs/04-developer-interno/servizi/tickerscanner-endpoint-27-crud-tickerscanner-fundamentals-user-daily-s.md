---
title: CRUD /tickerscanner/fundamentals/user-daily-score-jobs
---

# CRUD /tickerscanner/fundamentals/user-daily-score-jobs

Area: `Fundamentals e job tables`.

## Request

- Metodo: `CRUD`
- Path: `/tickerscanner/fundamentals/user-daily-score-jobs`
- Input noto: Path `:id` su GET/PUT/DELETE; body definizione job.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Path `:id` su GET/PUT/DELETE; body definizione job.

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
curl "https://api.trading.expovin.it/tickerscanner/fundamentals/user-daily-score-jobs"
```
