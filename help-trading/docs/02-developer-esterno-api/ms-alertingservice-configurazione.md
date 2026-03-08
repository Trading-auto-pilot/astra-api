---
sidebar_position: 4
---

# Configurazione

## Parametri operativi

| Parametro | Valore |
|---|---|
| Servizio | `alertingservice` |
| Porta interna | `3008` |
| Prefisso API | `/alertingservice` |

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
