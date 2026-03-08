---
title: GET /servicecontrolplane/service-flags
---

# GET /servicecontrolplane/service-flags

Area: `Generale`.

## Request

- Metodo: `GET`
- Path: `/servicecontrolplane/service-flags`
- Input noto: Nessuno; lista flags.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Nessuno; lista flags.

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
curl -X GET "https://api.trading.expovin.it/servicecontrolplane/service-flags"
```
