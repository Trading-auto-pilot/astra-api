---
title: POST /tickerscanner/internal/fundamentals/user-daily-scores
---

# POST /tickerscanner/internal/fundamentals/user-daily-scores

Area: `Endpoint interni`.

## Request

- Metodo: `POST`
- Path: `/tickerscanner/internal/fundamentals/user-daily-scores`
- Input noto: Header `x-internal-token`; trigger interno scheduler.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Header `x-internal-token`; trigger interno scheduler.

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
curl -X POST "https://api.trading.expovin.it/tickerscanner/internal/fundamentals/user-daily-scores" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
