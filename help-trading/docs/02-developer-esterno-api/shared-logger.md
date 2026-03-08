---
sidebar_position: 4
---

# logger.js

## Utilizzo nei microservizi

[DBManager (legacy)](./ms-datahub), [alertingService](./ms-alertingservice), [cacheManager](./ms-cachemanager), [decision-engine](./ms-decision-engine), [ibkr-keepalive](./ms-ibkr-keepalive), [redisWsBridge](./ms-redis-ws-bridge), [scheduler](./ms-scheduler).

## API principali

| Funzione | Parametri principali | Microservizi che la usano |
|---|---|---|
| `createLogger(microservice,moduleName,moduleVersion,level,opts)` | identificativi modulo + livello + opzioni bus/db | [DBManager (legacy)](./ms-datahub), [alertingService](./ms-alertingservice), [cacheManager](./ms-cachemanager), [decision-engine](./ms-decision-engine), [ibkr-keepalive](./ms-ibkr-keepalive), [redisWsBridge](./ms-redis-ws-bridge), [scheduler](./ms-scheduler) |
| `logger.setLevel(level)` | `level` runtime | stessi microservizi |
| `logger.getLevel()` | nessuno | stessi microservizi |
| `logger.attachBus(bus)` | istanza `RedisBus` | stessi microservizi |
| `logger.forModule(name)` | nome/path modulo | stessi microservizi |
| `logger.setDbLogStatus(enable)` | boolean | stessi microservizi |
| `logger.getDbLogStatus()` | nessuno | stessi microservizi |

## Log level supportati

I livelli reali supportati dal logger condiviso sono:

- `trace`
- `log`
- `info`
- `warning`
- `error`

Nota: `debug` non e un livello nativo in questa implementazione.

## Come usare il logger nelle funzioni

Regole consigliate:

1. Creare il logger una volta nel modulo e riusarlo.
2. Usare `logger.forModule()` quando il file contiene piu funzioni importanti.
3. Nei `catch`, loggare sempre errore + contesto minimo (`id`, `symbol`, `url`, ecc.).
4. Non serializzare manualmente tutto in stringhe lunghe: mettere il dettaglio tecnico in JSON in coda.

Esempio base per funzione:

```js
const logger = createLogger('tickerscanner', 'marketDailyService', '1.0.0', process.env.LOG_LEVEL || 'info');

async function runJob(jobId, symbol) {
  logger.info(`[runJob] start jobId=${jobId} symbol=${symbol}`);
  try {
    // business logic
    logger.info(`[runJob] completed jobId=${jobId}`);
  } catch (err) {
    logger.error(`[runJob] failed jobId=${jobId} symbol=${symbol} | ${JSON.stringify({
      error: err?.message || String(err),
      stack: err?.stack,
    })}`);
    throw err;
  }
}
```

Esempio con logger modulo dedicato:

```js
const rootLogger = createLogger('scheduler', 'main', '1.0.0', process.env.LOG_LEVEL || 'info');
const logger = rootLogger.forModule('schedulerEngine');

logger.trace('[tick] scheduler loop heartbeat');
logger.warning('[executeJob] retry in backoff');
```

## Regola JSON in coda (importante per frontend)

Per avere parsing corretto dei dettagli lato backend/frontend, le informazioni di dettaglio devono stare in coda al messaggio come JSON valido.

Formato raccomandato:

- `"testo log | { ...jsonDetails... }"`

Perche:

- il logger separa `message` e `jsonDetails`;
- `jsonDetails` viene salvato in modo strutturato;
- il frontend puo renderizzare i dettagli in modo consistente.

Esempi corretti:

```js
logger.info('[syncOrders] completed | {"jobId":"j123","processed":120,"errors":0}');

logger.error(`[fetchTicker] failed | ${JSON.stringify({
  symbol,
  url,
  status: err?.response?.status,
  error: err?.message,
})}`);
```

Esempi da evitare:

```js
// JSON non in coda o non valido: parsing meno affidabile
logger.error('[fetchTicker] failed details=' + err);
logger.info('[syncOrders] completed {processed:120}'); // non JSON valido
```

## Comportamento interno utile

- Output console con prefisso strutturato: timestamp, microservizio, modulo, versione, livello.
- Pubblicazione su Redis bus topic: `ENV.microservice.module.logs.level`.
- Accodamento DB (`/logs`) in batch asincroni, con limite payload (`LOG_BATCH_MAX_BYTES`).

## Percorso

- `trading-system/shared/logger.js`
