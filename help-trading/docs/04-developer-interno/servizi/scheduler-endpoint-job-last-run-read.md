---
title: GET /scheduler/jobs/:jobKey/last-run
---

# GET /scheduler/jobs/:jobKey/last-run

Legge da Redis KV l'ultimo stato di esecuzione del job (`scheduler:lastrun:<jobKey>`).

## Request

- Metodo: `GET`
- Path: `/scheduler/jobs/:jobKey/last-run`

### Path params

| Parametro | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `jobKey` | `string` | Si | Chiave logica job. |

## Risposta OK

`200 OK`

```json
{
  "ok": true,
  "data": {
    "jobKey": "daily-user-score",
    "status": "completed",
    "at": "2026-03-03T08:30:00.000Z"
  }
}
```

## Errori

| HTTP | Quando |
|---|---|
| `404` | Nessun dato trovato in Redis per il `jobKey` richiesto. |
| `500` | Bus Redis non disponibile o errore runtime. |

## Esempio

```bash
curl "http://localhost:3014/scheduler/jobs/daily-user-score/last-run"
```

