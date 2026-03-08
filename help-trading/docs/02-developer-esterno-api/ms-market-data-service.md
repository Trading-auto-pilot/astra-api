---
sidebar_position: 14
---

import MarketDataServiceArchitectureDiagram from '@site/src/components/MarketDataServiceArchitectureDiagram';

# market-data-service

## Cosa fa

`market-data-service` gestisce lo stream market data da IBKR Gateway, pubblica eventi su Redis e offre API di controllo sottoscrizioni/loop snapshot.

## Ruoli e responsabilita

- connessione WebSocket a IBKR Gateway (`/v1/api/ws`);
- gestione subscribe/unsubscribe ticker e campi market data;
- pubblicazione dati normalizzati sul canale Redis data;
- ciclo snapshot periodico via `ibkr-bridge`.

## Porta esposta

- Porta interna servizio: `3020`
- Esposizione via Traefik: `https://api.trading.expovin.it/market-data-service/*`

## Architettura grafica

<MarketDataServiceArchitectureDiagram />

Il diagramma evidenzia che:

- `decision-engine` invoca `market-data-service` per gestire le sottoscrizioni live;
- `market-data-service` dialoga con `IBKR Gateway` (WS) e `ibkr-bridge` (snapshot HTTP);
- i dati live/snapshot vengono pubblicati su Redis Bus (`*.market-data-service.data`);
- settings e log persistenti passano da `datahub`.

## Configurazione (docker-compose.paper.yml)

```yaml
market-data-service:
  image: expovin/market-data-service:${MARKETDATASERVICE_VERSION}
  restart: unless-stopped
  profiles: ["market-data-service"]
  environment:
    - DBMANAGER_URL=${DBMANAGER_URL}
    - REDIS_URL=${REDIS_URL}
    - IBKRGW_BASE_URL=${IBKRGW_BASE_URL}
    - IBKR_BRIDGE_URL=${IBKR_BRIDGE_URL}
    - ENV=${ENV}
    - TZ=${TIMEZONE}
  depends_on:
    dbmanager:
      condition: service_healthy
    redis:
      condition: service_healthy
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3020/status/health"]
  labels:
    - "traefik.enable=true"
    - "traefik.http.routers.market-data-service.rule=Host(`api.trading.expovin.it`) && PathPrefix(`/market-data-service`)"
    - "traefik.http.services.market-data-service.loadbalancer.server.port=3020"
    - "traefik.http.routers.market-data-service.middlewares=market-data-service-stripprefix,cors-default@docker,auth-forward@docker"
```

## Variabili d'ambiente

### Infrastruttura

Variabili obbligatorie gestite da `BaseService` (comune a tutti i microservizi).

| Variabile | Default | Descrizione |
|---|---|---|
| `DATAHUB_URL` | `http://datahub:3000` | URL del servizio `datahub` (ex `DBMANAGER_URL`, ancora accettato come alias). |
| `REDIS_URL` | `redis://redis:6379` | URI Redis. Usato sia dal bus eventi che dall'adattatore interno per persistere le configurazioni (tickers, fields, snapshot interval). |
| `LOG_LEVEL` | `info` | Livello di log: `trace`, `debug`, `info`, `warning`, `error`. |
| `ENV` | — | Ambiente di esecuzione (`local`, `paper`, `prod`). Usato nel prefisso dei canali Redis. |
| `LOG_BATCH_MAX_BYTES` | — | Dimensione massima batch per il log su DB (funzionalita `dbLogger`). |
| `ENABLE_DB_LOG` | — | Se `true`, abilita la scrittura dei log su DB via `datahub`. |
| `TZ` | — | Timezone di sistema del container (es. `America/New_York`). |

### IBKR Gateway

| Variabile | Default | Descrizione |
|---|---|---|
| `IBKRGW_BASE_URL` | — | URL base del IBKR Client Portal Gateway (es. `https://localhost:5000` o `tcp://ibkr-gw:5000`). Obbligatoria: senza questo valore il modulo non si avvia. Alias accettato: `IBKR_BASE_URL`. |
| `IBKR_INSECURE_TLS` | — | Se `true`, disabilita la verifica del certificato TLS nella connessione WebSocket e nelle chiamate HTTP verso il Gateway. Utile in ambienti locali con certificato self-signed. |

### IBKR Bridge

| Variabile | Default | Descrizione |
|---|---|---|
| `IBKR_BRIDGE_URL` | `http://ibkr-bridge:3017` | URL del servizio `ibkr-bridge`, usato per la risoluzione dei `conid` (tramite `/mirror/iserver/secdef/search`) e per il fetch degli snapshot periodici (`/mirror/iserver/marketdata/snapshot`). Alias accettato: `IBKRBRIDGE_URL`. |

### Market data e sottoscrizioni

| Variabile | Default | Descrizione |
|---|---|---|
| `MARKET_DATA_FIELDS` | `31,84,86` | Lista CSV dei campi market data IBKR da richiedere per ogni ticker sottoscritto. Il valore viene usato sia alla connessione WebSocket che nel ciclo snapshot. Sovrascrivibile anche via Redis (chiave `MARKET_DATA:FIELDS`). |

## Pagine dedicate

- [Architettura e flussi](./ms-market-data-service-architettura.md)
- [Endpoint dettagliati](./ms-market-data-service-endpoint.md)
- [Implementazione per file](./ms-market-data-service-file-e-ruoli.md)
- [Configurazione](./ms-market-data-service-configurazione.md)
- [Runbook operativo](./ms-market-data-service-runbook.md)
