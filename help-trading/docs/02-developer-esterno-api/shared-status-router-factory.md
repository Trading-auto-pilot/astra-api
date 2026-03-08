---
sidebar_position: 3
---

# statusRouterFactory.js

## Utilizzo nei microservizi

Indiretto (tramite serverFactory): [authService](./ms-authservice), [brokerExecutor-ibkr](./ms-brokerexecutor-ibkr), [datahub](./ms-datahub), [ibkr-bridge](./ms-ibkr-bridge), [liquidity-manager](./ms-liquidity-manager), [market-data-service](./ms-market-data-service), [serviceControlPlane](./ms-servicecontrolplane), [tickerScanner](./ms-tickerscanner).

## Funzioni e utilizzo

| Funzione | Parametri principali | Microservizi che la usano |
|---|---|---|
| `buildStatusRouter(options)` | `options: service/getService, logger, moduleName` | Indiretto (tramite serverFactory): [authService](./ms-authservice), [brokerExecutor-ibkr](./ms-brokerexecutor-ibkr), [datahub](./ms-datahub), [ibkr-bridge](./ms-ibkr-bridge), [liquidity-manager](./ms-liquidity-manager), [market-data-service](./ms-market-data-service), [serviceControlPlane](./ms-servicecontrolplane), [tickerScanner](./ms-tickerscanner) |

## Dettaglio funzioni

### `buildStatusRouter(options)`

- Cosa fa: Crea il router `/status/*` con health, info, metrics, log level e canali comunicazione.
- Parametri: `options: service/getService, logger, moduleName`

## Percorso

- `trading-system/shared/statusRouterFactory.js`
