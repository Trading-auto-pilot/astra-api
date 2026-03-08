---
sidebar_position: 40
---

import BrokerExecutorIbkrArchitectureDiagram from '@site/src/components/BrokerExecutorIbkrArchitectureDiagram';

# broker-executor-ibkr

## Cosa fa

`broker-executor-ibkr` espone API di esecuzione ordini verso IBKR (bracket order lifecycle) e sincronizza stato ordini/posizioni tramite listener websocket.

## Ruoli e responsabilita

- crea/modifica/cancella ordini bracket su IBKR;
- gestisce idempotenza di creazione ordine con `externalCorrelationId`;
- mantiene stato ordini tramite riconciliazione periodica + feed live websocket;
- espone endpoint di lettura ordini, posizioni e stato WS.

## Porta esposta

- Porta interna servizio: `3003`
- Esposizione via Traefik (local profile): `http://localhost/broker-executor-ibkr/*`

## Architettura grafica

<BrokerExecutorIbkrArchitectureDiagram />

## Configurazione compose

Nel repository attuale il servizio e definito in `docker-compose.local.yml` (non in `docker-compose.paper.yml`).

```yaml
broker-executor-ibkr:
  image: local/broker-executor-ibkr:${BROKER_EXECUTOR_IBKR_VERSION:-latest}
  ports:
    - "3003:3003"
  profiles: ["broker-executor-ibkr"]
  environment:
    - DATAHUB_URL=http://datahub:3000
    - REDIS_URL=redis://redis:6379
    - IBKRBRIDGE_URL=http://ibkr-bridge:3017
    - IBKRGW_BASE_URL=https://ibkrgw-paper:5000
    - IBKR_WS_URL=wss://ibkrgw-paper:5000/v1/api/ws
    - IBKR_INSECURE_TLS=true
    - IBKR_EXECUTOR_USE_BRIDGE=true
    - TZ=${TIMEZONE}
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3003/status/health"]
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

### Connessione al gateway IBKR

| Variabile | Default | Descrizione |
|---|---|---|
| `IBKRBRIDGE_URL` | — | URL del servizio `ibkr-bridge`. Quando `IBKR_EXECUTOR_USE_BRIDGE=true` (default), tutte le chiamate REST verso IBKR passano per questo bridge. |
| `IBKR_EXECUTOR_USE_BRIDGE` | `true` | Se `true`, le richieste REST usano `ibkr-bridge` come proxy; se `false`, si connette direttamente al gateway IBKR. |
| `IBKRGW_BASE_URL` | `http://ibkrgw-paper:5000` | URL base del gateway IBKR (usato solo se `IBKR_EXECUTOR_USE_BRIDGE=false`, oppure come alias `IBKR_BASE_URL`). |
| `IBKR_INSECURE_TLS` | `false` | Se `true`, disabilita la verifica del certificato TLS nelle connessioni HTTPS al gateway IBKR. Utile in ambienti di test con certificati auto-firmati. |
| `IBKR_REQUEST_TIMEOUT_MS` | `20000` | Timeout in millisecondi per le chiamate REST verso il gateway IBKR. |
| `IBKR_AUTO_REPLY_CONFIRM` | `true` | Se `true`, conferma automaticamente i dialoghi di conferma IBKR (`/iserver/reply/{id}`) durante la creazione degli ordini. |

### WebSocket IBKR (feed live ordini)

| Variabile | Default | Descrizione |
|---|---|---|
| `IBKR_WS_URL` | `wss://ibkrgw-paper:5000/v1/api/ws` | URL WebSocket del gateway IBKR per il feed live degli ordini. Alias accettato: `IBKRGW_WS_URL`. |
| `IBKR_WS_RECONNECT_MIN_MS` | `1000` | Ritardo minimo (ms) prima di tentare una riconnessione WebSocket dopo una disconnessione. |
| `IBKR_WS_RECONNECT_MAX_MS` | `30000` | Ritardo massimo (ms) per la riconnessione WebSocket (backoff esponenziale con cap). |
| `IBKR_WS_HEARTBEAT_MS` | `25000` | Intervallo (ms) di invio heartbeat sul WebSocket per mantenere la connessione attiva. |
| `IBKR_WS_INSECURE_TLS` | — | Override specifico per il WebSocket. Se non impostato, eredita il valore di `IBKR_INSECURE_TLS`. |
| `IBKR_WS_RECONCILE_POLL_MS` | `60000` | Intervallo (ms) di riconciliazione periodica degli ordini tramite REST, in parallelo al feed WebSocket. |

### Account e ordini

| Variabile | Default | Descrizione |
|---|---|---|
| `IBKR_ACCOUNT_ID` | — | ID account IBKR. Se non impostato, il servizio lo risolve automaticamente chiamando `/iserver/accounts` al primo utilizzo. Obbligatorio in produzione per evitare ambiguità su account multipli. |
| `IBKR_IDEMPOTENCY_HOURS` | `6` | Durata in ore della cache in-memory per l'idempotenza della creazione ordini (basata su `externalCorrelationId`). |
| `IBKR_POSITIONS_REFRESH_DEBOUNCE_MS` | `3000` | Debounce in millisecondi per l'aggiornamento delle posizioni: evita refresh multipli ravvicinati a seguito di eventi live. |

### Autenticazione interna (token service-to-service)

| Variabile | Default | Descrizione |
|---|---|---|
| `INTERNAL_JWT_PUBLIC_KEY` | — | Chiave pubblica RSA/EC per validare i token service-to-service (`x-internal-token`). Obbligatoria per gli endpoint interni protetti. |
| `INTERNAL_JWT_ISSUER` | `astraai-internal` | Issuer atteso nel token JWT interno. |
| `INTERNAL_JWT_AUDIENCE` | — | Audience attesa nel token JWT interno. Se vuota, il controllo viene saltato. |
| `INTERNAL_JWT_SCOPE` | — | Scope atteso nel token JWT interno. Se vuoto, il controllo viene saltato. |

## Pagine dedicate

- [Architettura e flussi](./ms-brokerexecutor-ibkr-architettura.md)
- [Endpoint dettagliati](./ms-brokerexecutor-ibkr-endpoint.md)
- [Implementazione per file](./ms-brokerexecutor-ibkr-file-e-ruoli.md)
- [Configurazione](./ms-brokerexecutor-ibkr-configurazione.md)
- [Runbook operativo](./ms-brokerexecutor-ibkr-runbook.md)
