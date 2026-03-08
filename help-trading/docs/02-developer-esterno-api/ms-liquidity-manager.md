---
sidebar_position: 41
---

import LiquidityManagerArchitectureDiagram from '@site/src/components/LiquidityManagerArchitectureDiagram';

# liquidity-manager

## Cosa fa

`liquidity-manager` calcola un liquidity score aggregato (risk/liquidity regime) usando provider multipli e mantiene storico + task asincroni di recompute.

## Ruoli e responsabilita

- calcolo score composito da VIX, SPY trend, DXY, credit spread;
- gestione task asincroni di recompute con progress tracking;
- esposizione storico score e stato provider;
- persistenza snapshot e pruning storico.

## Porta esposta

- Porta interna servizio: `3001`
- Esposizione via Traefik (local profile): `http://localhost/liquidity-manager/*`

## Architettura grafica

<LiquidityManagerArchitectureDiagram />

## Configurazione compose

Nel repository attuale il servizio e definito in `docker-compose.local.yml` (non in `docker-compose.paper.yml`).

```yaml
liquidity-manager:
  image: local/liquidity-manager:${LIQUIDITYMANAGER_VERSION:-latest}
  ports:
    - "3001:3001"
  profiles: ["liquidity-manager"]
  environment:
    - DATAHUB_URL=http://datahub:3000
    - REDIS_URL=redis://redis:6379
    - FRED_API_KEY=${FRED_API_KEY}
    - LIQUIDITY_PROVIDER_MODE=live
    - LIQUIDITY_PROVIDER_TIMEOUT_MS=5000
    - TZ=${TIMEZONE}
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3001/status/health"]
```

## Variabili d'ambiente

### Infrastruttura

Variabili obbligatorie gestite da `BaseService` (comune a tutti i microservizi).

| Variabile | Default | Descrizione |
|---|---|---|
| `DATAHUB_URL` | `http://datahub:3000` | URL del servizio `datahub` (ex `DBMANAGER_URL`, ancora accettato come alias). |
| `REDIS_URL` | — | URI Redis (es. `redis://redis:6379`). Obbligatorio per il bus eventi e i canali di stato. |
| `LOG_LEVEL` | `info` | Livello di log: `trace`, `debug`, `info`, `warning`, `error`. |
| `ENV` | — | Ambiente di esecuzione (`local`, `paper`, `prod`). Usato nel prefisso dei canali Redis. |
| `LOG_BATCH_MAX_BYTES` | — | Dimensione massima batch per il log su DB (funzionalità `dbLogger`). |
| `ENABLE_DB_LOG` | — | Se `true`, abilita la scrittura dei log su DB via `datahub`. |
| `TZ` | — | Timezone di sistema del container (es. `America/New_York`). |

### FRED (Federal Reserve Economic Data)

| Variabile | Default | Descrizione |
|---|---|---|
| `FRED_API_KEY` | — | API key FRED. Obbligatoria per i provider `vixProvider` (sorgente FRED) e `dxyProvider` (sorgente FRED). |

### Provider e modalita di esecuzione

