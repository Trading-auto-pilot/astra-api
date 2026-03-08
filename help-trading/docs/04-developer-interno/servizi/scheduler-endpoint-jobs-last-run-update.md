---
title: PUT /scheduler/jobs/:id/last-run
---

# PUT /scheduler/jobs/:id/last-run

Aggiorna lo stato dell'ultima esecuzione del job nel DB.

## Request

- Metodo: `PUT`
- Path: `/scheduler/jobs/:id/last-run`

### Path params

| Parametro | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `id` | `number|string` | Si | ID del job. |

### Body

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `last_run` | `string` (ISO datetime) | Si | Timestamp dell'ultima esecuzione. |
| `last_status` | `string` | Si | Stato ultima esecuzione (`started`, `completed`, `error`, `skipped`, ...). |
| `last_error` | `string` | No | Messaggio errore ultimo run. |

## Risposta OK

`200 OK`

```json
{
  "ok": true,
  "id": 123
}
```

## Errori

| HTTP | Quando |
|---|---|
| `500` | `SchedulerCore` non inizializzato o errore update su `datahub`. |

## Esempio

```bash
curl -X PUT "http://localhost:3014/scheduler/jobs/123/last-run" \
  -H "Content-Type: application/json" \
  -d '{
    "last_run": "2026-03-03T08:30:00.000Z",
    "last_status": "completed"
  }'
```

