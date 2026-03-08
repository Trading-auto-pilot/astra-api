---
sidebar_position: 4
---

# Configurazione

## Parametri operativi

| Parametro | Valore |
|---|---|
| Servizio | `servicecontrolplane` |
| Porta interna | `3016` |
| Prefisso API | `/servicecontrolplane` |

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
