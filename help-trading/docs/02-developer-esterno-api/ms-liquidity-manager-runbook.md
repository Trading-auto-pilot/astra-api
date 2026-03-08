---
sidebar_position: 5
---

# Runbook

## Avvio rapido

```bash
docker compose --profile liquidity-manager up -d liquidity-manager
docker compose logs -f liquidity-manager
```

## Check operativi

```bash
curl -f http://localhost:3001/status/health
curl http://localhost:3001/status/info
curl http://localhost:3001/status/metrics
```

## Problemi comuni

- `health` non raggiungibile: verificare container, porta e route mount.
- errori su dipendenze: verificare `DATAHUB_URL`/`REDIS_URL` e DNS docker.
- errori auth interni: verificare `INTERNAL_JWT_*` dove applicabile.

## Osservabilita

- log servizio: `docker compose logs -f liquidity-manager`
- canali runtime: `GET /status/communicationChannels`
- metriche runtime: `GET /status/metrics`
