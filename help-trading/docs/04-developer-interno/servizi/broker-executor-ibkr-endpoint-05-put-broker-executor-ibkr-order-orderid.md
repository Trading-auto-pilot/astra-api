---
title: PUT /broker-executor-ibkr/order/:orderId
---

# PUT /broker-executor-ibkr/order/:orderId

Area: `Generale`.

## Request

- Metodo: `PUT`
- Path: `/broker-executor-ibkr/order/:orderId`
- Input noto: Path `orderId`; body campi modificabili ordine.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Path `orderId`; body campi modificabili ordine.

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
curl -X PUT "https://api.trading.expovin.it/broker-executor-ibkr/order/:orderId" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
