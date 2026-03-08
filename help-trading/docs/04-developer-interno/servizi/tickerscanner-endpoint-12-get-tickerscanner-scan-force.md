---
title: GET /tickerscanner/scan/force
---

# GET /tickerscanner/scan/force

Area: `Scanner (legacy)`.

## Request

- Metodo: `GET`
- Path: `/tickerscanner/scan/force`
- Input noto: Query scanner; forza nuova esecuzione.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Query scanner; forza nuova esecuzione.

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
curl -X GET "https://api.trading.expovin.it/tickerscanner/scan/force"
```
