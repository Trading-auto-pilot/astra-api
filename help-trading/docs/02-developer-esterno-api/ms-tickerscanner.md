---
sidebar_position: 20
---

import TickerScannerArchitectureDiagram from '@site/src/components/TickerScannerArchitectureDiagram';

# tickerscanner

## Cosa fa

`tickerscanner` esegue lo scanning dell'universo titoli, calcola score fondamentali/momentum e gestisce job asincroni per aggiornamenti `market_daily` e `user_daily_scores`.

## Ruoli e responsabilita

- orchestrazione pipeline `screener -> fundamentals -> scoring`;
- gestione job async di scan e refresh momentum;
- gestione job `market_daily` e `user_daily_scores`;
- calcolo ranking giornaliero di sistema per bucket (`AST_RANKING_DAILY` — Fase 4);
- persistenza risultati e storico job su `datahub`;
- integrazione con `authservice` per identificare utente da token/API key;
- supporto endpoint interni protetti con token service-to-service.

## Porta esposta

- Porta interna servizio: `3013`
- Esposizione via Traefik: `https://api.trading.expovin.it/tickerscanner/*`

## Architettura grafica

<TickerScannerArchitectureDiagram />

## Autenticazione interna

`tickerscanner` espone endpoint interno `POST /internal/fundamentals/user-daily-scores` e valida `x-internal-token` (issuer/audience) per chiamate da scheduler.

Dettagli completi sul meccanismo chiave privata/pubblica:

- [Autenticazione interna tra microservizi](./ms-authservice-autenticazione-interna.md)

## Configurazione (docker-compose.paper.yml)

```yaml
tickerscanner:
  image: expovin/tickerscanner:${TICKERSCANNER_VERSION}
  restart: unless-stopped
  environment:
    - DBMANAGER_URL=${DBMANAGER_URL}
    - CACHEMANAGER_URL=${CACHEMANAGER_URL}
    - ALERTINGSERVICE_URL=${ALERTINGMANAGER_URL}
    - REDIS_URL=${REDIS_URL}
    - LOG_LEVEL=${LOG_LEVEL}
    - ENV=${ENV}
    - LOG_BATCH_MAX_BYTES=${LOG_BATCH_MAX_BYTES}
    - ENABLE_DB_LOG=${ENABLE_DB_LOG}
    - FMP_API_KEY=${FMP_API_KEY}
    - INTERNAL_JWT_PUBLIC_KEY=${INTERNAL_JWT_PUBLIC_KEY}
    - DEFAULT_JOB_TIMEZONE=America/New_York
    - SCHEDULER_TIMEZONE=America/New_York
    - TZ=${TIMEZONE}
  depends_on:
    dbmanager:
      condition: service_healthy
  profiles: ["tickerscanner"]
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3013/status/health"]
  labels:
    - "traefik.enable=true"
    - "traefik.http.routers.tickerscanner.rule=Host(`api.trading.expovin.it`) && PathPrefix(`/tickerscanner`)"
    - "traefik.http.services.tickerscanner.loadbalancer.server.port=3013"
    - "traefik.http.routers.tickerscanner.middlewares=tickerscanner-stripprefix,cors-default@docker,auth-forward@docker"
```

## Variabili d'ambiente

### Infrastruttura

Variabili obbligatorie gestite da `BaseService` (comune a tutti i microservizi).

| Variabile | Default | Descrizione |
|---|---|---|
| `DATAHUB_URL` | `http://datahub:3000` | URL del servizio `datahub` (ex `DBMANAGER_URL`, ancora accettato come alias). |
| `CACHEMANAGER_URL` | `http://cachemanager:3006` | URL del `cachemanager`, usato dal `MomentumCalculator` per il fetch dei candles storici. |
| `AUTHSERVICE_URL` | `http://authservice:3015` | URL dell'`authservice`, usato dalle route per risolvere l'utente da token/API key. |
| `REDIS_URL` | — | URI Redis (es. `redis://redis:6379`). Obbligatorio per il bus eventi e i canali di stato. |
| `LOG_LEVEL` | `info` | Livello di log: `trace`, `debug`, `info`, `warning`, `error`. |
| `ENV` | — | Ambiente di esecuzione (`local`, `paper`, `prod`). Usato nel prefisso dei canali Redis. |
| `LOG_BATCH_MAX_BYTES` | — | Dimensione massima batch per il log su DB (funzionalità `dbLogger`). |
| `ENABLE_DB_LOG` | — | Se `true`, abilita la scrittura dei log su DB via `datahub`. |
| `TZ` | — | Timezone di sistema del container (es. `America/New_York`). |
| `INTERNAL_JWT_PUBLIC_KEY` | — | Chiave pubblica RSA/EC per validare i token service-to-service (`x-internal-token`). Obbligatoria per l'endpoint interno `/internal/fundamentals/user-daily-scores`. |

