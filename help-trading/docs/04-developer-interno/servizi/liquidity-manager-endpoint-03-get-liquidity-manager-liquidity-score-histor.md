---
title: GET /liquidity-manager/liquidity-score/history
---

# GET /liquidity-manager/liquidity-score/history

Area: `Generale`.

## Request

- Metodo: `GET`
- Path: `/liquidity-manager/liquidity-score/history`
- Input noto: Query `days` (es. 30); storico score.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Query `days` (es. 30); storico score.

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
curl -X GET "https://api.trading.expovin.it/liquidity-manager/liquidity-score/history"
```
