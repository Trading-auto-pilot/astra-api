---
sidebar_position: 13
---

# helpers.js

## Utilizzo nei microservizi

[alertingService](./ms-alertingservice), [brokerExecutor-ibkr](./ms-brokerexecutor-ibkr), [cacheManager](./ms-cachemanager), [datahub](./ms-datahub), [decision-engine](./ms-decision-engine), [ibkr-bridge](./ms-ibkr-bridge), [ibkr-keepalive](./ms-ibkr-keepalive), [scheduler](./ms-scheduler), [tickerScanner](./ms-tickerscanner).

## Funzioni e utilizzo

| Funzione | Parametri principali | Microservizi che la usano |
|---|---|---|
| `sleep(ms)` | `ms: millisecondi` | [alertingService](./ms-alertingservice), [brokerExecutor-ibkr](./ms-brokerexecutor-ibkr), [cacheManager](./ms-cachemanager), [datahub](./ms-datahub), [decision-engine](./ms-decision-engine), [ibkr-bridge](./ms-ibkr-bridge), [ibkr-keepalive](./ms-ibkr-keepalive), [scheduler](./ms-scheduler), [tickerScanner](./ms-tickerscanner) |
| `withRetry(fn, logger, opts)` | `fn callback; logger; opts retries/backoff/jitter` | [alertingService](./ms-alertingservice), [brokerExecutor-ibkr](./ms-brokerexecutor-ibkr), [cacheManager](./ms-cachemanager), [datahub](./ms-datahub), [decision-engine](./ms-decision-engine), [ibkr-bridge](./ms-ibkr-bridge), [ibkr-keepalive](./ms-ibkr-keepalive), [scheduler](./ms-scheduler), [tickerScanner](./ms-tickerscanner) |
| `asBool(v, defVal=false)` | `v generico; defVal fallback` | [alertingService](./ms-alertingservice), [brokerExecutor-ibkr](./ms-brokerexecutor-ibkr), [cacheManager](./ms-cachemanager), [datahub](./ms-datahub), [decision-engine](./ms-decision-engine), [ibkr-bridge](./ms-ibkr-bridge), [ibkr-keepalive](./ms-ibkr-keepalive), [scheduler](./ms-scheduler), [tickerScanner](./ms-tickerscanner) |
| `asInt(v, defVal)` | `v generico; defVal fallback` | [alertingService](./ms-alertingservice), [brokerExecutor-ibkr](./ms-brokerexecutor-ibkr), [cacheManager](./ms-cachemanager), [datahub](./ms-datahub), [decision-engine](./ms-decision-engine), [ibkr-bridge](./ms-ibkr-bridge), [ibkr-keepalive](./ms-ibkr-keepalive), [scheduler](./ms-scheduler), [tickerScanner](./ms-tickerscanner) |

## Dettaglio funzioni

### `sleep(ms)`

- Cosa fa: Pausa asincrona non bloccante.
- Parametri: `ms: millisecondi`

### `withRetry(fn, logger, opts)`

- Cosa fa: Esegue retry con backoff esponenziale e jitter.
- Parametri: `fn callback; logger; opts retries/backoff/jitter`

### `asBool(v, defVal=false)`

- Cosa fa: Normalizza valori vari in boolean.
- Parametri: `v generico; defVal fallback`

### `asInt(v, defVal)`

- Cosa fa: Normalizza valori vari in intero.
- Parametri: `v generico; defVal fallback`

## Percorso

- `trading-system/shared/helpers.js`
