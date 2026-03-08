---
sidebar_position: 1
---

# Architettura e flussi

## Componenti principali

- `Scheduler` (`modules/main.js`): bootstrap, settings, RedisBus, lifecycle servizio;
- `SchedulerCore` (`modules/schedulerCore.js`): orchestration job e reload cache;
- `SchedulerEngine` (`modules/schedulerEngine.js`): scheduling cron, esecuzione HTTP, retry, gestione hook async;
- `schedulerJobsClient` (`modules/schedulerJobsClient.js`): CRUD verso `datahub` su `scheduler_jobs`.

## Flusso di bootstrap

1. Il servizio si inizializza (`main.init`) e connette RedisBus.
2. Carica settings da `DATAHUB_URL/DBMANAGER_URL`.
3. Avvia `SchedulerCore`.
4. `SchedulerCore` carica `scheduler_jobs` da datahub e passa i job al motore.
5. `SchedulerEngine` crea task cron (`node-cron`) e si sottoscrive a hook Redis (`<ENV>.*.status.HOOK`).

## Flusso di esecuzione job

1. Trigger cron (o run manuale) avvia `_runJob`.
2. Risolve placeholder runtime in URL/header/body (`[[today]]`, ecc.).
3. Se URL e interno (`/internal/*`), firma token `x-internal-token`.
4. Esegue chiamata HTTP verso microservizio target.
5. Aggiorna stato in Redis KV (`scheduler:lastrun:<jobKey>`) e su datahub (`last_run_at`, `last_status`).
6. Pubblica evento task su Redis.

## Job asincroni e hook

Se un endpoint risponde con payload `type=async` + `jobId`, il job viene messo in `pendingAsyncJobs` e il completamento arriva da messaggi Redis `type=job.done` su pattern `*.status.HOOK`.

## Autenticazione interna

Per le chiamate `/internal/*` lo scheduler usa la chiave privata per firmare JWT a breve TTL.

Per dettagli su issuer/audience/scope e verifica lato servizio target:

- [Autenticazione interna tra microservizi](./ms-authservice-autenticazione-interna.md)
