---
title: PUT /tickerscanner/dbLogger/:status
---

# PUT /tickerscanner/dbLogger/:status

Area: `Endpoint standard microservizio`.

## Request

- Metodo: `PUT`
- Path: `/tickerscanner/dbLogger/:status`
- Input noto: Path `status` (`on`/`off`); abilita/disabilita.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Path `status` (`on`/`off`); abilita/disabilita.

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
curl -X PUT "https://api.trading.expovin.it/tickerscanner/dbLogger/:status" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
