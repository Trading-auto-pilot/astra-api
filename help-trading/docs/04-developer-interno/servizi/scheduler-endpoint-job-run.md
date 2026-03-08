---
title: POST /scheduler/jobs/:jobKey/run
---

# POST /scheduler/jobs/:jobKey/run

Esegue manualmente un job già presente nella cache runtime (`SchedulerCore.runJobByKey`).

## Request

- Metodo: `POST`
- Path: `/scheduler/jobs/:jobKey/run`

### Path params

| Parametro | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `jobKey` | `string` | Si | Chiave logica del job da eseguire. |

### Body (opzionale)

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `headers` | `object` | No | Override header della chiamata target del job. |
| `body` | `object` | No | Override body della chiamata target del job. |

## Risposta OK

`200 OK`

```json
{
  "ok": true,
  "jobKey": "daily-user-score",
  "message": "Job \"daily-user-score\" avviato manualmente"
}
```

## Errori

| HTTP | Quando |
|---|---|
| `404` | Job non trovato nella cache runtime del scheduler. |
| `500` | `SchedulerCore` non inizializzato o errore runtime. |

## Esempio

```bash
curl -X POST "http://localhost:3014/scheduler/jobs/daily-user-score/run" \
  -H "Content-Type: application/json" \
  -d '{
    "headers": {
      "x-force-run": "1"
    },
    "body": {
      "scoreDate": "2026-03-03"
    }
  }'
```

