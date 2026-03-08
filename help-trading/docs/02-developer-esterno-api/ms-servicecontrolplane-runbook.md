---
sidebar_position: 5
---

# Runbook

## Avvio rapido

```bash
docker compose --profile servicecontrolplane up -d servicecontrolplane
docker compose logs -f servicecontrolplane
```

## Check operativi

```bash
curl -f http://localhost:3016/status/health
curl http://localhost:3016/status/info
curl http://localhost:3016/status/metrics
```

## Problemi comuni

- `health` non raggiungibile: verificare container, porta e route mount.
- errori su dipendenze: verificare `DATAHUB_URL`/`REDIS_URL` e DNS docker.
- errori auth interni: verificare `INTERNAL_JWT_*` dove applicabile.

## Osservabilita

- log servizio: `docker compose logs -f servicecontrolplane`
- canali runtime: `GET /status/communicationChannels`
- metriche runtime: `GET /status/metrics`
