---
title: PUT /cachemanager/provider/:provider
---

# PUT /cachemanager/provider/:provider

Area: `Generale`.

## Request

- Metodo: `PUT`
- Path: `/cachemanager/provider/:provider`
- Input noto: Path `provider` (`FMP`,`ALPACA`,`IBKR`); switch provider runtime.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Path `provider` (`FMP`,`ALPACA`,`IBKR`); switch provider runtime.

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
curl -X PUT "https://api.trading.expovin.it/cachemanager/provider/:provider" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
