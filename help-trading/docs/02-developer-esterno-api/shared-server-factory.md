---
sidebar_position: 2
---

# serverFactory.js

## Utilizzo nei microservizi

[authService](./ms-authservice), [brokerExecutor-ibkr](./ms-brokerexecutor-ibkr), [datahub](./ms-datahub), [ibkr-bridge](./ms-ibkr-bridge), [liquidity-manager](./ms-liquidity-manager), [market-data-service](./ms-market-data-service), [serviceControlPlane](./ms-servicecontrolplane), [tickerScanner](./ms-tickerscanner).

## Funzioni e utilizzo

| Funzione | Parametri principali | Microservizi che la usano |
|---|---|---|
| `createMicroserviceServer(config)` | `config: ServiceClass, microservice, defaultPort, routes, hook` | [authService](./ms-authservice), [brokerExecutor-ibkr](./ms-brokerexecutor-ibkr), [datahub](./ms-datahub), [ibkr-bridge](./ms-ibkr-bridge), [liquidity-manager](./ms-liquidity-manager), [market-data-service](./ms-market-data-service), [serviceControlPlane](./ms-servicecontrolplane), [tickerScanner](./ms-tickerscanner) |

## Dettaglio funzioni

### `createMicroserviceServer(config)`

- Cosa fa: Factory completa per server Express standardizzato (route base, status, CORS, lifecycle).
- Parametri: `config: ServiceClass, microservice, defaultPort, routes, hook`

## Percorso

- `trading-system/shared/serverFactory.js`
