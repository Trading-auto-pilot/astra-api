---
title: PUT /auth/admin/api-keys/:id
---

# PUT /auth/admin/api-keys/:id

Area: `Generale`.

## Request

- Metodo: `PUT`
- Path: `/auth/admin/api-keys/:id`
- Input noto: Path `id`; aggiorna API key metadata/stato.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Path `id`; aggiorna API key metadata/stato.

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
curl -X PUT "https://api.trading.expovin.it/auth/admin/api-keys/:id" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
