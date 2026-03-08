---
title: PUT /market-data-service/snapshot/interval
---

# PUT /market-data-service/snapshot/interval

Area: `Generale`.

## Request

- Metodo: `PUT`
- Path: `/market-data-service/snapshot/interval`
- Input noto: Body `intervalMs` (>=60000); persiste nuovo intervallo.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Body `intervalMs` (>=60000); persiste nuovo intervallo.

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
curl -X PUT "https://api.trading.expovin.it/market-data-service/snapshot/interval" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
