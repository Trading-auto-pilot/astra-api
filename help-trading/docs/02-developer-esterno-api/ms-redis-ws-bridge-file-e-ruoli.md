---
sidebar_position: 3
---

# Implementazione per file

## Struttura principale

- `redisWsBridge/server.js`
- `redisWsBridge/status.js`
- `redisWsBridge/wsHub.js`
- `redisWsBridge/pipeline.js`
- `redisWsBridge/config.js`
- `redisWsBridge/redisBridge.js`
- `redisWsBridge/Dockerfile`

## Ruolo dei file

### `server.js`

Entry point:

- bootstrap Express + HTTP server + WebSocket server (`/ws`);
- init `RedisBus` e `psubscribe` pattern configurati;
- dispatch messaggi Redis verso `wsHub`;
- endpoint operativi (`release`, `settings`, `dbLogger`) e mount `/status`.

### `status.js`

Router di stato/controllo:

- health, clients, metrics, bus;
- gestione `communicationChannels`;
- gestione log level runtime.

### `wsHub.js`

Hub client WebSocket:

- tracking connessioni;
- parsing opzioni client da query string;
- dispatch filtrato;
- supporto subscribe runtime via messaggio WS.

### `pipeline.js`

Funzioni filtro/aggregazione:

- filtri per topic/symbol/type;
- throttle e aggregazione per chiave;
- conversione tick->bar 1s.

### `config.js`

Carica config env:

- `REDIS_URL`
- `REDIS_PATTERNS`
- `CORS_ORIGIN`
- `PORT`

### `redisBridge.js`

Adapter Redis alternativo basato su `createClient` (presente come utility separata).

### `Dockerfile`

Build container:

- copia `redisWsBridge` + `shared`;
- install dipendenze;
- avvio `node redisWsBridge/server.js`.
