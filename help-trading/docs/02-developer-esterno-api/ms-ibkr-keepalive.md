---
sidebar_position: 17
---

# ibkr-keepalive

## Cosa fa

Mantiene attiva la sessione verso IBKR Gateway con heartbeat e verifiche periodiche.

## Ruoli e responsabilita

- keepalive e controllo sessione gateway;
- monitoraggio timeout/request state;
- disponibilita endpoint operativi per stato connettivita.

## Porta esposta

- Porta interna servizio: `3019`
- Esposizione via Traefik: `https://api.trading.expovin.it/ibkr-keepalive/*`

## Configurazione (docker-compose.paper.yml)

```yaml
ibkr-keepalive:
  image: expovin/ibkr-keepalive:${IBKRKEEPALIVE_VERSION}
  container_name: ibkr-keepalive
  network_mode: "service:ibkrgw-paper"
  depends_on:
    - ibkrgw-paper
  environment:
    - IBKR_BASE_URL=${IBKRGW_BASE_URL}
    - CORS_ORIGIN=${CORS_ORIGIN}
    - KEEPALIVE_INTERVAL_MS=45000
    - REQUEST_TIMEOUT_MS=8000
    - ENV=${ENV}
  labels:
    - "traefik.enable=true"
    - "traefik.http.routers.ibkr-keepalive.rule=Host(`api.trading.expovin.it`) && PathPrefix(`/ibkr-keepalive`)"
    - "traefik.http.services.ibkr-keepalive.loadbalancer.server.port=3019"
    - "traefik.http.routers.ibkr-keepalive.middlewares=ibkr-keepalive-stripprefix,cors-default@docker,auth-forward@docker"
```

## Variabili d'ambiente

### Infrastruttura

Variabili di base gestite dal modulo principale (comune a tutti i microservizi).

| Variabile | Default | Descrizione |
|---|---|---|
| `DATAHUB_URL` | `http://datahub:3000` | URL del servizio `datahub` (ex `DBMANAGER_URL`, ancora accettato come alias). |
| `REDIS_URL` | — | URI Redis (es. `redis://redis:6379`). Obbligatorio per il bus eventi e i canali di stato. |
| `LOG_LEVEL` | `info` | Livello di log: `trace`, `debug`, `info`, `warning`, `error`. |
| `ENV` | `DEV` | Ambiente di esecuzione (`local`, `paper`, `prod`). Usato nel prefisso dei canali Redis. |
| `PORT` | `3019` | Porta su cui il server Express rimane in ascolto. |
| `CORS_ORIGIN` | `http://localhost:5173` | Origin o lista di origin (separate da virgola) autorizzate dalle policy CORS. |

### IBKR Gateway

Variabili specifiche per la connessione e il mantenimento della sessione con IBKR Gateway. Tutte le variabili con prefisso `IBKR` possono essere sovrascritte a runtime anche tramite i settings dinamici caricati dal DB.

| Variabile | Default | Descrizione |
|---|---|---|
| `IBKRGW_BASE_URL` | `https://localhost:5000` | URL base del Gateway IBKR. Obbligatorio per il funzionamento del loop di keepalive. Alias: `IBKR_BASE_URL`. |
| `IBKRGW_SSO_URL` | `https://localhost:5000/sso/Dispatcher?hardware_info=...` | URL del dispatcher SSO di IBKR. Usato per il re-auth automatico in caso di risposta `401`. |
| `IBKR_INSECURE_TLS` | `false` | Se `true`, disabilita la verifica del certificato TLS verso il Gateway. Necessario in ambienti locali con certificati self-signed. |

### Loop di keepalive

Variabili che controllano la frequenza dei controlli periodici di autenticazione e degli heartbeat verso il Gateway. Possono essere sovrascritte tramite settings dinamici.

| Variabile | Default | Descrizione |
|---|---|---|
| `TICKLE_INTERVAL_MS` | `50000` | Intervallo in millisecondi tra un `POST /v1/api/tickle` e il successivo. Il tickle mantiene attiva la sessione IBKR. |
| `AUTH_CHECK_INTERVAL_MS` | `60000` | Intervallo in millisecondi tra un controllo `GET /v1/api/iserver/auth/status` e il successivo. Definisce anche la frequenza del loop principale di keepalive. |

## Pagine dedicate

- [Architettura e flussi](./ms-ibkr-keepalive-architettura.md)
- [Endpoint dettagliati](./ms-ibkr-keepalive-endpoint.md)
- [Implementazione per file](./ms-ibkr-keepalive-file-e-ruoli.md)
- [Configurazione](./ms-ibkr-keepalive-configurazione.md)
- [Runbook operativo](./ms-ibkr-keepalive-runbook.md)

