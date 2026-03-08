---
title: PUT /servicecontrolplane/service-flags/:id
---

# PUT /servicecontrolplane/service-flags/:id

Area: `Generale`.

## Request

- Metodo: `PUT`
- Path: `/servicecontrolplane/service-flags/:id`
- Input noto: Path `id`; body stessi campi create/update.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Path `id`; body stessi campi create/update.

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
curl -X PUT "https://api.trading.expovin.it/servicecontrolplane/service-flags/:id" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
