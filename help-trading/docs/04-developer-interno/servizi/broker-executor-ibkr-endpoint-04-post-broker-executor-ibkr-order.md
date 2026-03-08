---
title: POST /broker-executor-ibkr/order
---

# POST /broker-executor-ibkr/order

Area: `Generale`.

## Request

- Metodo: `POST`
- Path: `/broker-executor-ibkr/order`
- Input noto: Body bracket order: `symbol`, `quantity`, `limitPrice`, `stopLossPrice`, `takeProfitPrice`, metadati.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Body bracket order: `symbol`, `quantity`, `limitPrice`, `stopLossPrice`, `takeProfitPrice`, metadati.

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
curl -X POST "https://api.trading.expovin.it/broker-executor-ibkr/order" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
