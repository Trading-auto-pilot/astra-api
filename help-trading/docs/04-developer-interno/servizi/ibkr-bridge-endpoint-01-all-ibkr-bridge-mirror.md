---
title: ALL /ibkr-bridge/mirror/*
---

# ALL /ibkr-bridge/mirror/*

Area: `Generale`.

## Request

- Metodo: `ALL`
- Path: `/ibkr-bridge/mirror/*`
- Input noto: Proxy verso IBKR Gateway; path e query pass-through.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Proxy verso IBKR Gateway; path e query pass-through.

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
curl "https://api.trading.expovin.it/ibkr-bridge/mirror/*"
```
