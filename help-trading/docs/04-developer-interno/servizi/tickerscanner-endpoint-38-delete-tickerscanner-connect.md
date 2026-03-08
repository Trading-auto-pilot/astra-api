---
title: DELETE /tickerscanner/connect
---

# DELETE /tickerscanner/connect

Area: `Endpoint standard microservizio`.

## Request

- Metodo: `DELETE`
- Path: `/tickerscanner/connect`
- Input noto: Disconnette dal DB.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Disconnette dal DB.

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
curl -X DELETE "https://api.trading.expovin.it/tickerscanner/connect"
```
