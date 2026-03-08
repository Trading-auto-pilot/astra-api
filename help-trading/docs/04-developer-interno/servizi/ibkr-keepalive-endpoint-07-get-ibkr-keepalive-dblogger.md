---
title: GET /ibkr-keepalive/dbLogger
---

# GET /ibkr-keepalive/dbLogger

Area: `Generale`.

## Request

- Metodo: `GET`
- Path: `/ibkr-keepalive/dbLogger`
- Input noto: Nessuno; stato logging su DB.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Nessuno; stato logging su DB.

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
curl -X GET "https://api.trading.expovin.it/ibkr-keepalive/dbLogger"
```
