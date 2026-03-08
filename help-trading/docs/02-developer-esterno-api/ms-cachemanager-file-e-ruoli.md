---
sidebar_position: 3
---

# Implementazione per file

## Struttura principale

- `cachemanager/server.js`
- `cachemanager/modules/main.js`
- `cachemanager/modules/stats.js`
- `cachemanager/modules/alpaca.js`
- `cachemanager/modules/fmp.js`
- `cachemanager/status.js`
- `cachemanager/events.manifest.json`
- `cachemanager/Dockerfile`

## Ruolo dei file

### `server.js`

Entry point HTTP Express.

Responsabilita:

- bootstrap del servizio (`new MainModule().init()`);
- esposizione endpoint operativi (`/candles`, `/l2/*`, `/settings`, `/provider`, ecc.);
- mounting router `/status` (delegato a `status.js`);
- middleware `requireReady` per bloccare richieste prima di `READY`.

### `modules/main.js`

Core applicativo del cache manager.

Responsabilita:

- init bus Redis, logger e settings (`initializeSettings`);
- gestione provider runtime (`FMP`, `ALPACA`, `IBKR`);
- orchestrazione fetch candele con strategia `L3 -> L2 -> L1`;
- merge e normalizzazione dataset;
- scrittura/lettura L2 e L3;
- enforcement limite L2 (`MAX_L2_CACHE_MB`);
- monitor soglia L3 (`L3_USAGE_ALERT_PERCENT`) con evento di warning.

### `modules/stats.js`

Modulo diagnostica e manutenzione cache.

Responsabilita:

- statistiche L1/L2/hits;
- calcolo dimensione e struttura albero L2;
- delete selettivo/all cache L2;
- audit qualitativo file JSON L2;
- statistiche e delete per chiavi L3 Redis.

### `status.js`

Router standard `/status/*`.

Responsabilita:

- health/info/metrics/log-level;
- canali comunicazione Redis bus;
- endpoint manutenzione cache L2/L3 via integrazione con `stats.js`.

### `modules/alpaca.js`

Adapter provider Alpaca:

- costruzione headers API key;
- fetch paginato candele da endpoint Alpaca bars.

### `modules/fmp.js`

Adapter provider FMP:

- mapping timeframe interno -> FMP;
- fetch intraday (`historical-chart`) e daily/weekly (endpoint SMA).

### `Dockerfile`

Packaging container:

- copia modulo `cacheManager` + `shared`;
- install dipendenze Node;
- entrypoint `node cacheManager/server.js`.
