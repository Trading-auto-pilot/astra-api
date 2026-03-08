---
title: POST /market-data-service/snapshot/loop
---

# POST /market-data-service/snapshot/loop

Area: `Generale`.

## Request

- Metodo: `POST`
- Path: `/market-data-service/snapshot/loop`
- Input noto: Body `intervalMs` (>=10000); avvia loop snapshot.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Body `intervalMs` (>=10000); avvia loop snapshot.

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
curl -X POST "https://api.trading.expovin.it/market-data-service/snapshot/loop" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
