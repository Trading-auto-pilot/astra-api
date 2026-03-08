---
sidebar_position: 4
---

# Shared Library

Questo capitolo raccoglie la documentazione della cartella `shared/`, usata trasversalmente dai microservizi backend.

## Obiettivo

- ridurre duplicazione codice;
- standardizzare bootstrap, status, logging e integrazioni;
- offrire componenti riusabili per sicurezza, eventing e accesso dati.

## Librerie condivise

- [BaseService.js](./shared-base-service)
- [serverFactory.js](./shared-server-factory)
- [statusRouterFactory.js](./shared-status-router-factory)
- [logger.js](./shared-logger)
- [loadSettings.js](./shared-load-settings)
- [redisBus.js](./shared-redis-bus)
- [eventsManifestRegistry.js](./shared-events-manifest-registry)
- [redisPublisher.js](./shared-redis-publisher)
- [jobReporter.js](./shared-job-reporter)
- [internalAuth.js](./shared-internal-auth)
- [datahubAdapter.js](./shared-datahub-adapter)
- [routes-loader.js](./shared-routes-loader)
- [helpers.js](./shared-helpers)
- [cache.js](./shared-cache)
- [textResolver.js](./shared-text-resolver)
- [tradeDbHelpers.js](./shared-trade-db-helpers)
- [Alpaca.js](./shared-alpaca)
- [strategyUtils.js](./shared-strategy-utils)

## Note

Alcune librerie sono legacy ma mantenute per compatibilita con servizi esistenti.
