---
title: POST /ibkr-keepalive/settings/reload
---

# POST /ibkr-keepalive/settings/reload

Area: `Generale`.

## Request

- Metodo: `POST`
- Path: `/ibkr-keepalive/settings/reload`
- Input noto: Nessuno; reload settings da datahub.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Nessuno; reload settings da datahub.

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
curl -X POST "https://api.trading.expovin.it/ibkr-keepalive/settings/reload" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
