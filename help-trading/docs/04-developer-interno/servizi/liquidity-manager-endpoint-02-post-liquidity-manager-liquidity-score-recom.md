---
title: POST /liquidity-manager/liquidity-score/recompute
---

# POST /liquidity-manager/liquidity-score/recompute

Area: `Generale`.

## Request

- Metodo: `POST`
- Path: `/liquidity-manager/liquidity-score/recompute`
- Input noto: Body opzionale per forzare recompute e policy sorgenti.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Body opzionale per forzare recompute e policy sorgenti.

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
curl -X POST "https://api.trading.expovin.it/liquidity-manager/liquidity-score/recompute" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
