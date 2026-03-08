---
sidebar_position: 15
---

import RedisWsBridgeArchitectureDiagram from '@site/src/components/RedisWsBridgeArchitectureDiagram';

# redis-ws-bridge

## Cosa fa

`redis-ws-bridge` espone un endpoint WebSocket pubblico e inoltra ai client i messaggi provenienti dai canali/pattern Redis.

## Ruoli e responsabilita

- sottoscrive pattern Redis via `psubscribe`;
- applica filtri/aggregazioni per client (`topics`, `symbols`, `types`, `aggregate`, `rateMs`);
- invia stream realtime ai client connessi su `/ws`;
- fornisce endpoint status/monitoring del bridge e del bus.

## Porta esposta

- Porta interna servizio: `3030`
- Esposizione via Traefik: `https://api.trading.expovin.it/redis-ws-bridge/*`

## Architettura grafica

<RedisWsBridgeArchitectureDiagram />

## Configurazione (docker-compose.paper.yml)

```yaml
redis-ws-bridge:
  image: expovin/redis-ws-bridge:${REDISWSBRIDGE_VERSION}
  restart: unless-stopped
  profiles: ["redis-ws-bridge"]
  environment:
    - REDIS_URL=${REDIS_URL}
    - REDIS_PATTERNS=${REDIS_PATTERNS}
    - DBMANAGER_URL=${DBMANAGER_URL}
    - ENV=${ENV}
    - TZ=${TIMEZONE}
  depends_on:
    redis:
      condition: service_healthy
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3030/status/health"]
  labels:
    - "traefik.enable=true"
    - "traefik.http.routers.redis-ws-bridge.rule=Host(`api.trading.expovin.it`) && PathPrefix(`/redis-ws-bridge`)"
    - "traefik.http.services.redis-ws-bridge.loadbalancer.server.port=3030"
    - "traefik.http.routers.redis-ws-bridge-ws.rule=Host(`api.trading.expovin.it`) && PathPrefix(`/redis-ws-bridge/ws`)"
```

## Variabili d'ambiente

### Infrastruttura

Variabili obbligatorie gestite da `BaseService` (comune a tutti i microservizi).

| Variabile | Default | Descrizione |
|---|---|---|
| `DATAHUB_URL` | `http://datahub:3000` | URL del servizio `datahub` (ex `DBMANAGER_URL`, ancora accettato come alias). Usato per il fetch dei settings. |
| `REDIS_URL` | `redis://localhost:6379/0` | URI Redis (es. `redis://redis:6379`). Obbligatorio per il bus eventi e la sottoscrizione ai pattern. |
| `ENV` | `DEV` | Ambiente di esecuzione (`local`, `paper`, `prod`). Usato nel prefisso dei canali Redis. |
| `LOG_LEVEL` | `info` | Livello di log: `trace`, `debug`, `info`, `warning`, `error`. |
| `TZ` | — | Timezone di sistema del container (es. `America/New_York`). |

### WebSocket e CORS

| Variabile | Default | Descrizione |
|---|---|---|
| `PORT` | `3030` | Porta su cui il server HTTP/WebSocket è in ascolto. |
| `CORS_ORIGIN` | `http://localhost:5173` | Origin o lista di origin separati da virgola autorizzati dal CORS. In produzione viene gestito da Traefik. |

### Redis pattern subscription

| Variabile | Default | Descrizione |
|---|---|---|
| `REDIS_PATTERNS` | `*` | Lista di pattern Redis separati da virgola su cui il bridge effettua `psubscribe`. Ogni messaggio che corrisponde viene inoltrato ai client WebSocket connessi. |

### Internals

| Variabile | Default | Descrizione |
|---|---|---|
| `MAX_RETRY_DELAY` | `60000` | Intervallo massimo in millisecondi applicabile ai canali di comunicazione via `PUT /status/communicationChannels`. Valori superiori vengono silenziosi clampati a questo limite. |

## Pagine dedicate

- [Architettura e flussi](./ms-redis-ws-bridge-architettura.md)
- [Endpoint dettagliati](./ms-redis-ws-bridge-endpoint.md)
- [Implementazione per file](./ms-redis-ws-bridge-file-e-ruoli.md)
- [Configurazione](./ms-redis-ws-bridge-configurazione.md)
- [Runbook operativo](./ms-redis-ws-bridge-runbook.md)
