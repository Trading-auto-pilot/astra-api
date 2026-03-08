---
title: PUT /ibkr-keepalive/connect
---

# PUT /ibkr-keepalive/connect

Area: `Generale`.

## Request

- Metodo: `PUT`
- Path: `/ibkr-keepalive/connect`
- Input noto: Nessuno; avvia connessione keepalive.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Nessuno; avvia connessione keepalive.

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
curl -X PUT "https://api.trading.expovin.it/ibkr-keepalive/connect" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
