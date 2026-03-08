---
title: GET /decision-engine/spot-finder/live/:pipeId
---

# GET /decision-engine/spot-finder/live/:pipeId

Area: `Generale`.

## Request

- Metodo: `GET`
- Path: `/decision-engine/spot-finder/live/:pipeId`
- Input noto: Path `pipeId`; avvio live asincrono.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Path `pipeId`; avvio live asincrono.

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
curl -X GET "https://api.trading.expovin.it/decision-engine/spot-finder/live/:pipeId"
```
