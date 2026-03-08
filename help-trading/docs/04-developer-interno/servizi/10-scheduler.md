---
sidebar_position: 11
---

# scheduler

Questa pagina e il punto di ingresso API del microservizio `scheduler`.

## Scope

Gli endpoint documentati qui coprono il dominio scheduler:

- ricarica job da `datahub`
- CRUD dei job schedulati
- aggiornamento/lettura stato `last-run`
- esecuzione manuale per `jobKey`

Gli endpoint standard (`/status/*`, `/settings`, `/connect`, `/dbLogger`, ecc.) restano validi ma sono fuori da questo pilot.

## Endpoint disponibili

| METODO | PATH | Descrizione |
|---|---|---|
| POST | `/scheduler/reload` | Ricarica tutti i job da `datahub` e ricrea il runtime cron. |
| GET | `/scheduler/jobs` | Lista job dalla cache runtime o, con query dedicata, direttamente da `datahub`. |
| POST | `/scheduler/jobs` | Crea un job in `datahub` e ricarica il runtime. |
| PUT | `/scheduler/jobs/:id` | Aggiorna un job esistente e ricarica il runtime. |
| PUT | `/scheduler/jobs/:id/last-run` | Aggiorna stato ultima esecuzione (`last_run_at`, `last_status`, `last_error`). |
| DELETE | `/scheduler/job/:id` | Elimina un job da `datahub` e ricarica il runtime. |
| GET | `/scheduler/jobs/:jobKey/last-run` | Legge l'ultimo run del job da Redis KV. |
| POST | `/scheduler/jobs/:jobKey/run` | Esegue manualmente il job in cache, con override opzionali di `headers/body`. |

## Dettaglio endpoint (pilot)

- [POST /scheduler/reload](./scheduler-endpoint-reload.md)
- [GET /scheduler/jobs](./scheduler-endpoint-jobs-list.md)
- [POST /scheduler/jobs](./scheduler-endpoint-jobs-create.md)
- [PUT /scheduler/jobs/:id](./scheduler-endpoint-jobs-update.md)
- [PUT /scheduler/jobs/:id/last-run](./scheduler-endpoint-jobs-last-run-update.md)
- [DELETE /scheduler/job/:id](./scheduler-endpoint-job-delete.md)
- [GET /scheduler/jobs/:jobKey/last-run](./scheduler-endpoint-job-last-run-read.md)
- [POST /scheduler/jobs/:jobKey/run](./scheduler-endpoint-job-run.md)
