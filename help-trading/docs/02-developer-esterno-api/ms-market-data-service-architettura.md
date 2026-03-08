---
sidebar_position: 1
---

# Architettura e flussi

## Componenti principali

- `server.js`: bootstrap servizio via `createMicroserviceServer`.
- `modules/main.js`: service base (BaseService, settings, bus, logger).
- `modules/ibkrMarketData.js`: logica streaming IBKR + API subscriptions/snapshot.

## Flusso live market data

1. Il servizio apre una WS verso `IBKRGW_BASE_URL` (`/v1/api/ws`).
2. Risolve `conid` per ticker e invia subscribe (`smd+...`).
3. Riceve tick dal gateway.
4. Pubblica payload normalizzato su Redis data channel del servizio.

## Flusso snapshot

1. Il loop snapshot legge i ticker sottoscritti.
2. Richiama `ibkr-bridge` (`/mirror/iserver/marketdata/snapshot`).
3. Normalizza i record snapshot e li pubblica sul Redis data channel.

## Integrazione con gli altri microservizi

- `decision-engine` usa endpoint `/subscriptions` e `/snapshot/*` per abilitare/disabilitare live mode.
- I consumer interni ascoltano il canale Redis `ENV.market-data-service.data`.

## Integrazione con datahub

- settings runtime caricati via `DATAHUB_URL`/`DBMANAGER_URL` (BaseService + loadSettings);
- log persistenti inviati a datahub (`/logs`) tramite logger shared.
