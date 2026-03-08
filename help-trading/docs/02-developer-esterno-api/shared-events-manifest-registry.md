---
sidebar_position: 7
---

# eventsManifestRegistry.js

## Utilizzo nei microservizi

[DBManager (legacy)](./ms-datahub), [alertingService](./ms-alertingservice), [cacheManager](./ms-cachemanager), [decision-engine](./ms-decision-engine), [ibkr-keepalive](./ms-ibkr-keepalive), [redisWsBridge](./ms-redis-ws-bridge), [scheduler](./ms-scheduler).

## Funzioni e utilizzo

| Funzione | Parametri principali | Microservizi che la usano |
|---|---|---|
| `publishEventsManifest(args)` | `args: bus, logger, microserviceName, serviceRootDir, ...` | [DBManager (legacy)](./ms-datahub), [alertingService](./ms-alertingservice), [cacheManager](./ms-cachemanager), [decision-engine](./ms-decision-engine), [ibkr-keepalive](./ms-ibkr-keepalive), [redisWsBridge](./ms-redis-ws-bridge), [scheduler](./ms-scheduler) |

## Dettaglio funzioni

### `publishEventsManifest(args)`

- Cosa fa: Legge `events.manifest.json` del servizio e lo pubblica/aggiorna in Redis.
- Parametri: `args: bus, logger, microserviceName, serviceRootDir, ...`

## Percorso

- `trading-system/shared/eventsManifestRegistry.js`
