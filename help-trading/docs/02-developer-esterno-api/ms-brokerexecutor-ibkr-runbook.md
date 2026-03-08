---
sidebar_position: 5
---

# Runbook

## Avvio rapido

```bash
docker compose --profile broker-executor-ibkr up -d broker-executor-ibkr
docker compose logs -f broker-executor-ibkr
```

## Check operativi

```bash
curl -f http://localhost:3003/status/health
curl http://localhost:3003/status/info
curl http://localhost:3003/status/metrics
```

## Problemi comuni

- `health` non raggiungibile: verificare container, porta e route mount.
- errori su dipendenze: verificare `DATAHUB_URL`/`REDIS_URL` e DNS docker.
- errori auth interni: verificare `INTERNAL_JWT_*` dove applicabile.

## Osservabilita

- log servizio: `docker compose logs -f broker-executor-ibkr`
- canali runtime: `GET /status/communicationChannels`
- metriche runtime: `GET /status/metrics`
