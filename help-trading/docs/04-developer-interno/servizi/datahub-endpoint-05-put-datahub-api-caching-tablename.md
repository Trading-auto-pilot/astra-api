---
title: PUT /datahub/api/caching/:tableName
---

# PUT /datahub/api/caching/:tableName

Area: `Generale`.

## Request

- Metodo: `PUT`
- Path: `/datahub/api/caching/:tableName`
- Input noto: Path `tableName`; body `enabled` (bool), `ttl` (numero).

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Path `tableName`; body `enabled` (bool), `ttl` (numero).

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
curl -X PUT "https://api.trading.expovin.it/datahub/api/caching/:tableName" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
