---
title: POST /datahub/api/table/:tableName
---

# POST /datahub/api/table/:tableName

Area: `Generale`.

## Request

- Metodo: `POST`
- Path: `/datahub/api/table/:tableName`
- Input noto: Body record da inserire.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Body record da inserire.

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
curl -X POST "https://api.trading.expovin.it/datahub/api/table/:tableName" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
