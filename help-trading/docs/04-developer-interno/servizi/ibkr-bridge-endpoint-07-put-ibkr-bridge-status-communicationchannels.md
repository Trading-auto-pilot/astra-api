---
title: PUT /ibkr-bridge/status/communicationChannels
---

# PUT /ibkr-bridge/status/communicationChannels

Area: `Generale`.

## Request

- Metodo: `PUT`
- Path: `/ibkr-bridge/status/communicationChannels`
- Input noto: Body configurazione canali e intervalli.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Body configurazione canali e intervalli.

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
curl -X PUT "https://api.trading.expovin.it/ibkr-bridge/status/communicationChannels" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
