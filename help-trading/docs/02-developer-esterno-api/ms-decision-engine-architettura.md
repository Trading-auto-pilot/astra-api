---
sidebar_position: 1
---

# Architettura e flussi

## Flusso principale spot-finder

1. Il client (o un microservizio) richiama `decision-engine`.
2. `decision-engine` recupera il set ticker (per `pipeId`) tramite `tickerScanner`.
3. Per ogni ticker legge candles da `cachemanager`.
4. Calcola livelli/zones e segnali con i moduli analitici.
5. Salva snapshot e stato job in Redis.

## Integrazione con datahub

`decision-engine` usa `DATAHUB_URL` (fallback `DBMANAGER_URL`) in due modi:

- lettura settings runtime tramite `shared/loadSettings`;
- scrittura log applicativi su tabella log via `shared/logger` (`POST /logs`).

## Invocazione da scheduler

Lo scheduler invoca endpoint interni:

- `POST /internal/spot-finder/:pipeId`
- `POST /internal/spot-finder/live/:pipeId`
- `DELETE /internal/spot-finder/live/:pipeId`

Le chiamate interne richiedono `x-internal-token` con:

- issuer `astraai-internal`
- audience `decision-engine`
- scope `decision-engine:spot-finder`

## Modalita operative

- **sync**: `GET /spot-finder/:pipeId` restituisce subito il payload finale.
- **async**: `POST /spot-finder/:pipeId` avvia job e ritorna `jobId`.
- **live**: attiva/subscrive ticker trend su `market-data-service`.
