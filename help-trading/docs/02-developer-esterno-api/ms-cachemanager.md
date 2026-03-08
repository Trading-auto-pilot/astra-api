---
sidebar_position: 12
---

import CacheManagerArchitectureDiagram from '@site/src/components/CacheManagerArchitectureDiagram';

# cachemanager

## Cosa fa

`cachemanager` e il servizio centralizzato per la cache storica dei dati di mercato.

Implementa una catena a 3 livelli:

- **L3 (Redis)** per hit veloci in memoria;
- **L2 (filesystem)** su volume persistente Docker (`/app/cache`);
- **L1 (provider esterni)** quando i dati non sono in cache.

## Ruoli e responsabilita

- espone endpoint interni usati dai microservizi per leggere/scrivere cache;
- gestisce provider esterni storici (`FMP`, `ALPACA`, `IBKR`);
- applica politiche di controllo dimensione cache su file e Redis;
- pubblica stato/eventi su Redis Bus.

## Porta esposta

- Porta interna servizio: `3006`
- Esposizione via Traefik: `https://api.trading.expovin.it/cachemanager/*`

## Architettura grafica

<CacheManagerArchitectureDiagram />

## Configurazione (docker-compose.paper.yml)

```yaml
cachemanager:
  image: expovin/cachemanager:${CACHEMANAGER_VERSION}
  restart: unless-stopped
  profiles: ["cachemanager"]
  environment:
    - DBMANAGER_URL=${DBMANAGER_URL}
    - REDIS_URL=${REDIS_URL}
    - IBKR_BRIDGE_URL=${IBKRBRIDGE_URL}
    - LOG_LEVEL=${LOG_LEVEL}
    - ENV=${ENV}
    - TZ=${TIMEZONE}
  depends_on:
    dbmanager:
      condition: service_healthy
    redis:
      condition: service_healthy
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3006/status/health"]
  labels:
    - "traefik.enable=true"
    - "traefik.http.routers.cachemanager.rule=Host(`api.trading.expovin.it`) && PathPrefix(`/cachemanager`)"
    - "traefik.http.services.cachemanager.loadbalancer.server.port=3006"
    - "traefik.http.routers.cachemanager.middlewares=cachemanager-stripprefix,cors-default@docker,auth-forward@docker"
```

Nota sulla persistenza:

- il filesystem cache L2 e montato con volume esterno al container: `cachemanager_data:/app/cache`;
- quindi i file cache sopravvivono ai restart/redeploy del microservizio.

## Variabili d'ambiente

### Infrastruttura

Variabili obbligatorie gestite dal core del servizio (pattern comune a tutti i microservizi).

| Variabile | Default | Descrizione |
|---|---|---|
| `DATAHUB_URL` | `http://datahub:3000` | URL del servizio `datahub` (ex `DBMANAGER_URL`, ancora accettato come alias). |
| `REDIS_URL` | — | URI Redis (es. `redis://redis:6379`). Obbligatorio per il bus eventi, i canali di stato e la cache L3. |
| `LOG_LEVEL` | `info` | Livello di log: `trace`, `debug`, `info`, `warning`, `error`. |
| `ENV` | `DEV` | Ambiente di esecuzione (`local`, `paper`, `prod`). Usato nel prefisso dei canali Redis. |
| `TZ` | — | Timezone di sistema del container (es. `America/New_York`). |
| `PORT` | `3006` | Porta su cui il server Express si mette in ascolto. |

### Connessione a ibkr-bridge

| Variabile | Default | Descrizione |
|---|---|---|
| `IBKRBRIDGE_URL` | `http://ibkr-bridge:3017` | URL del servizio `ibkr-bridge`. Alias accettato: `IBKR_BRIDGE_URL`. Usato quando `HISTORICAL_PROVIDER=IBKR` per le richieste di dati storici OHLCV. |
| `IBKR_EXCHANGE` | `NASDAQ` | Exchange di default usato per la risoluzione del `conid` (contract ID IBKR) quando si effettua una ricerca per simbolo. |

### Provider storico (L1)

Il provider storico viene selezionato tramite la variabile `HISTORICAL_PROVIDER`. Ogni provider ha le proprie credenziali.

| Variabile | Default | Descrizione |
|---|---|---|
| `HISTORICAL_PROVIDER` | `FMP` | Provider storico attivo per il fetch dei dati OHLCV da L1. Valori supportati: `FMP`, `ALPACA`, `IBKR`. |

#### FMP (Financial Modeling Prep)

| Variabile | Default | Descrizione |
|---|---|---|
| `FMP_API_KEY` | — | API key FMP. Obbligatoria quando `HISTORICAL_PROVIDER=FMP`. |

#### Alpaca

| Variabile | Default | Descrizione |
|---|---|---|
| `APCA_API_KEY_ID` | — | API key ID Alpaca. Obbligatoria quando `HISTORICAL_PROVIDER=ALPACA`. |
| `APCA_API_SECRET_KEY` | — | API secret Alpaca. Obbligatoria quando `HISTORICAL_PROVIDER=ALPACA`. |
| `ALPACA_MARKET_FEED` | `sip` | Feed dati Alpaca da utilizzare (`sip` per dati consolidati, `iex` per dati IEX). |
| `ALPACA_REST_URL` | `https://data.alpaca.markets` | Base URL delle API REST Alpaca. Sovrascrivibile per proxy interni o ambienti di test. |
| `ALPACA_TIMEOUT` | `10000` | Timeout in millisecondi per le chiamate REST ad Alpaca. |

### Cache L3 (Redis)

| Variabile | Default | Descrizione |
|---|---|---|
| `L3_USAGE_ALERT_PERCENT` | `95` | Soglia percentuale di utilizzo della memoria Redis oltre la quale viene emesso un evento di alert `CACHE.L3.THRESHOLD.REACHED`. |

### Server HTTP

| Variabile | Default | Descrizione |
|---|---|---|
| `BODY_LIMIT` | `20mb` | Dimensione massima del body accettata dal parser Express (`express.json`). |

## Pagine dedicate

- [Architettura e flussi cache](./ms-cachemanager-architettura.md)
- [Endpoint dettagliati](./ms-cachemanager-endpoint.md)
- [Implementazione per file](./ms-cachemanager-file-e-ruoli.md)
- [Configurazione](./ms-cachemanager-configurazione.md)
- [Runbook operativo](./ms-cachemanager-runbook.md)
- [Limiti cache (file + memory)](./ms-cachemanager-limiti-cache.md)
