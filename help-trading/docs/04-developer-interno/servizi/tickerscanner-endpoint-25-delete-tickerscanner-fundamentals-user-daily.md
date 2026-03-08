---
title: DELETE /tickerscanner/fundamentals/user-daily-scores/:jobId
---

# DELETE /tickerscanner/fundamentals/user-daily-scores/:jobId

Area: `Fundamentals e job tables`.

## Request

- Metodo: `DELETE`
- Path: `/tickerscanner/fundamentals/user-daily-scores/:jobId`
- Input noto: Path `jobId`; cancella job score utente.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Path `jobId`; cancella job score utente.

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
curl -X DELETE "https://api.trading.expovin.it/tickerscanner/fundamentals/user-daily-scores/:jobId"
```
