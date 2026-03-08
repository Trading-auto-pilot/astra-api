---
sidebar_position: 3
---

# Implementazione per file

## Struttura principale

- `market-data-service/server.js`
- `market-data-service/modules/main.js`
- `market-data-service/modules/ibkrMarketData.js`
- `market-data-service/Dockerfile`
- `market-data-service/release.json`

## Ruolo dei file

### `server.js`

Entry point REST:

- crea server standard con `shared/serverFactory`;
- inizializza `ibkrMarketData` dopo che il service e pronto;
- passa `app`, `redisBus` e canale data al modulo market data.

### `modules/main.js`

Service class basata su `BaseService`:

- connessione Redis Bus;
- load settings da datahub;
- logger con queue DB;
- endpoint standard (`settings`, `status`, `dbLogger`, ecc.) ereditati dal factory.

### `modules/ibkrMarketData.js`

Modulo business principale:

- gestione WS con IBKR Gateway (connect/reconnect/sessione);
- mapping ticker-conid e queue subscribe/unsubscribe;
- gestione ticker/fields/snapshot interval su Redis;
- loop snapshot via `ibkr-bridge`;
- pubblicazione eventi market data su Redis channel del servizio.

### `Dockerfile`

Build container:

- copia modulo e `shared`;
- install dipendenze;
- healthcheck su `/status/health`;
- avvio `node market-data-service/server.js`.

## Note pratiche

- lo stato operativo (ticker, fields, interval) e persistito in Redis;
- il modulo `ibkrMarketData` e singleton a runtime (`moduleInstance`) per evitare doppia inizializzazione.
