---
sidebar_position: 3
---

# Implementazione per file

## Struttura principale

- `brokerExecutor-ibkr/server.js`
- `brokerExecutor-ibkr/modules/main.js`
- `brokerExecutor-ibkr/routes/brokerExecutorIbkr.routes.js`
- `brokerExecutor-ibkr/controllers/brokerExecutorIbkr.controller.js`
- `brokerExecutor-ibkr/services/ibkr/ibkrOrders.service.js`
- `brokerExecutor-ibkr/services/ibkr/ibkrAdapter.js`
- `brokerExecutor-ibkr/services/ibkr/ibkrMapper.js`
- `brokerExecutor-ibkr/validation/brokerExecutorIbkr.validation.js`
- `brokerExecutor-ibkr/modules/startup/ibkrWsOrdersListener.module.js`

## Ruolo dei file

### `server.js`

- avvia il servizio con `createMicroserviceServer`;
- monta route business `/` (orders/positions/ws-status).

### `modules/main.js`

- estende `BaseService`;
- in `_onInit` avvia listener websocket ordini;
- espone `getWsOrdersListenerStatus()`.

### `routes/*` + `controllers/*`

- mappano endpoint REST e gestione error payload/status code.

### `services/ibkr/ibkrOrders.service.js`

- business logic ordini:
- resolve account ID;
- idempotenza create;
- create/update/delete bracket order;
- list ordini aperti e posizioni.

### `services/ibkr/ibkrAdapter.js`

- adapter low-level HTTP IBKR:
- request wrapper con gestione errori;
- fallback `ibkr-bridge` / gateway;
- endpoint orders, positions, secdef, cancel/reply.

### `validation/brokerExecutorIbkr.validation.js`

- validazioni payload create/update ordini con vincoli BUY/SELL.

### `modules/startup/ibkrWsOrdersListener.module.js`

- wiring websocket ordini live;
- state updater + reconciler + refresh posizioni su fill.
