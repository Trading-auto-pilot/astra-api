---
title: GET /cachemanager/status/L3/size
---

# GET /cachemanager/status/L3/size

Area: `Generale`.

## Request

- Metodo: `GET`
- Path: `/cachemanager/status/L3/size`
- Input noto: Nessuno; dimensione cache in-memory L3.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Nessuno; dimensione cache in-memory L3.

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
curl -X GET "https://api.trading.expovin.it/cachemanager/status/L3/size"
```
