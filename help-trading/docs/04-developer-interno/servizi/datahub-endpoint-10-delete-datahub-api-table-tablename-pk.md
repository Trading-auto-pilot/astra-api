---
title: DELETE /datahub/api/table/:tableName/:pk...
---

# DELETE /datahub/api/table/:tableName/:pk...

Area: `Generale`.

## Request

- Metodo: `DELETE`
- Path: `/datahub/api/table/:tableName/:pk...`
- Input noto: Path PK; elimina record.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Path PK; elimina record.

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
curl -X DELETE "https://api.trading.expovin.it/datahub/api/table/:tableName/:pk..."
```
