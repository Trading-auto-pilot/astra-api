---
title: PUT /redis-ws-bridge/status/communicationChannels
---

# PUT /redis-ws-bridge/status/communicationChannels

Area: `Generale`.

## Request

- Metodo: `PUT`
- Path: `/redis-ws-bridge/status/communicationChannels`
- Input noto: Body config canali (`on`, `params.intervalsMs`).

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Body config canali (`on`, `params.intervalsMs`).

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
curl -X PUT "https://api.trading.expovin.it/redis-ws-bridge/status/communicationChannels" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
