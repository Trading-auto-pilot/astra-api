---
sidebar_position: 19
---

import SchedulerArchitectureDiagram from '@site/src/components/SchedulerArchitectureDiagram';

# scheduler

## Cosa fa

`scheduler` centralizza la pianificazione dei job backend (cron giornalieri/settimanali/mensili), li esegue via HTTP verso altri microservizi e traccia lo stato di esecuzione.

## Ruoli e responsabilita

- lettura configurazione job da `datahub` (tabella `scheduler_jobs`);
- esecuzione job sincroni e asincroni con retry/backoff;
- pubblicazione eventi di lifecycle (`TASK.STARTED`, `TASK.COMPLETED`, `TASK.ERROR`) su Redis;
- persistenza stato ultima esecuzione (`last_run_at`, `last_status`) su Redis KV + datahub;
- firma token interni (`x-internal-token`) quando invoca endpoint `/internal/*`.

## Porta esposta

- Porta interna servizio: `3014`
- Esposizione via Traefik: `https://api.trading.expovin.it/scheduler/*`

## Architettura grafica

<SchedulerArchitectureDiagram />

## Autenticazione interna service-to-service

Quando un job punta a endpoint `/internal/*`, `scheduler` firma un token con chiave privata (`INTERNAL_JWT_PRIVATE_KEY`) e lo inoltra nel header `x-internal-token`.

Dettaglio completo del modello chiave privata/pubblica:

- [Autenticazione interna tra microservizi](./ms-authservice-autenticazione-interna.md)

## Configurazione (docker-compose.paper.yml)

```yaml
scheduler:
  image: expovin/scheduler:${SCHEDULER_VERSION}
  restart: unless-stopped
  depends_on:
    dbmanager:
      condition: service_healthy
  networks:
    - trading_net
  profiles: ["scheduler"]
  environment:
    - DBMANAGER_URL=${DBMANAGER_URL}
    - CACHEMANAGER_URL=${CACHEMANAGER_URL}
    - ALERTINGSERVICE_URL=${ALERTINGMANAGER_URL}
    - REDIS_URL=${REDIS_URL}
    - LOG_LEVEL=${LOG_LEVEL}
    - ENV=${ENV}
    - LOG_BATCH_MAX_BYTES=${LOG_BATCH_MAX_BYTES}
    - ENABLE_DB_LOG=${ENABLE_DB_LOG}
    - INTERNAL_JWT_PRIVATE_KEY=${INTERNAL_JWT_PRIVATE_KEY}
    - INTERNAL_JWT_PUBLIC_KEY=${INTERNAL_JWT_PUBLIC_KEY}
    - INTERNAL_JWT_ISS=${INTERNAL_JWT_ISS}
    - INTERNAL_JWT_EXP_SECONDS=${INTERNAL_JWT_EXP_SECONDS}
    - TZ=${TIMEZONE}
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3014/status/health"]
  labels:
    - "traefik.enable=true"
    - "traefik.http.routers.scheduler.rule=Host(`api.trading.expovin.it`) && PathPrefix(`/scheduler`)"
    - "traefik.http.services.scheduler.loadbalancer.server.port=3014"
    - "traefik.http.routers.scheduler.middlewares=scheduler-stripprefix,cors-default@docker,auth-forward@docker"
```

## Variabili d'ambiente

### Infrastruttura

Variabili obbligatorie gestite da `BaseService` (comune a tutti i microservizi).

| Variabile | Default | Descrizione |
|---|---|---|
| `DATAHUB_URL` | `http://datahub:3000` | URL del servizio `datahub` (ex `DBMANAGER_URL`, ancora accettato come alias). Usato per caricare i job dalla tabella `scheduler_jobs` e aggiornare `last_run_at`/`last_status`. |
| `CACHEMANAGER_URL` | `http://cachemanager:3006` | URL del `cachemanager`. Disponibile come variabile di contesto per i job che puntano a endpoint del cachemanager. |
| `ALERTINGSERVICE_URL` | `http://alertingservice:3008` | URL dell'`alertingservice`. Disponibile come variabile di contesto per i job che puntano a endpoint del servizio di alerting. |
| `REDIS_URL` | — | URI Redis (es. `redis://redis:6379`). Obbligatorio per il bus eventi, la pubblicazione degli eventi `TASK.*` e la persistenza `last_run` in KV. |
| `LOG_LEVEL` | `info` | Livello di log: `trace`, `debug`, `info`, `warning`, `error`. |
| `ENV` | `DEV` | Ambiente di esecuzione (`local`, `paper`, `prod`). Usato nel prefisso dei canali Redis. |
| `LOG_BATCH_MAX_BYTES` | — | Dimensione massima batch per il log su DB (funzionalità `dbLogger`). |
| `ENABLE_DB_LOG` | — | Se `true`, abilita la scrittura dei log su DB via `datahub`. |
| `TZ` | — | Timezone di sistema del container (es. `America/New_York`). |

