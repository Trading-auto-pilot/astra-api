---
sidebar_position: 4
---

# Configurazione

## Docker compose (paper)

```yaml
tickerscanner:
  image: expovin/tickerscanner:${TICKERSCANNER_VERSION}
  restart: unless-stopped
  profiles: ["tickerscanner"]
  environment:
    - DATAHUB_URL=${DATAHUB_URL}
    - CACHEMANAGER_URL=${CACHEMANAGER_URL}
    - AUTHSERVICE_URL=${AUTHSERVICE_URL}
    - REDIS_URL=${REDIS_URL}
    - FMP_API_KEY=${FMP_API_KEY}
    - INTERNAL_JWT_PUBLIC_KEY=${INTERNAL_JWT_PUBLIC_KEY}
    - LOG_LEVEL=${LOG_LEVEL}
    - ENV=${ENV}
    - TZ=${TIMEZONE}
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3013/status/health"]
```

## Variabili principali

| Variabile | Default | Obbligatoria | Descrizione |
|---|---|---|---|
| `DATAHUB_URL` | `http://datahub:3000` | Si | Persistenza score/job e lookup dati. |
| `CACHEMANAGER_URL` | `http://cachemanager:3006` | Si | Fetch candles/market cache. |
| `AUTHSERVICE_URL` | `http://authservice:3015` | Si | Risoluzione utente da token/API key. |
| `REDIS_URL` | `redis://redis:6379` | Si | Bus status/telemetry/events. |
| `FMP_API_KEY` | - | Si | Chiamate FMP per universe e market data. |
| `INTERNAL_JWT_PUBLIC_KEY` | - | Per endpoint interni | Valida `x-internal-token` su route `/internal/*`. |
| `SCAN_FMP_CONCURRENCY` | `3` | No | Concorrenza chiamate FMP. |
| `SCAN_MOMENTUM_CONCURRENCY` | `5` | No | Concorrenza calcolo momentum. |
| `SCAN_UPSERT_CONCURRENCY` | `5` | No | Concorrenza scritture datahub. |
| `MARKET_DAILY_CONCURRENCY` | `5` | No | Parallelismo job market_daily. |
| `LOG_LEVEL` | `info` | No | Livello logging runtime. |
| `ENV` | `LOCAL/PAPER/LIVE` | Si | Prefisso canali Redis e comportamento ambiente. |

## Profili e dipendenze

- Profilo compose: `tickerscanner`
- Dipendenze operative: `datahub`, `cachemanager`, `authservice`, `redis`, `FMP`.
- Healthcheck: `GET /status/health`
