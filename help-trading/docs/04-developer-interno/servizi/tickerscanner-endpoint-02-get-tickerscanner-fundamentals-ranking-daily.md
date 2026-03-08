---
title: GET /tickerscanner/fundamentals/ranking/daily
---

# GET /tickerscanner/fundamentals/ranking/daily

Area: `Ranking Daily (Fase 4)`.

## Request

- Metodo: `GET`
- Path: `/tickerscanner/fundamentals/ranking/daily`
- Input noto: Query `score_date` (YYYY-MM-DD); legge snapshot per data.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Query `score_date` (YYYY-MM-DD); legge snapshot per data.

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
curl -X GET "https://api.trading.expovin.it/tickerscanner/fundamentals/ranking/daily"
```
