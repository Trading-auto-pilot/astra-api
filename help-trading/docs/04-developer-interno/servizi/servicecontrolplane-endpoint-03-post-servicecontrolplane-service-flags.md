---
title: POST /servicecontrolplane/service-flags
---

# POST /servicecontrolplane/service-flags

Area: `Generale`.

## Request

- Metodo: `POST`
- Path: `/servicecontrolplane/service-flags`
- Input noto: Body: `env`, `microservice`, `enabled`, `note`.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Body: `env`, `microservice`, `enabled`, `note`.

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
curl -X POST "https://api.trading.expovin.it/servicecontrolplane/service-flags" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
