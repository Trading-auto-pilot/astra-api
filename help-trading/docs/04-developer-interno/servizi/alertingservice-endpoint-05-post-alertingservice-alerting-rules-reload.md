---
title: POST /alertingservice/alerting/rules/reload
---

# POST /alertingservice/alerting/rules/reload

Area: `Generale`.

## Request

- Metodo: `POST`
- Path: `/alertingservice/alerting/rules/reload`
- Input noto: Nessuno; ricarica regole engine in memoria.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Nessuno; ricarica regole engine in memoria.

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
curl -X POST "https://api.trading.expovin.it/alertingservice/alerting/rules/reload" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
