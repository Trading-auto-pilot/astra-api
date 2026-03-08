---
title: POST /scheduler/jobs
---

# POST /scheduler/jobs

Crea un job in `scheduler_jobs` via `datahub` e poi ricarica la cache runtime.

## Request

- Metodo: `POST`
- Path: `/scheduler/jobs`

### Body

Il server accetta sia payload diretto sia formato frontend `{ job: {...} }`.

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `job_key` o `jobKey` | `string` | Si | Chiave logica del job. |
| `description` | `string` | No | Descrizione job. |
| `enabled` | `boolean/number` | No | Abilitazione job (`true/1` attivo). |
| `method` | `string` | Si | Metodo HTTP target (`GET`, `POST`, ...). |
| `url` | `string` | Si | URL endpoint da invocare. |
| `headers` | `object` | No | Header aggiuntivi della chiamata. |
| `body` | `object` | No | Body da inviare al target. |
| `timezone` | `string` | No | Timezone del job. |
| `timeoutMs` | `number` | No | Timeout richiesta verso target. |
| `openMarket` | `boolean` | No | Se `true`, esegue il job solo a mercato aperto. |
| `exchanges` | `string[]` | No | Exchange da considerare per `openMarket`. |
| `retry.maxAttempts` | `number` | No | Numero massimo retry. |
| `retry.backoffMs` | `number` | No | Backoff retry in millisecondi. |

## Risposta OK

`200 OK`

```json
{
  "ok": true,
  "id": 123,
  "job_key": "daily-user-score"
}
```

## Errori

| HTTP | Quando |
|---|---|
| `500` | `SchedulerCore` non inizializzato. |
| `4xx/5xx` | Errore propagato dalla chiamata a `datahub`. |

## Esempio

```bash
curl -X POST "http://localhost:3014/scheduler/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "job": {
      "jobKey": "daily-user-score",
      "description": "Daily user score compute",
      "enabled": true,
      "method": "POST",
      "url": "http://tickerscanner:3013/internal/fundamentals/user-daily-scores",
      "headers": {"x-job-key":"daily-user-score"},
      "body": {"scoreDate":"2026-03-03"},
      "retry": {"maxAttempts": 3, "backoffMs": 5000}
    }
  }'
```

