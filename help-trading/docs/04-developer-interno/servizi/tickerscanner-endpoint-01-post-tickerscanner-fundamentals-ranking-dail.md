---
title: POST /tickerscanner/fundamentals/ranking/daily
---

# POST /tickerscanner/fundamentals/ranking/daily

Area: `Ranking Daily (Fase 4)`.

## Request

- Metodo: `POST`
- Path: `/tickerscanner/fundamentals/ranking/daily`
- Input noto: Body `{ score_date, mode?, limits?, filters? }`; genera snapshot ranking. Sincrono.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Body `{ score_date, mode?, limits?, filters? }`; genera snapshot ranking. Sincrono.

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
curl -X POST "https://api.trading.expovin.it/tickerscanner/fundamentals/ranking/daily" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
