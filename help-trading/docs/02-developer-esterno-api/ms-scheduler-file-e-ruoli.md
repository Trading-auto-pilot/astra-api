---
sidebar_position: 3
---

# Implementazione per file

## Struttura principale

- `scheduler/server.js`
- `scheduler/modules/main.js`
- `scheduler/modules/schedulerCore.js`
- `scheduler/modules/schedulerEngine.js`
- `scheduler/modules/schedulerJobsClient.js`
- `scheduler/status.js`
- `scheduler/events.manifest.json`

## Ruolo dei file

### `server.js`

Entry point HTTP:

- espone API operative (`/jobs`, `/reload`, `/jobs/:jobKey/run`);
- gestisce endpoint standard (`settings`, `release`, `dbLogger`, `connect`);
- monta router `/status/*`;
- trasforma payload frontend job -> formato DB (`snake_case`) prima di chiamare datahub.

### `modules/main.js`

Bootstrap applicativo:

- init `RedisBus`, logger e settings runtime;
- fallback `DATAHUB_URL || DBMANAGER_URL`;
- pubblicazione eventi manifest;
- inizializzazione `SchedulerCore` e retry di init su errori.

### `modules/schedulerCore.js`

Coordinamento scheduler:

- carica job da `scheduler_jobs` via datahub adapter;
- avvia/reavvia engine su reload;
- fornisce snapshot job e run manuale per `jobKey`.

### `modules/schedulerEngine.js`

Motore di scheduling:

- parsing regole cron (daily/weekly/monthly);
- esecuzione request HTTP con retry/backoff;
- supporto job asincroni (`type=async`) con attesa hook Redis `job.done`;
- firma token interni su URL `/internal/*` (`x-internal-token`);
- aggiornamento stato esecuzione su Redis + datahub.

### `modules/schedulerJobsClient.js`

Client CRUD tabella `scheduler_jobs`:

- `list`, `get`, `create`, `update`, `delete`;
- `updateLastRun` con mapping `last_run` -> `last_run_at`.

### `status.js`

Router status standard:

- health/info/metrics/log-level;
- gestione dinamica canali di comunicazione Redis.

## Note implementative utili

- I token interni vengono mascherati nei log (`***`).
- Il job runtime puo iniettare `x-job-key` automaticamente se mancante.
- `openMarket` puo bloccare l'esecuzione in base agli exchange aperti (check FMP API).
