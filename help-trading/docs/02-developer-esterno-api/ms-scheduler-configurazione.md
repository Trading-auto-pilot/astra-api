---
sidebar_position: 4
---

# Configurazione

## Docker compose (paper)

```yaml
scheduler:
  image: expovin/scheduler:${SCHEDULER_VERSION}
  restart: unless-stopped
  profiles: ["scheduler"]
  environment:
    - DATAHUB_URL=${DATAHUB_URL}
    - REDIS_URL=${REDIS_URL}
    - INTERNAL_JWT_PRIVATE_KEY=${INTERNAL_JWT_PRIVATE_KEY}
    - INTERNAL_JWT_PUBLIC_KEY=${INTERNAL_JWT_PUBLIC_KEY}
    - INTERNAL_JWT_ISS=${INTERNAL_JWT_ISS}
    - INTERNAL_JWT_EXP_SECONDS=${INTERNAL_JWT_EXP_SECONDS}
    - LOG_LEVEL=${LOG_LEVEL}
    - ENV=${ENV}
    - TZ=${TIMEZONE}
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3014/status/health"]
```

## Variabili principali

| Variabile | Default | Obbligatoria | Descrizione |
|---|---|---|---|
| `DATAHUB_URL` | `http://datahub:3000` | Si | Fonte job (`scheduler_jobs`) e update `last_run`. |
| `REDIS_URL` | `redis://redis:6379` | Si | Bus eventi + KV `scheduler:lastrun:<jobKey>`. |
| `INTERNAL_JWT_PRIVATE_KEY` | - | Se usa `/internal/*` | Firma `x-internal-token` verso altri servizi. |
| `INTERNAL_JWT_PUBLIC_KEY` | - | Se usa `/internal/*` | Coerenza coppia chiavi inter-servizio. |
| `INTERNAL_JWT_ISS` | `astraai-internal` | No | Issuer token interno. |
| `INTERNAL_JWT_EXP_SECONDS` | `60` | No | TTL token interno. |
| `LOG_LEVEL` | `info` | No | Livello logging runtime. |
| `ENV` | `LOCAL/PAPER/LIVE` | Si | Prefisso canali Redis e comportamento ambiente. |
| `TZ` | `Asia/Dubai` | No | Timezone runtime container. |

## Profili e dipendenze

- Profilo compose: `scheduler`
- Dipendenze operative: `datahub`, `redis`, endpoint target dei job.
- Healthcheck: `GET /status/health`
