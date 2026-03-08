---
title: POST /tickerscanner/settings/reload
---

# POST /tickerscanner/settings/reload

Area: `Endpoint standard microservizio`.

## Request

- Metodo: `POST`
- Path: `/tickerscanner/settings/reload`
- Input noto: Ricarica settings da Redis.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Ricarica settings da Redis.

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
curl -X POST "https://api.trading.expovin.it/tickerscanner/settings/reload" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
