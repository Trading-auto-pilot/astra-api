---
title: POST /tickerscanner/universe/scan
---

# POST /tickerscanner/universe/scan

Area: `Universe (Fase 1)`.

## Request

- Metodo: `POST`
- Path: `/tickerscanner/universe/scan`
- Input noto: Body opzionale filtri; avvia scan solo sui simboli non ancora in `universe`.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Body opzionale filtri; avvia scan solo sui simboli non ancora in `universe`.

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
curl -X POST "https://api.trading.expovin.it/tickerscanner/universe/scan" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
