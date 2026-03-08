---
sidebar_position: 5
---

# loadSettings.js

## Utilizzo nei microservizi

[alertingService](./ms-alertingservice), [cacheManager](./ms-cachemanager), [decision-engine](./ms-decision-engine), [ibkr-bridge](./ms-ibkr-bridge), [ibkr-keepalive](./ms-ibkr-keepalive), [redisWsBridge](./ms-redis-ws-bridge), [scheduler](./ms-scheduler), [tickerScanner](./ms-tickerscanner).

## Funzioni e utilizzo

| Funzione | Parametri principali | Microservizi che la usano |
|---|---|---|
| `initializeSettings(dbManagerUrl, options)` | `dbManagerUrl: base URL [datahub](./ms-datahub)/[DBManager (legacy)](./ms-datahub); options: timeout/cache` | [alertingService](./ms-alertingservice), [cacheManager](./ms-cachemanager), [decision-engine](./ms-decision-engine), [ibkr-bridge](./ms-ibkr-bridge), [ibkr-keepalive](./ms-ibkr-keepalive), [redisWsBridge](./ms-redis-ws-bridge), [scheduler](./ms-scheduler), [tickerScanner](./ms-tickerscanner) |
| `getSetting(key)` | `key: nome setting` | [alertingService](./ms-alertingservice), [cacheManager](./ms-cachemanager), [decision-engine](./ms-decision-engine), [ibkr-bridge](./ms-ibkr-bridge), [ibkr-keepalive](./ms-ibkr-keepalive), [redisWsBridge](./ms-redis-ws-bridge), [scheduler](./ms-scheduler), [tickerScanner](./ms-tickerscanner) |
| `getAllSettings()` | `-` | [alertingService](./ms-alertingservice), [cacheManager](./ms-cachemanager), [decision-engine](./ms-decision-engine), [ibkr-bridge](./ms-ibkr-bridge), [ibkr-keepalive](./ms-ibkr-keepalive), [redisWsBridge](./ms-redis-ws-bridge), [scheduler](./ms-scheduler), [tickerScanner](./ms-tickerscanner) |
| `reloadSettings(dbManagerUrl, options)` | `dbManagerUrl + opzioni fetch` | [alertingService](./ms-alertingservice), [cacheManager](./ms-cachemanager), [decision-engine](./ms-decision-engine), [ibkr-bridge](./ms-ibkr-bridge), [ibkr-keepalive](./ms-ibkr-keepalive), [redisWsBridge](./ms-redis-ws-bridge), [scheduler](./ms-scheduler), [tickerScanner](./ms-tickerscanner) |
| `setSetting(key, value)` | `key/value` | [alertingService](./ms-alertingservice), [cacheManager](./ms-cachemanager), [decision-engine](./ms-decision-engine), [ibkr-bridge](./ms-ibkr-bridge), [ibkr-keepalive](./ms-ibkr-keepalive), [redisWsBridge](./ms-redis-ws-bridge), [scheduler](./ms-scheduler), [tickerScanner](./ms-tickerscanner) |

## Dettaglio funzioni

### `initializeSettings(dbManagerUrl, options)`

- Cosa fa: Carica impostazioni iniziali dal backend dati e le mette in cache locale.
- Parametri: `dbManagerUrl: base URL datahub/[DBManager (legacy)](./ms-datahub); options: timeout/cache`
- Nota: ritorna `null` se il caricamento fallisce dopo i retry.

### `getSetting(key)`

- Cosa fa: Legge un singolo valore di configurazione dalla cache in memoria.
- Parametri: `key: nome setting`
- Nota: lancia errore se la cache non e ancora inizializzata o e vuota.

### `getAllSettings()`

- Cosa fa: Ritorna tutto il blocco settings corrente.
- Parametri: `-`
- Nota: lancia errore se la cache non e ancora inizializzata o e vuota.

### `reloadSettings(dbManagerUrl, options)`

- Cosa fa: Forza refresh completo impostazioni da storage centralizzato.
- Parametri: `dbManagerUrl + opzioni fetch`

### `setSetting(key, value)`

- Cosa fa: Aggiorna un setting in memoria (runtime, non necessariamente persistente).
- Parametri: `key/value`

## Esempi di utilizzo

### 1) Bootstrap servizio in avvio

```js
const {
  initializeSettings,
  getSetting,
} = require('../shared/loadSettings');

const datahubUrl = process.env.DATAHUB_URL || process.env.DBMANAGER_URL || 'http://datahub:3000';

async function init() {
  const ok = await initializeSettings(datahubUrl, {
    retries: 5,
    baseDelayMs: 1000,
    timeoutMs: 5000,
  });

  if (!ok) {
    throw new Error('Impossibile inizializzare settings');
  }

  const delayBetweenMessages = Number(getSetting('PROCESS_DELAY_BETWEEN_MESSAGES') || 500);
  return { delayBetweenMessages };
}
```

### 2) Lettura di un singolo setting in funzione

```js
const { getSetting } = require('../shared/loadSettings');

function getBodyLimit() {
  return getSetting('BODY_LIMIT') || '20mb';
}
```

### 3) Override runtime (solo cache locale)

```js
const { setSetting, getAllSettings } = require('../shared/loadSettings');

function updateRuntimeSetting(key, value) {
  const next = setSetting(key, value); // non persiste su DB
  return { ok: true, data: next };
}

function readRuntimeSettings() {
  return getAllSettings();
}
```

### 4) Endpoint reload settings senza restart

```js
const { reloadSettings } = require('../shared/loadSettings');

app.post('/settings/reload', async (_req, res) => {
  const datahubUrl = process.env.DATAHUB_URL || process.env.DBMANAGER_URL || 'http://datahub:3000';
  const data = await reloadSettings(datahubUrl, { timeoutMs: 5000 });

  if (!data) {
    return res.status(500).json({ ok: false, error: 'reloadSettings failed' });
  }

  return res.json({ ok: true, data });
});
```

### 5) Gestione sicura se cache non pronta

```js
const { getSetting } = require('../shared/loadSettings');

function safeGetSetting(key, fallback = null) {
  try {
    const val = getSetting(key);
    return val ?? fallback;
  } catch {
    return fallback;
  }
}
```

## Percorso

- `trading-system/shared/loadSettings.js`
