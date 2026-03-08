---
title: DELETE /decision-engine/internal/spot-finder/live/:pipeId
---

# DELETE /decision-engine/internal/spot-finder/live/:pipeId

Area: `Generale`.

## Request

- Metodo: `DELETE`
- Path: `/decision-engine/internal/spot-finder/live/:pipeId`
- Input noto: Header `x-internal-token`; stop live interno.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Header `x-internal-token`; stop live interno.

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
curl -X DELETE "https://api.trading.expovin.it/decision-engine/internal/spot-finder/live/:pipeId"
```
