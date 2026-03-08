---
title: PUT /datahub/auth/users/:id
---

# PUT /datahub/auth/users/:id

Area: `Generale`.

## Request

- Metodo: `PUT`
- Path: `/datahub/auth/users/:id`
- Input noto: Path `id`; body update utente.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Path `id`; body update utente.

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
curl -X PUT "https://api.trading.expovin.it/datahub/auth/users/:id" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
