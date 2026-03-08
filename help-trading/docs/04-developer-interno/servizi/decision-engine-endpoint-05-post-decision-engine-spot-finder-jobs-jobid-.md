---
title: POST /decision-engine/spot-finder/jobs/:jobId/stop
---

# POST /decision-engine/spot-finder/jobs/:jobId/stop

Area: `Generale`.

## Request

- Metodo: `POST`
- Path: `/decision-engine/spot-finder/jobs/:jobId/stop`
- Input noto: Path `jobId`; stop job in esecuzione.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Path `jobId`; stop job in esecuzione.

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
curl -X POST "https://api.trading.expovin.it/decision-engine/spot-finder/jobs/:jobId/stop" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
