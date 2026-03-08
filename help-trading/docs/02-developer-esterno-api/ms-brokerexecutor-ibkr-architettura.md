---
sidebar_position: 1
---

# Architettura e flussi

## Componenti principali

- `server.js`: bootstrap API via `createMicroserviceServer`;
- `modules/main.js`: classe servizio (`BaseService`) e startup moduli runtime;
- `routes/brokerExecutorIbkr.routes.js`: mapping endpoint REST;
- `controllers/brokerExecutorIbkr.controller.js`: orchestrazione request/response;
- `services/ibkr/ibkrOrders.service.js`: logica business ordini;
- `services/ibkr/ibkrAdapter.js`: adapter HTTP verso `ibkr-bridge` / gateway IBKR;
- `modules/startup/ibkrWsOrdersListener.module.js`: listener websocket e riconciliazione ordini.

## Flusso ordini

1. API client invoca endpoint `/order` (create/update/delete).
2. Controller valida payload e delega a `IbkrOrdersService`.
3. Il service usa `IbkrAdapter` per chiamare endpoint IBKR (via bridge o gateway diretto).
4. Risposta normalizzata (`ibkrMapper`) e ritornata al client.

## Flusso stato ordini live

1. In `_onInit` parte `IbkrWsOrdersListenerModule`.
2. Il modulo apre websocket IBKR e riceve eventi `live orders`.
3. Applica update stato e triggera refresh posizioni quando rileva fill.
4. Espone snapshot listener su `/ws/status`.

## Idempotenza e sicurezza

- idempotenza create: repository in-memory con TTL su `externalCorrelationId`;
- auth accesso API gestita da Traefik `forwardAuth`;
- middleware `requireInternalToken` presente nel codice per flussi service-to-service, ma non montato nelle route correnti.
