---
sidebar_position: 21
---

import ServiceControlPlaneArchitectureDiagram from '@site/src/components/ServiceControlPlaneArchitectureDiagram';

# servicecontrolplane

## Cosa fa

`servicecontrolplane` espone API centralizzate di controllo operativo, in particolare per la gestione dei `service_flags` usati dai microservizi.

## Ruoli e responsabilita

- API CRUD su `service_flags` (env + microservice + enabled + note);
- integrazione con `datahub` per persistenza configurazioni runtime;
- esposizione endpoint standard di stato/configurazione del servizio;
- supporto osservabilita tramite Redis bus e logger shared.

## Porta esposta

- Porta interna servizio: `3016`
- Esposizione via Traefik: `https://api.trading.expovin.it/servicecontrolplane/*`

## Architettura grafica

<ServiceControlPlaneArchitectureDiagram />

## Configurazione (docker-compose.paper.yml)

```yaml
servicecontrolplane:
  image: expovin/servicecontrolplane:${SERVICECONTROLPLANE_VERSION}
  restart: unless-stopped
  profiles: ["servicecontrolplane"]
  environment:
    - LOG_LEVEL=${LOG_LEVEL}
    - ENV=${ENV}
    - LOG_BATCH_MAX_BYTES=${LOG_BATCH_MAX_BYTES}
    - ENABLE_DB_LOG=${ENABLE_DB_LOG}
    - MYSQL_HOST=${MYSQL_HOST}
    - MYSQL_PORT=${MYSQL_PORT}
    - MYSQL_USER=${MYSQL_USER}
    - MYSQL_PASSWORD=${MYSQL_PASSWORD}
    - MYSQL_DATABASE=${MYSQL_DATABASE}
    - REDIS_URL=${REDIS_URL}
    - DBMANAGER_URL=${DBMANAGER_URL}
    - CACHEMANAGER_URL=${CACHEMANAGER_URL}
    - ALERTINGSERVICE_URL=${ALERTINGMANAGER_URL}
    - TICKERSCANNER_URL=${TICKERSCANNER_URL}
    - SCHEDULER_URL=${SCHEDULER_URL}
    - AUTHSERVICE_URL=${AUTHSERVICE_URL}
    - TZ=${TIMEZONE}
  depends_on:
    dbmanager:
      condition: service_healthy
    redis:
      condition: service_healthy
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3016/status/health"]
  labels:
    - "traefik.enable=true"
    - "traefik.http.routers.servicecontrolplane.rule=Host(`api.trading.expovin.it`) && PathPrefix(`/servicecontrolplane`)"
    - "traefik.http.services.servicecontrolplane.loadbalancer.server.port=3016"
    - "traefik.http.routers.servicecontrolplane.middlewares=servicecontrolplane-stripprefix,cors-default@docker,auth-forward@docker"
```

## Variabili d'ambiente

### Infrastruttura

Variabili obbligatorie gestite da `BaseService` (comune a tutti i microservizi).

| Variabile | Default | Descrizione |
|---|---|---|
| `DATAHUB_URL` | `http://datahub:3000` | URL del servizio `datahub` (ex `DBMANAGER_URL`, ancora accettato come alias). |
| `REDIS_URL` | — | URI Redis (es. `redis://redis:6379`). Obbligatorio per il bus eventi e i canali di stato. |
| `LOG_LEVEL` | `info` | Livello di log: `trace`, `debug`, `info`, `warning`, `error`. |
| `ENV` | `DEV` | Ambiente di esecuzione (`local`, `paper`, `prod`). Usato nel prefisso dei canali Redis. |
| `LOG_BATCH_MAX_BYTES` | — | Dimensione massima batch per il log su DB (funzionalità `dbLogger`). |
| `ENABLE_DB_LOG` | — | Se `true`, abilita la scrittura dei log su DB via `datahub`. |
| `TZ` | — | Timezone di sistema del container (es. `America/New_York`). |

### URL microservizi gestiti

`servicecontrolplane` mantiene i riferimenti agli URL di tutti i microservizi del sistema per operazioni di controllo e orchestrazione. Tutte queste variabili hanno un default che punta al nome del container Docker interno.

| Variabile | Default | Descrizione |
|---|---|---|
| `DBMANAGER_URL` | `http://datahub:3000` | Alias legacy per `DATAHUB_URL`. Ancora accettato per retrocompatibilità. |
| `CACHEMANAGER_URL` | `http://cachemanager:3006` | URL del `cachemanager`. |
| `ALERTINGSERVICE_URL` | `http://alertingservice:3008` | URL dell'`alertingservice`. |
| `AUTHSERVICE_URL` | `http://authService:3015` | URL dell'`authservice`. |
| `TICKERSCANNER_URL` | `http://tickerscanner:3013` | URL del `tickerscanner`. |
| `SCHEDULER_URL` | `http://scheduler:3014` | URL dello `scheduler`. |
| `MARKETSIMULATOR_URL` | `http://marketsimulator:3003` | URL del `marketsimulator`. |
| `ORDERSIMULATOR_URL` | `http://ordersimulator:3004` | URL dell'`ordersimulator`. |
| `ORDERLISTNER_URL` | `http://orderlistner:3005` | URL dell'`orderlistner`. |
| `STRATEGYUTILS_URL` | `http://strategyUtils:3007` | URL delle `strategyUtils`. |
| `CAPITALMANAGER_URL` | `http://capitalmanager:3009` | URL del `capitalmanager`. |
| `SMA_URL` | `http://sma:3010` | URL del servizio `sma`. |
| `SLTP_URL` | `http://sltp:3011` | URL del servizio `sltp`. |
| `LIVEMARKETLISTNER_URL` | `http://livemarketlistner:3012` | URL del `livemarketlistner`. |
| `SERVICECONTROLPLANE_URL` | `http://servicecontrolplane:3016` | URL del servizio stesso (auto-riferimento). |

## Pagine dedicate

- [Architettura e flussi](./ms-servicecontrolplane-architettura.md)
- [Endpoint dettagliati](./ms-servicecontrolplane-endpoint.md)
- [Implementazione per file](./ms-servicecontrolplane-file-e-ruoli.md)
- [Configurazione](./ms-servicecontrolplane-configurazione.md)
- [Runbook operativo](./ms-servicecontrolplane-runbook.md)
