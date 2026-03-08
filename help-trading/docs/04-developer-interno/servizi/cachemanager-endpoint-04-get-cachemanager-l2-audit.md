---
title: GET /cachemanager/l2/audit
---

# GET /cachemanager/l2/audit

Area: `Generale`.

## Request

- Metodo: `GET`
- Path: `/cachemanager/l2/audit`
- Input noto: Query: `symbol`, `tf`, `clean`; audit qualita cache file.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Query: `symbol`, `tf`, `clean`; audit qualita cache file.

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
curl -X GET "https://api.trading.expovin.it/cachemanager/l2/audit"
```
