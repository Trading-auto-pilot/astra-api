---
title: PUT /auth/admin/user/:id
---

# PUT /auth/admin/user/:id

Area: `Generale`.

## Request

- Metodo: `PUT`
- Path: `/auth/admin/user/:id`
- Input noto: Path `id`; body campi aggiornabili utente.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Path `id`; body campi aggiornabili utente.

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
curl -X PUT "https://api.trading.expovin.it/auth/admin/user/:id" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
