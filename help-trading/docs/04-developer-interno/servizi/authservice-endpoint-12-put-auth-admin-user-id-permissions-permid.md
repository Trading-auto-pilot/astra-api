---
title: PUT /auth/admin/user/:id/permissions/:permId
---

# PUT /auth/admin/user/:id/permissions/:permId

Area: `Generale`.

## Request

- Metodo: `PUT`
- Path: `/auth/admin/user/:id/permissions/:permId`
- Input noto: Path `id`, `permId`; body modifica permesso.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Path `id`, `permId`; body modifica permesso.

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
curl -X PUT "https://api.trading.expovin.it/auth/admin/user/:id/permissions/:permId" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
