---
sidebar_position: 5
---

# Runbook

## Avvio rapido

```bash
# Avvio servizio scheduler (con profilo)
docker compose --profile scheduler up -d scheduler

# Log live
docker compose logs -f scheduler
```

## Verifiche base

```bash
curl -f http://localhost:3014/status/health
curl http://localhost:3014/status/info
curl http://localhost:3014/scheduler/jobs
```

## Troubleshooting

### I job non partono

- Verifica `GET /scheduler/jobs` (enabled, schedule, timezone).
- Controlla connessione datahub (`DATAHUB_URL`) e Redis (`REDIS_URL`).
- Controlla log su parsing cron e reload jobs.

### I job `/internal/*` falliscono con 401/403

- Verifica `INTERNAL_JWT_PRIVATE_KEY`, `INTERNAL_JWT_ISS`, `INTERNAL_JWT_EXP_SECONDS`.
- Verifica che il servizio target abbia la chiave pubblica coerente.
- Controlla orario sistema/timezone per token expiry.

### Stato ultima esecuzione non aggiornato

- Controlla Redis key `scheduler:lastrun:<jobKey>`.
- Verifica update `PUT /scheduler/jobs/:id/last-run` su datahub.

## Osservabilita

- Endpoint metriche: `GET /status/metrics`
- Canali: `GET /status/communicationChannels`
- Eventi task: `ENV.scheduler.events`
- Hook asincroni ascoltati: `ENV.*.status.HOOK`
