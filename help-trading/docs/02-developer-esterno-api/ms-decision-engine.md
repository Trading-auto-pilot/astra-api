---
sidebar_position: 13
---

import DecisionEngineArchitectureDiagram from '@site/src/components/DecisionEngineArchitectureDiagram';

# decision-engine

## Cosa fa

`decision-engine` calcola segnali operativi (spot-finder), gestisce job asincroni e funzioni live su ticker filtrati.

## Ruoli e responsabilita

- calcolo segnali per singolo ticker e per pipeline (`pipeId`);
- gestione snapshot risultati e stato job;
- integrazione con `cachemanager` (candles), `tickerScanner` (ticker utente), `market-data-service` (live subscriptions);
- integrazione con `datahub` per settings e log persistenti.

## Porta esposta

- Porta interna servizio: `3018`
- Esposizione via Traefik: `https://api.trading.expovin.it/decision-engine/*`

## Architettura grafica

<DecisionEngineArchitectureDiagram />

Il diagramma evidenzia che:

- `decision-engine` legge configurazioni da `datahub` (via `DATAHUB_URL`/`DBMANAGER_URL`);
- i log applicativi vengono scritti su `datahub` (`/logs`) tramite logger shared;
- lo `scheduler` puo invocare endpoint interni `/internal/spot-finder/*` con token interno;
- i risultati runtime vengono salvati in Redis (snapshot/job state).

## Configurazione (docker-compose.paper.yml)

```yaml
decision-engine:
  image: expovin/decision-engine:${DECISIONENGINE_VERSION}
  restart: unless-stopped
  profiles: ["decision-engine"]
  environment:
    - DBMANAGER_URL=${DBMANAGER_URL}
    - CACHEMANAGER_URL=${CACHEMANAGER_URL}
    - MARKETDATASERVICE_URL=${MARKETDATASERVICE_URL}
    - REDIS_URL=${REDIS_URL}
    - INTERNAL_JWT_PUBLIC_KEY=${INTERNAL_JWT_PUBLIC_KEY}
    - ENV=${ENV}
    - TZ=${TIMEZONE}
  depends_on:
    dbmanager:
      condition: service_healthy
    redis:
      condition: service_healthy
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3018/status/health"]
  labels:
    - "traefik.enable=true"
    - "traefik.http.routers.decision-engine.rule=Host(`api.trading.expovin.it`) && PathPrefix(`/decision-engine`)"
    - "traefik.http.services.decision-engine.loadbalancer.server.port=3018"
    - "traefik.http.routers.decision-engine.middlewares=decision-engine-stripprefix,cors-default@docker,auth-forward@docker"
```

## Variabili d'ambiente

### Infrastruttura

Variabili obbligatorie gestite dalla classe principale del modulo (comuni a tutti i microservizi).

| Variabile | Default | Descrizione |
|---|---|---|
| `DATAHUB_URL` | `http://datahub:3000` | URL del servizio `datahub` (preferito). Ancora accettato `DBMANAGER_URL` come alias per compatibilita retroattiva. |
| `DBMANAGER_URL` | `http://datahub:3000` | Alias legacy di `DATAHUB_URL`, letto come fallback. |
| `REDIS_URL` | — | URI Redis (es. `redis://redis:6379`). Obbligatorio per il bus eventi, i canali di stato e la persistenza degli snapshot job. |
| `LOG_LEVEL` | `info` | Livello di log: `trace`, `debug`, `info`, `warning`, `error`. |
| `ENV` | `DEV` | Ambiente di esecuzione (`local`, `paper`, `prod`). Usato come prefisso nei canali Redis e nel nome degli eventi. |
| `TZ` | — | Timezone di sistema del container (es. `America/New_York`). |
| `PORT` | `3018` | Porta su cui il server HTTP si mette in ascolto. |
| `CORS_ORIGIN` | `http://localhost:5173` | Origin o lista di origin (CSV) consentite dal middleware CORS. |
| `INTERNAL_JWT_PUBLIC_KEY` | — | Chiave pubblica RSA/EC per validare i token service-to-service (`x-internal-token`). Obbligatoria per gli endpoint interni `/internal/spot-finder/*`. |

### URL microservizi dipendenti

Variabili per configurare i URL dei servizi chiamati dal `decision-engine`. Non e necessario impostarle se si usano i default interni Docker Compose.

| Variabile | Default | Descrizione |
|---|---|---|
| `CACHEMANAGER_URL` | `http://cachemanager:3006` | URL del `cachemanager`, usato per il fetch dei candles storici usati dal calcolo segnali. |
| `AUTHSERVICE_URL` | `http://authService:3015` | URL dell'`authservice`, usato per risolvere l'utente da token/API key nelle route protette. |
| `TICKERSCANNER_URL` | `http://tickerscanner:3013` | URL del `tickerscanner`, usato per recuperare la lista di ticker dell'utente nelle pipeline. |
| `MARKETDATASERVICE_URL` | `http://market-data-service:3020` | URL del `market-data-service`, usato per le sottoscrizioni live ai dati di mercato. |
| `DECISIONENGINE_URL` | `http://decision-engine:3018` | URL self-referenziale del `decision-engine`, usato per alcune chiamate interne. |
| `ALERTINGSERVICE_URL` | `http://alertingservice:3008` | URL dell'`alertingservice`, usato per l'invio di alert operativi. |

### Timeout chiamate esterne

Le seguenti variabili controllano i timeout verso i servizi esterni. Non e necessario aggiungerle al `docker-compose` se si accettano i valori di default.

| Variabile | Default | Descrizione |
|---|---|---|
| `CACHEMANAGER_TIMEOUT_MS` | `60000` | Timeout in ms per le chiamate al `cachemanager` (fetch candles). Valore alto perche il payload puo essere voluminoso. |
| `TICKERSCANNER_TIMEOUT_MS` | `20000` | Timeout in ms per le chiamate al `tickerscanner` (fetch ticker utente). |

### Modalita live

| Variabile | Default | Descrizione |
|---|---|---|
| `LIVE_RECALC_INTERVAL_MS` | `60000` | Intervallo minimo in ms tra due ricalcoli successivi dello stesso ticker in modalita live. Evita ricalcoli troppo frequenti a parita di tick ricevuti. |

## Pagine dedicate

- [Architettura e flussi](./ms-decision-engine-architettura.md)
- [Endpoint dettagliati](./ms-decision-engine-endpoint.md)
- [Implementazione per file](./ms-decision-engine-file-e-ruoli.md)
- [Configurazione](./ms-decision-engine-configurazione.md)
- [Runbook operativo](./ms-decision-engine-runbook.md)
