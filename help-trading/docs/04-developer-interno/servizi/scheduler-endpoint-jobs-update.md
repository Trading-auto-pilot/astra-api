---
title: PUT /scheduler/jobs/:id
---

# PUT /scheduler/jobs/:id

Aggiorna un job esistente in `scheduler_jobs` via `datahub` e ricarica i job runtime.

## Request

- Metodo: `PUT`
- Path: `/scheduler/jobs/:id`

### Path params

| Parametro | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `id` | `number|string` | Si | ID del job nel DB. |

### Body

Stessi campi di creazione (`POST /scheduler/jobs`), in forma parziale.

Nota implementativa: i campi read-only (`id`, `created_at`, `updated_at`) vengono rimossi lato server prima dell'update.

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
| `500` | `SchedulerCore` non inizializzato oppure errore update/ricarica job. |

## Esempio

```bash
curl -X PUT "http://localhost:3014/scheduler/jobs/123" \
  -H "Content-Type: application/json" \
  -d '{
    "job": {
      "enabled": true,
      "timeoutMs": 45000,
      "retry": {"maxAttempts": 2, "backoffMs": 3000}
    }
  }'
```

