---
sidebar_position: 3
---

# Implementazione per file

## Struttura principale

- `ibkr-bridge/server.js`
- `ibkr-bridge/modules/main.js`
- `ibkr-bridge/modules/connectivity.js`
- `ibkr-bridge/ibkrRoutes.js`
- `ibkr-bridge/status.js`
- `ibkr-bridge/Dockerfile`

## Ruolo dei file

### `server.js`

Entry point REST:

- crea microservizio con `serverFactory`;
- monta router custom IBKR (`ibkrRoutes`);
- espone endpoint standard e status dal framework shared.

### `modules/main.js`

Service container:

- estende `BaseService`;
- inizializza `IbkrConnectivity`;
- avvia/ferma connectivity loop nei lifecycle hook.

### `modules/connectivity.js`

Core integrazione IBKR:

- client HTTP verso gateway (con supporto TLS insecure opzionale);
- check ciclico auth/tickle/ssodh;
- gestione reauth SSO su `401`;
- metodi funzionali `proxyIbkr`, `getAccounts`, `getAccount`, `getAuthStatus`.

### `ibkrRoutes.js`

Routing API del bridge:

- `mirror/*` (proxy generico);
- `accounts` e `account` (API semplificate);
- normalizzazione input e mapping error/status.

### `status.js`

Router `/status/*`:

- info estesa con stato auth/connectivity;
- metriche, communication channels, log level.

### `Dockerfile`

Build container:

- copia modulo `ibkr-bridge` + `shared`;
- install dipendenze;
- avvio `node ibkr-bridge/server.js`.
