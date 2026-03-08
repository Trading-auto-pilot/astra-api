---
title: POST /cachemanager/l2/clear
---

# POST /cachemanager/l2/clear

Area: `Generale`.

## Request

- Metodo: `POST`
- Path: `/cachemanager/l2/clear`
- Input noto: Query opzionali `symbol`, `file`; pulizia totale/parziale L2.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Query opzionali `symbol`, `file`; pulizia totale/parziale L2.

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
curl -X POST "https://api.trading.expovin.it/cachemanager/l2/clear" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
