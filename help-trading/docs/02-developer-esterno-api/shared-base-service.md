---
sidebar_position: 1
---

# BaseService.js

## Utilizzo nei microservizi

[authService](./ms-authservice), [brokerExecutor-ibkr](./ms-brokerexecutor-ibkr), [datahub](./ms-datahub), [ibkr-bridge](./ms-ibkr-bridge), [liquidity-manager](./ms-liquidity-manager), [market-data-service](./ms-market-data-service), [serviceControlPlane](./ms-servicecontrolplane), [tickerScanner](./ms-tickerscanner).

## Funzioni e utilizzo

| Funzione | Parametri principali | Microservizi che la usano |
|---|---|---|
| `constructor(config)` | `config: oggetto opzioni base servizio` | [authService](./ms-authservice), [brokerExecutor-ibkr](./ms-brokerexecutor-ibkr), [datahub](./ms-datahub), [ibkr-bridge](./ms-ibkr-bridge), [liquidity-manager](./ms-liquidity-manager), [market-data-service](./ms-market-data-service), [serviceControlPlane](./ms-servicecontrolplane), [tickerScanner](./ms-tickerscanner) |
| `init()` | `-` | [authService](./ms-authservice), [brokerExecutor-ibkr](./ms-brokerexecutor-ibkr), [datahub](./ms-datahub), [ibkr-bridge](./ms-ibkr-bridge), [liquidity-manager](./ms-liquidity-manager), [market-data-service](./ms-market-data-service), [serviceControlPlane](./ms-servicecontrolplane), [tickerScanner](./ms-tickerscanner) |
| `reloadSettings()` | `-` | [authService](./ms-authservice), [brokerExecutor-ibkr](./ms-brokerexecutor-ibkr), [datahub](./ms-datahub), [ibkr-bridge](./ms-ibkr-bridge), [liquidity-manager](./ms-liquidity-manager), [market-data-service](./ms-market-data-service), [serviceControlPlane](./ms-servicecontrolplane), [tickerScanner](./ms-tickerscanner) |
| `updateCommunicationChannel(newConf)` | `newConf: configurazione canali telemetry/metrics/data/logs/events` | [authService](./ms-authservice), [brokerExecutor-ibkr](./ms-brokerexecutor-ibkr), [datahub](./ms-datahub), [ibkr-bridge](./ms-ibkr-bridge), [liquidity-manager](./ms-liquidity-manager), [market-data-service](./ms-market-data-service), [serviceControlPlane](./ms-servicecontrolplane), [tickerScanner](./ms-tickerscanner) |
| `getInfo()` | `-` | [authService](./ms-authservice), [brokerExecutor-ibkr](./ms-brokerexecutor-ibkr), [datahub](./ms-datahub), [ibkr-bridge](./ms-ibkr-bridge), [liquidity-manager](./ms-liquidity-manager), [market-data-service](./ms-market-data-service), [serviceControlPlane](./ms-servicecontrolplane), [tickerScanner](./ms-tickerscanner) |
| `disconnect()` | `-` | [authService](./ms-authservice), [brokerExecutor-ibkr](./ms-brokerexecutor-ibkr), [datahub](./ms-datahub), [ibkr-bridge](./ms-ibkr-bridge), [liquidity-manager](./ms-liquidity-manager), [market-data-service](./ms-market-data-service), [serviceControlPlane](./ms-servicecontrolplane), [tickerScanner](./ms-tickerscanner) |
| `getBus()` | `-` | [authService](./ms-authservice), [brokerExecutor-ibkr](./ms-brokerexecutor-ibkr), [datahub](./ms-datahub), [ibkr-bridge](./ms-ibkr-bridge), [liquidity-manager](./ms-liquidity-manager), [market-data-service](./ms-market-data-service), [serviceControlPlane](./ms-servicecontrolplane), [tickerScanner](./ms-tickerscanner) |
| `getLogger()` | `-` | [authService](./ms-authservice), [brokerExecutor-ibkr](./ms-brokerexecutor-ibkr), [datahub](./ms-datahub), [ibkr-bridge](./ms-ibkr-bridge), [liquidity-manager](./ms-liquidity-manager), [market-data-service](./ms-market-data-service), [serviceControlPlane](./ms-servicecontrolplane), [tickerScanner](./ms-tickerscanner) |

## Dettaglio funzioni

### `constructor(config)`

- Cosa fa: Inizializza naming, URL servizi, RedisBus, logger e stato iniziale.
- Parametri: `config: oggetto opzioni base servizio`

### `init()`

- Cosa fa: Esegue bootstrap standard: Redis, settings da datahub/[DBManager (legacy)](./ms-datahub), hook custom `_onInit`.
- Parametri: `-`

### `reloadSettings()`

- Cosa fa: Ricarica le impostazioni runtime senza restart del processo.
- Parametri: `-`

### `updateCommunicationChannel(newConf)`

- Cosa fa: Applica dinamicamente la configurazione canali del bus.
- Parametri: `newConf: configurazione canali telemetry/metrics/data/logs/events`

### `getInfo()`

- Cosa fa: Restituisce snapshot stato servizio, canali e metadati runtime.
- Parametri: `-`

### `disconnect()`

- Cosa fa: Chiude risorse runtime e ferma il servizio in modo controllato.
- Parametri: `-`

### `getBus()`

- Cosa fa: Espone l'istanza RedisBus per publish/subscribe esterni.
- Parametri: `-`

### `getLogger()`

- Cosa fa: Espone il logger condiviso del servizio.
- Parametri: `-`

## Percorso

- `trading-system/shared/BaseService.js`
