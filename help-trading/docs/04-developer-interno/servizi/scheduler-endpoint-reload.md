---
title: POST /scheduler/reload
---

# POST /scheduler/reload

Ricarica i job da `datahub` e ricrea la schedulazione in memoria (`SchedulerCore.reloadJobs()`).

## Request

- Metodo: `POST`
- Path: `/scheduler/reload`
- Query: nessuna
- Body: nessuno

## Risposta OK

`200 OK`

```json
{
  "ok": true,
  "jobs": 12
}
```

## Errori

| HTTP | Quando |
|---|---|
| `500` | `SchedulerCore` non inizializzato o eccezione durante il reload. |

## Esempio

```bash
curl -X POST "http://localhost:3014/scheduler/reload"
```

