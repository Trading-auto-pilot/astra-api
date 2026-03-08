---
title: PUT /tickerscanner/settings
---

# PUT /tickerscanner/settings

Area: `Endpoint standard microservizio`.

## Request

- Metodo: `PUT`
- Path: `/tickerscanner/settings`
- Input noto: Body JSON; aggiorna settings.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Body JSON; aggiorna settings.

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
curl -X PUT "https://api.trading.expovin.it/tickerscanner/settings" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