| Variabile | Default | Descrizione |
|---|---|---|
| `LIQUIDITY_PROVIDER_MODE` | `live` | Modalita di esecuzione dei provider. Valori: `live` (dati reali), `mock` (dati simulati per test). |
| `LIQ_PROVIDER_TIMEOUT_MS` | `5000` | Timeout HTTP in ms applicato a ogni chiamata ai provider esterni (VIX, DXY, credit spread, SPY). |
| `LIQ_VIX_PROVIDER` | `auto` | Sorgente preferita per il VIX. Valori: `auto` (stooq -> fred), `stooq`, `fred`. |
| `LIQ_DXY_PROVIDER` | `auto` | Sorgente preferita per il DXY. Valori: `auto` (fred -> yahoo -> stooq), `yahoo`, `fred`, `stooq`. |
| `LIQ_CREDIT_PROVIDER` | `fred` | Sorgente preferita per il credit spread. Valori: `fred`. |
| `LIQ_CREDIT_SERIES` | `BAA10Y` | Serie FRED usata per il credit spread (spread Moody's BAA meno T10Y). |
| `LIQ_DXY_FRED_SERIES` | `DTWEXBGS` | Serie FRED usata per il DXY (Dollar Index Broad, Goods). |
| `LIQ_MIN_CONFIDENCE_FOR_REGIME` | `0.6` | Soglia minima di confidenza (0-1) per assegnare un `riskRegime` diverso da `NEUTRAL`. |
| `LIQUIDITY_HTTP_TIMEOUT_MS` | `10000` | Timeout HTTP generale per l'`httpClient` condiviso tra i provider. |

### Provider Yahoo Finance (DXY)

| Variabile | Default | Descrizione |
|---|---|---|
| `YAHOO_TIMEOUT_MS` | `8000` | Timeout in ms per le chiamate HTTP a Yahoo Finance. |
| `YAHOO_RETRY_MAX_ATTEMPTS` | `5` | Numero massimo di tentativi in caso di errore o rate-limit da Yahoo. |
| `YAHOO_RETRY_BASE_MS` | `1000` | Attesa base in ms per il backoff esponenziale tra i tentativi Yahoo. |
| `YAHOO_RETRY_MAX_MS` | `15000` | Attesa massima in ms per il backoff esponenziale tra i tentativi Yahoo. |
| `YAHOO_CACHE_TTL_MIN` | `360` | TTL della cache locale Yahoo in minuti (6 ore). Evita chiamate ripetute in breve tempo. |
| `YAHOO_RATE_LIMIT_RPS` | `1` | Limite di chiamate per secondo al rate-limiter Yahoo. |
| `YAHOO_RATE_LIMIT_RPM` | `30` | Limite di chiamate per minuto al rate-limiter Yahoo. |
| `YAHOO_JITTER_MIN_MS` | `200` | Jitter minimo in ms aggiunto tra le chiamate Yahoo per evitare burst. |
| `YAHOO_JITTER_MAX_MS` | `800` | Jitter massimo in ms aggiunto tra le chiamate Yahoo. |
| `YAHOO_CIRCUIT_FAILS` | `3` | Numero di fallimenti consecutivi prima che il circuit breaker Yahoo apra il circuito. |
| `YAHOO_CIRCUIT_COOLDOWN_MIN` | `30` | Tempo di cooldown in minuti prima che il circuit breaker Yahoo riprovi. |

### Repository e storico

| Variabile | Default | Descrizione |
|---|---|---|
| `LIQUIDITY_REPOSITORY_MODE` | `memory` | Modalita di persistenza dello storico score. Valori: `memory` (in-memory, perso al riavvio), `file` (persistenza su file JSON). |
| `LIQUIDITY_HISTORY_FILE_PATH` | `data/liquidity-score-history.json` | Percorso del file JSON per la persistenza (usato solo se `LIQUIDITY_REPOSITORY_MODE=file`). |
| `LIQUIDITY_HISTORY_DAYS` | `365` | Numero di giorni di storico da mantenere; i record piu vecchi vengono eliminati dal pruning. |

### Task e concorrenza

| Variabile | Default | Descrizione |
|---|---|---|
| `LIQUIDITY_MAX_TASKS` | `500` | Numero massimo di task di recompute memorizzati in memoria dal `RecomputeTaskManager`. I task piu vecchi vengono rimossi quando si supera il limite. |

## Pagine dedicate

- [Architettura e flussi](./ms-liquidity-manager-architettura.md)
- [Endpoint dettagliati](./ms-liquidity-manager-endpoint.md)
- [Implementazione per file](./ms-liquidity-manager-file-e-ruoli.md)
- [Configurazione](./ms-liquidity-manager-configurazione.md)
- [Runbook operativo](./ms-liquidity-manager-runbook.md)
