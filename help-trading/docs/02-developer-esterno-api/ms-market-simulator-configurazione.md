---
sidebar_position: 4
---

# Configurazione

## Servizio

| Proprietà | Valore |
|---|---|
| **Nome** | `market-simulator` |
| **Porta interna** | `3010` |
| **Prefisso API** | `/market-simulator` |
| **Profilo Docker Compose** | `market-simulator` |

## Variabili d'ambiente

| Variabile | Default | Obbligatoria | Descrizione |
|---|---|---|---|
| `DATAHUB_URL` | — | ✓ | URL datahub per settings e logging |
| `REDIS_URL` | — | ✓ | Connessione Redis |
| `CACHEMANAGER_URL` | `http://cachemanager:3006` | — | Fonte dati candele storiche |
| `ENV` | `DEV` | — | Prefisso canali Redis (es. `PROD`) |
| `LOG_LEVEL` | `info` | — | `trace` / `debug` / `info` / `warning` / `error` |
| `TZ` | `UTC` | — | Timezone del container |
| `PORT` | `3010` | — | Override porta HTTP |

## Canale Redis pubblicato

```
${ENV}.market-data-service.data
```

Il simulatore pubblica su questo canale ad ogni tick. Il decision-engine si iscrive allo stesso canale indipendentemente dalla modalità (live o simulata).

## Attivazione modalità simulata nel decision-engine

Per far puntare il decision-engine al simulatore invece di `market-data-service`, impostare:

```bash
MARKETDATASERVICE_URL=http://market-simulator:3010
```

Nell'ambiente paper è sufficiente aggiungere questa variabile al `.env.paper` prima di avviare il decision-engine.

## Docker Compose (estratto)

```yaml
market-simulator:
  image: trading-system/market-simulator:latest
  build:
    context: .
    dockerfile: market-simulator/Dockerfile
  ports:
    - "3010:3010"
  environment:
    - DATAHUB_URL=${DATAHUB_URL}
    - REDIS_URL=${REDIS_URL}
    - CACHEMANAGER_URL=${CACHEMANAGER_URL:-http://cachemanager:3006}
    - ENV=${ENV:-DEV}
    - LOG_LEVEL=${LOG_LEVEL:-info}
  profiles:
    - market-simulator
  depends_on:
    - redis
    - datahub
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3010/status/health"]
    interval: 30s
    timeout: 10s
    retries: 3
```
