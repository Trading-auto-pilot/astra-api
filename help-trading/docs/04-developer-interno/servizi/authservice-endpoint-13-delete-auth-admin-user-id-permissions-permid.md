---
title: DELETE /auth/admin/user/:id/permissions/:permId
---

# DELETE /auth/admin/user/:id/permissions/:permId

Area: `Generale`.

## Request

- Metodo: `DELETE`
- Path: `/auth/admin/user/:id/permissions/:permId`
- Input noto: Path `id`, `permId`; rimozione permesso.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Path `id`, `permId`; rimozione permesso.

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
curl -X DELETE "https://api.trading.expovin.it/auth/admin/user/:id/permissions/:permId"
```