### Autenticazione interna service-to-service

| Variabile | Default | Descrizione |
|---|---|---|
| `INTERNAL_JWT_PRIVATE_KEY` | — | Chiave privata RSA/EC usata per firmare i token `x-internal-token` quando un job invoca endpoint `/internal/*`. Obbligatoria se esistono job che puntano a endpoint interni. |
| `INTERNAL_JWT_PUBLIC_KEY` | — | Chiave pubblica RSA/EC corrispondente. Distribuita agli altri microservizi per la validazione del token. |
| `INTERNAL_JWT_ISS` | — | Issuer (`iss`) del token JWT interno. Il valore di default nel codice è `astraai-internal`. |
| `INTERNAL_JWT_EXP_SECONDS` | `60` | Durata in secondi del token interno. Il token ha TTL di 60 secondi per default. |

### Scheduling e timezone

| Variabile | Default | Descrizione |
|---|---|---|
| `SCHEDULER_TZ` | `Asia/Dubai` | Timezone di default applicata ai job che non specificano una timezone propria in `scheduler_jobs`. |

### URL microservizi (contesto job)

Le variabili seguenti definiscono gli URL base dei microservizi del sistema. Vengono usate indirettamente dallo scheduler come destinazione HTTP dei job configurati in `scheduler_jobs`.

| Variabile | Default | Descrizione |
|---|---|---|
| `MARKETSIMULATOR_URL` | `http://marketsimulator:3003` | URL del market simulator. |
| `ORDERSIMULATOR_URL` | `http://ordersimulator:3004` | URL dell'order simulator. |
| `ORDERLISTNER_URL` | `http://orderlistner:3005` | URL dell'order listener. |
| `STRATEGYUTILS_URL` | `http://strategyUtils:3007` | URL delle strategy utils. |
| `CAPITALMANAGER_URL` | `http://capitalmanager:3009` | URL del capital manager. |
| `SMA_URL` | `http://sma:3010` | URL del servizio SMA. |
| `SLTP_URL` | `http://sltp:3011` | URL del servizio SLTP. |
| `LIVEMARKETLISTNER_URL` | `http://livemarketlistner:3012` | URL del live market listener. |
| `TICKERSCANNER_URL` | `http://tickerscanner:3013` | URL del tickerscanner. Usato per i job che invocano `/internal/fundamentals/user-daily-scores`. |
| `SCHEDULER_URL` | `http://scheduler:3014` | URL dello scheduler stesso (auto-referenza). |

### FMP (Financial Modeling Prep)

Usato dallo scheduler per il controllo dell'apertura dei mercati (`openMarket: true` nei job).

| Variabile | Default | Descrizione |
|---|---|---|
| `FMP_API_KEY` | — | API key FMP. Richiesta dai job con `openMarket: true` per verificare lo stato del mercato prima dell'esecuzione. Se assente, il controllo viene saltato e il job viene comunque eseguito. |
| `FMP_BASE_URL` | `https://financialmodelingprep.com` | Base URL delle API FMP. Sovrascrivibile per ambienti di test o proxy interni. |

### Internals

| Variabile | Default | Descrizione |
|---|---|---|
| `PORT` | `3014` | Porta su cui il server REST è in ascolto. |
| `SCHEDULER_INIT_RETRY_MS` | `10000` | Intervallo in millisecondi tra un tentativo e il successivo di inizializzazione quando il `datahub` non è raggiungibile. |
| `MICROSERVICE_NAME` | `scheduler` | Nome del microservizio usato nei log e nei canali Redis. Sovrascrivibile per ambienti di debug. |

## Pagine dedicate

- [Architettura e flussi](./ms-scheduler-architettura.md)
- [Endpoint dettagliati](./ms-scheduler-endpoint.md)
- [Implementazione per file](./ms-scheduler-file-e-ruoli.md)
- [Configurazione](./ms-scheduler-configurazione.md)
- [Runbook](./ms-scheduler-runbook.md)
