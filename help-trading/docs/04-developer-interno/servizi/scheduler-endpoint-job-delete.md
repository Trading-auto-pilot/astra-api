---
title: DELETE /scheduler/job/:id
---

# DELETE /scheduler/job/:id

Elimina un job da `datahub` e ricarica il runtime scheduler.

## Request

- Metodo: `DELETE`
- Path: `/scheduler/job/:id`

### Path params

| Parametro | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `id` | `number|string` | Si | ID del job da eliminare. |

## Risposta OK

`200 OK`

```json
{
  "ok": true
}
```

## Errori

| HTTP | Quando |
|---|---|
| `500` | `SchedulerCore` non inizializzato o errore delete su `datahub`. |

## Esempio

```bash
curl -X DELETE "http://localhost:3014/scheduler/job/123"
```

