---
title: POST /tickerscanner/universe/scan/force
---

# POST /tickerscanner/universe/scan/force

Area: `Universe (Fase 1)`.

## Request

- Metodo: `POST`
- Path: `/tickerscanner/universe/scan/force`
- Input noto: Body opzionale filtri; forza ricalcolo su tutti i simboli.

## Parametri / Body

Interpretazione diretta dalla definizione corrente dell'endpoint nel progetto:

- Body opzionale filtri; forza ricalcolo su tutti i simboli.

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
curl -X POST "https://api.trading.expovin.it/tickerscanner/universe/scan/force" \\
  -H "Content-Type: application/json" \\
  -d '{"example": true}'
```
