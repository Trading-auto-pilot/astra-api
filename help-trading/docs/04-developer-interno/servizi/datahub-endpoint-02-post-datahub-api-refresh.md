---
title: POST /datahub/api/refresh
---

# POST /datahub/api/refresh

Area: `Generale`.

## Request

- Metodo: `POST`
- Path: `/datahub/api/refresh`
- Input noto: Nessuno; ricarica schema e rigenera endpoint dinamici.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Nessuno; ricarica schema e rigenera endpoint dinamici.

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
curl -X POST "https://api.trading.expovin.it/datahub/api/refresh" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
