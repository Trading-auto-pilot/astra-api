---
title: PUT /ibkr-keepalive/settings
---

# PUT /ibkr-keepalive/settings

Area: `Generale`.

## Request

- Metodo: `PUT`
- Path: `/ibkr-keepalive/settings`
- Input noto: Body `{ setting, value }` oppure `{ KEY: value }`.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Body `{ setting, value }` oppure `{ KEY: value }`.

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
curl -X PUT "https://api.trading.expovin.it/ibkr-keepalive/settings" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
