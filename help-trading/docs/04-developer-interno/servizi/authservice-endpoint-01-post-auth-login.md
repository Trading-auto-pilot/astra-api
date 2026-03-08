---
title: POST /auth/login
---

# POST /auth/login

Area: `Generale`.

## Request

- Metodo: `POST`
- Path: `/auth/login`
- Input noto: Body: `email`, `password`; restituisce JWT e profilo utente.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Body: `email`, `password`; restituisce JWT e profilo utente.

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
curl -X POST "https://api.trading.expovin.it/auth/login" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
