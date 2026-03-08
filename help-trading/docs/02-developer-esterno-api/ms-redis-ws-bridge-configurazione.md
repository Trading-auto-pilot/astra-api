---
sidebar_position: 4
---

# Configurazione

## Parametri operativi

| Parametro | Valore |
|---|---|
| Servizio | `redis-ws-bridge` |
| Porta interna | `3030` |
| Prefisso API | `/redis-ws-bridge` |

## Variabili chiave

- `DATAHUB_URL` (o fallback legacy `DBMANAGER_URL`)
- `REDIS_URL`
- `LOG_LEVEL`
- `ENV`
- `TZ`

## Compose e profili

- servizio definito in `docker-compose*.yml`
- profile compose dedicato al microservizio
- healthcheck su `.../status/health`
