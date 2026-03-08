---
title: GET /broker-executor-ibkr/orders
---

# GET /broker-executor-ibkr/orders

Area: `Generale`.

## Request

- Metodo: `GET`
- Path: `/broker-executor-ibkr/orders`
- Input noto: Query opzionali stato/periodo/idempotency key.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Query opzionali stato/periodo/idempotency key.

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
curl -X GET "https://api.trading.expovin.it/broker-executor-ibkr/orders"
```
