---
title: GET /scheduler/jobs
---

# GET /scheduler/jobs

Restituisce l'elenco dei job scheduler.

## Request

- Metodo: `GET`
- Path: `/scheduler/jobs`

### Query params

| Parametro | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `include_disabled` | `string` (`1`/`true`) | No | Se valorizzato, forza lettura da `datahub` includendo anche job disabilitati. |
| `includeDisabled` | `string` (`1`/`true`) | No | Alias camelCase di `include_disabled`. |

## Risposta OK

`200 OK`

```json
{
  "ok": true,
  "items": [
    {
      "id": 17,
      "job_key": "daily-user-score",
      "enabled": 1,
      "method": "POST",
      "url": "http://tickerscanner:3013/internal/fundamentals/user-daily-scores"
    }
  ]
}
```

## Errori

| HTTP | Quando |
|---|---|
| `500` | `SchedulerCore` non inizializzato oppure errore nella lettura da `datahub`. |

## Esempio

```bash
curl "http://localhost:3014/scheduler/jobs?include_disabled=true"
```

