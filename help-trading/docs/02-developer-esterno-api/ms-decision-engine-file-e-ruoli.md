---
sidebar_position: 3
---

# Implementazione per file

## Struttura principale

- `decision-engine/server.js`
- `decision-engine/modules/main.js`
- `decision-engine/modules/decision-engine.js`
- `decision-engine/modules/job-manager.js`
- `decision-engine/modules/live-manager.js`
- `decision-engine/modules/candle-fetcher.js`
- `decision-engine/modules/zones.js`
- `decision-engine/modules/indicators.js`
- `decision-engine/modules/helpers.js`
- `decision-engine/modules/constants.js`
- `decision-engine/status.js`

## Ruolo dei file

### `server.js`

Entry point Express:

- init servizio;
- route tecniche (`settings`, `release`, `dbLogger`, `status`);
- mount router business `/spot-finder`;
- esposizione route interne `/internal/spot-finder/*`.

### `modules/main.js`

Core service container:

- bootstrap Redis bus + logger + settings;
- gestione canali e metriche;
- integrazione URL servizi (`DATAHUB`, `cachemanager`, `scheduler`, ecc.).

### `modules/decision-engine.js`

Router business principale:

- endpoint spot-finder sync/async;
- endpoint live mode;
- verifica token interno per route scheduler;
- orchestrazione analisi con moduli helper/zones/indicators.

### `modules/job-manager.js`

Gestione job asincroni:

- job store in-memory;
- persistenza snapshot su Redis;
- fetch ticker per pipe utente;
- utility start/stop/report dei job.

### `modules/live-manager.js`

Gestione stato live:

- stato runtime live per pipe/user;
- update su nuovi market events;
- sincronizzazione snapshot live.

### `modules/candle-fetcher.js`

Adapter tecnico per recupero candele da `cachemanager`.

### `modules/zones.js` e `modules/indicators.js`

Motore analitico:

- calcolo zone, breakout, entry levels;
- scoring e selezione candidati.

### `modules/helpers.js` e `modules/constants.js`

Utility e parametri condivisi del dominio decision-engine.

### `status.js`

Router `/status/*` per health, info, metriche e log-level.
