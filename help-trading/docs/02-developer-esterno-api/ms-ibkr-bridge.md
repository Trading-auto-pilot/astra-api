---
sidebar_position: 16
---

import IbkrBridgeArchitectureDiagram from '@site/src/components/IbkrBridgeArchitectureDiagram';

# ibkr-bridge

## Cosa fa

`ibkr-bridge` e il layer di integrazione backend verso IBKR Gateway, con API mirror e controllo continuo dello stato auth/sessione.

## Ruoli e responsabilita

- proxy controllato verso endpoint IBKR (`/mirror/*`);
- endpoint applicativi semplificati (`/accounts`, `/account`);
- loop di connettivita (`auth status`, `tickle`, `ssodh init`);
- pubblicazione telemetria su Redis bus.

## Porta esposta

- Porta interna servizio: `3017`
- Esposizione via Traefik: `https://api.trading.expovin.it/ibkr-bridge/*`

## Architettura grafica

<IbkrBridgeArchitectureDiagram />

## Configurazione (docker-compose.paper.yml)

```yaml
ibkr-bridge:
  image: expovin/ibkr-bridge:${IBKRBRIDGE_VERSION}
  restart: unless-stopped
  profiles: ["ibkr-bridge"]
  environment:
    - DBMANAGER_URL=${DBMANAGER_URL}
    - REDIS_URL=${REDIS_URL}
    - IBKRGW_BASE_URL=${IBKRGW_BASE_URL}
    - IBKR_INSECURE_TLS=${IBKR_INSECURE_TLS}
    - TICKLE_INTERVAL_MS=${TICKLE_INTERVAL_MS}
    - AUTH_CHECK_INTERVAL_MS=${AUTH_CHECK_INTERVAL_MS}
    - ENV=${ENV}
    - TZ=${TIMEZONE}
  depends_on:
    dbmanager:
      condition: service_healthy
    redis:
      condition: service_healthy
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3017/status/health"]
  labels:
    - "traefik.enable=true"
    - "traefik.http.routers.ibkr-bridge.rule=Host(`api.trading.expovin.it`) && PathPrefix(`/ibkr-bridge`)"
    - "traefik.http.services.ibkr-bridge.loadbalancer.server.port=3017"
    - "traefik.http.routers.ibkr-bridge.middlewares=ibkr-bridge-stripprefix,cors-default@docker,auth-forward@docker"
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
| `TZ` | — | Timezone di sistema del container (es. `America/New_York`). |

### IBKR Gateway

Variabili specifiche per la connessione e il mantenimento della sessione con IBKR Gateway. Tutte le variabili con prefisso `IBKR` possono essere sovrascritte a runtime anche tramite i settings dinamici caricati dal DB.

| Variabile | Default | Descrizione |
|---|---|---|
| `IBKRGW_BASE_URL` | — | URL base del Gateway IBKR (es. `https://localhost:5000`). Obbligatorio per il corretto funzionamento del bridge. Alias: `IBKR_BASE_URL`. |
| `IBKRGW_SSO_URL` | `http://ibkrgw-paper:5000/sso/Dispatcher?hardware_info=...` | URL del dispatcher SSO di IBKR. Usato per il re-auth automatico in caso di risposta `401`. |
| `IBKR_INSECURE_TLS` | `false` | Se `true`, disabilita la verifica del certificato TLS verso il Gateway. Necessario in ambienti locali con certificati self-signed. |
| `IBKR_REQUEST_TIMEOUT_MS` | `20000` | Timeout in millisecondi per ogni richiesta HTTP verso IBKR Gateway. |

### Loop di connettivita

Variabili che controllano la frequenza dei controlli periodici di autenticazione e degli heartbeat verso il Gateway. Possono essere sovrascritte tramite settings dinamici.

| Variabile | Default | Descrizione |
|---|---|---|
| `TICKLE_INTERVAL_MS` | `50000` | Intervallo in millisecondi tra un `POST /v1/api/tickle` e il successivo. Il tickle mantiene attiva la sessione IBKR. |
| `AUTH_CHECK_INTERVAL_MS` | `15000` | Intervallo in millisecondi tra un controllo `GET /v1/api/iserver/auth/status` e il successivo. Definisce anche la frequenza del loop principale di connettivita. |
| `IBKR_SSODH_INIT_INTERVAL_MS` | `60000` | Intervallo in millisecondi tra una chiamata `POST /v1/api/iserver/auth/ssodh/init` e la successiva. Impostare a `0` per disabilitare. |

## Pagine dedicate

- [Architettura e flussi](./ms-ibkr-bridge-architettura.md)
- [Endpoint dettagliati](./ms-ibkr-bridge-endpoint.md)
- [Implementazione per file](./ms-ibkr-bridge-file-e-ruoli.md)
- [Configurazione](./ms-ibkr-bridge-configurazione.md)
- [Runbook operativo](./ms-ibkr-bridge-runbook.md)
