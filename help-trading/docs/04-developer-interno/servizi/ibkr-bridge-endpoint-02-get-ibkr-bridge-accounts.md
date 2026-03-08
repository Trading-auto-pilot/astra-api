---
title: GET /ibkr-bridge/accounts
---

# GET /ibkr-bridge/accounts

Area: `Generale`.

## Request

- Metodo: `GET`
- Path: `/ibkr-bridge/accounts`
- Input noto: Nessuno; lista account disponibili.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Nessuno; lista account disponibili.

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
curl -X GET "https://api.trading.expovin.it/ibkr-bridge/accounts"
```
