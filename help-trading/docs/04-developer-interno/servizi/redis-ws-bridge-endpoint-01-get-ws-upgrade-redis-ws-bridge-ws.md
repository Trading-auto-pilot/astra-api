---
title: GET (WS upgrade) /redis-ws-bridge/ws
---

# GET (WS upgrade) /redis-ws-bridge/ws

Area: `Generale`.

## Request

- Metodo: `GET (WS upgrade)`
- Path: `/redis-ws-bridge/ws`
- Input noto: Query: `topics`, `symbols`, `types`, `aggregate`, `rateMs`; apre canale WS filtrato.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Query: `topics`, `symbols`, `types`, `aggregate`, `rateMs`; apre canale WS filtrato.

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
curl "https://api.trading.expovin.it/redis-ws-bridge/ws"
```
