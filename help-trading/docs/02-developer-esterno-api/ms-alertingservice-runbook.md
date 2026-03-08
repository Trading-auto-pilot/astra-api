---
sidebar_position: 5
---

# Runbook

## Avvio rapido

```bash
docker compose --profile alertingservice up -d alertingservice
docker compose logs -f alertingservice
```

## Check operativi

```bash
curl -f http://localhost:3008/status/health
curl http://localhost:3008/status/info
curl http://localhost:3008/status/metrics
```

## Problemi comuni

- `health` non raggiungibile: verificare container, porta e route mount.
- errori su dipendenze: verificare `DATAHUB_URL`/`REDIS_URL` e DNS docker.
- errori auth interni: verificare `INTERNAL_JWT_*` dove applicabile.

## Osservabilita

- log servizio: `docker compose logs -f alertingservice`
- canali runtime: `GET /status/communicationChannels`
- metriche runtime: `GET /status/metrics`
