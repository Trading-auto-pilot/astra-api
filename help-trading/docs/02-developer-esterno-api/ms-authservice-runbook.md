---
sidebar_position: 5
---

# Runbook

## Avvio rapido

```bash
docker compose --profile authservice up -d authservice
docker compose logs -f authservice
```

## Check operativi

```bash
curl -f http://localhost:3015/status/health
curl http://localhost:3015/status/info
curl http://localhost:3015/status/metrics
```

## Problemi comuni

- `health` non raggiungibile: verificare container, porta e route mount.
- errori su dipendenze: verificare `DATAHUB_URL`/`REDIS_URL` e DNS docker.
- errori auth interni: verificare `INTERNAL_JWT_*` dove applicabile.

## Osservabilita

- log servizio: `docker compose logs -f authservice`
- canali runtime: `GET /status/communicationChannels`
- metriche runtime: `GET /status/metrics`
