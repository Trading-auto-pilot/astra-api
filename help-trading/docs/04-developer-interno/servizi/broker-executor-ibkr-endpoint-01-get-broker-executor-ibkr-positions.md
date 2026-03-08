---
title: GET /broker-executor-ibkr/positions
---

# GET /broker-executor-ibkr/positions

Area: `Generale`.

## Request

- Metodo: `GET`
- Path: `/broker-executor-ibkr/positions`
- Input noto: Query opzionali di filtro account/simbolo (se supportate dal controller).

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Query opzionali di filtro account/simbolo (se supportate dal controller).

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
curl -X GET "https://api.trading.expovin.it/broker-executor-ibkr/positions"
```
