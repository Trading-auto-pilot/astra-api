---
title: GET /auth/admin/user/:id/permissions
---

# GET /auth/admin/user/:id/permissions

Area: `Generale`.

## Request

- Metodo: `GET`
- Path: `/auth/admin/user/:id/permissions`
- Input noto: Path `id`: lista permessi utente.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Path `id`: lista permessi utente.

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
curl -X GET "https://api.trading.expovin.it/auth/admin/user/:id/permissions"
```
