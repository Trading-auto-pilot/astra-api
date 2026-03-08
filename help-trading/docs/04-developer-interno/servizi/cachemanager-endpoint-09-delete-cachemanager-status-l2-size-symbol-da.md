---
title: DELETE /cachemanager/status/L2/size/:symbol/:date?
---

# DELETE /cachemanager/status/L2/size/:symbol/:date?

Area: `Generale`.

## Request

- Metodo: `DELETE`
- Path: `/cachemanager/status/L2/size/:symbol/:date?`
- Input noto: Path `symbol` e opzionale `date`; invalidazione L2 mirata.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Path `symbol` e opzionale `date`; invalidazione L2 mirata.

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
curl -X DELETE "https://api.trading.expovin.it/cachemanager/status/L2/size/:symbol/:date?"
```
