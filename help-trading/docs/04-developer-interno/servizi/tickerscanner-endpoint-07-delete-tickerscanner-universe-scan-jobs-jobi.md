---
title: DELETE /tickerscanner/universe/scan/jobs/:jobId
---

# DELETE /tickerscanner/universe/scan/jobs/:jobId

Area: `Universe (Fase 1)`.

## Request

- Metodo: `DELETE`
- Path: `/tickerscanner/universe/scan/jobs/:jobId`
- Input noto: Path `jobId`; cancella job universe in corso.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Path `jobId`; cancella job universe in corso.

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
curl -X DELETE "https://api.trading.expovin.it/tickerscanner/universe/scan/jobs/:jobId"
```