### FMP (Financial Modeling Prep)

| Variabile | Default | Descrizione |
|---|---|---|
| `FMP_API_KEY` | — | API key FMP. Obbligatoria per lo screener, il fetch dei fondamentali e il job `market_daily`. |
| `FMP_BASE_URL` | `https://financialmodelingprep.com` | Base URL delle API FMP. Sovrascrivibile per ambienti di test o proxy interni. |

### Momentum e indicatori tecnici

| Variabile | Default | Descrizione |
|---|---|---|
| `MOMENTUM_TF` | `1Day` | Timeframe dei candles scaricati dal `cachemanager` per il calcolo momentum (es. `1Day`, `1Hour`). |
| `MOMENTUM_LOOKBACK_DAYS` | `365` | Numero di giorni di storia richiesti al `cachemanager` per ogni simbolo. |
| `MARKET_INDEX_SYMBOL` | `SPY` | Simbolo usato come proxy dell'indice di mercato per il calcolo della correlazione e del market-risk score. |
| `MARKET_RISK_ON` | `HYG,IWM` | Lista di simboli (CSV) che rappresentano il regime "risk-on". Usati nel calcolo del `market_risk_score`. |
| `MARKET_RISK_OFF` | `TLT,LQD` | Lista di simboli (CSV) che rappresentano il regime "risk-off". Usati nel calcolo del `market_risk_score`. |

### Scheduling e timezone job

| Variabile | Default | Descrizione |
|---|---|---|
| `DEFAULT_JOB_TIMEZONE` | `UTC` | Timezone di default per i job `user_daily_scores` quando non specificata nella richiesta. Tipicamente `America/New_York`. |
| `SCHEDULER_TIMEZONE` | `UTC` | Alias di `DEFAULT_JOB_TIMEZONE`, letto come fallback. |

### Concorrenza job `/scan` e `/scan/force`

Le seguenti variabili controllano il parallelismo interno del job di scan. Non è necessario aggiungerle al `docker-compose` se si accettano i valori di default.

| Variabile | Default | Descrizione |
|---|---|---|
| `SCAN_FMP_CONCURRENCY` | `3` | Chiamate parallele a FMP per il fetch dei fondamentali. Tenere basso per rispettare il rate-limit FMP. |
| `SCAN_MOMENTUM_CONCURRENCY` | `5` | Chiamate parallele a `cachemanager` per il calcolo momentum/indicatori tecnici. Non è soggetto a rate-limit FMP, può essere aumentato. |
| `SCAN_UPSERT_CONCURRENCY` | `5` | Upsert paralleli su `datahub` per `fundamentals_history`. Non è soggetto a rate-limit FMP, può essere aumentato. |
| `SCAN_MISSING_BATCH` | `50` | Dimensione del batch di simboli non ancora in DB processati per iterazione. |
| `SCAN_BULK_SIZE` | `200` | Dimensione del chunk per il POST bulk a `/fundamentals/bulk`. |

### Concorrenza job `market_daily`

| Variabile | Default | Descrizione |
|---|---|---|
| `MARKET_DAILY_CONCURRENCY` | `5` | Numero di simboli processati in parallelo nel job `POST /fundamentals/update-market-daily`. Ogni simbolo chiama FMP per la storia OHLCV completa, quindi aumentare con cautela. |

### Esempio di tuning aggressivo

```yaml
environment:
  - SCAN_FMP_CONCURRENCY=3        # non aumentare, FMP ha rate-limit rigido
  - SCAN_MOMENTUM_CONCURRENCY=10  # cachemanager è interno, regge concorrenza alta
  - SCAN_UPSERT_CONCURRENCY=10    # datahub è interno, regge concorrenza alta
  - MARKET_DAILY_CONCURRENCY=15   # aumentabile se il piano FMP lo consente
```

:::caution
Aumentare `SCAN_FMP_CONCURRENCY` o `MARKET_DAILY_CONCURRENCY` oltre `3–5` può causare errori `429 Too Many Requests` da FMP che rallentano ulteriormente i job per via del backoff esponenziale.
:::

## Pagine dedicate

- [Architettura e flussi](./ms-tickerscanner-architettura.md)
- [Endpoint dettagliati](./ms-tickerscanner-endpoint.md)
- [Implementazione per file](./ms-tickerscanner-file-e-ruoli.md)
- [Configurazione](./ms-tickerscanner-configurazione.md)
- [Runbook](./ms-tickerscanner-runbook.md)
