---
title: POST /market-simulator/session/tick
---

# POST /market-simulator/session/tick

Area: `Sessione`.

## Request

- Metodo: `POST`
- Path: `/market-simulator/session/tick`
- Input noto: Nessuno; avanza di un passo temporale e pubblica gli snapshot su Redis per tutti i ticker sottoscritti.

## Parametri / Body

Nessuno.

## Risposta attesa

`200 OK` (o equivalente applicativo).

```json
{
  "ok": true,
  "date": "2024-01-17T00:00:00.000Z",
  "published": 2,
  "skipped": 0,
  "hasMore": true
}
```

| Campo | Tipo | Descrizione |
|---|---|---|
| `date` | `string` | Data corrente dopo l'avanzamento. |
| `published` | `number` | Numero di snapshot pubblicati su Redis. |
| `skipped` | `number` | Ticker saltati (candela non trovata). |
| `hasMore` | `boolean` | `true` se ci sono ancora tick disponibili. |

## Errori comuni

| HTTP | Quando |
|---|---|
| `400` | Sessione non attiva o già terminata (`hasMore: false`). |
| `401`/`403` | Autenticazione/autorizzazione non valida. |
| `500` | Errore interno. |

## Esempio

```bash
curl -X POST "https://api.trading.expovin.it/market-simulator/session/tick"
```
