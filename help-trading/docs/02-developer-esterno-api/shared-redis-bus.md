---
sidebar_position: 6
---

# redisBus.js

## Utilizzo nei microservizi

[DBManager (legacy)](./ms-datahub), [alertingService](./ms-alertingservice), [cacheManager](./ms-cachemanager), [decision-engine](./ms-decision-engine), [ibkr-keepalive](./ms-ibkr-keepalive), [redisWsBridge](./ms-redis-ws-bridge), [scheduler](./ms-scheduler).

## Funzioni e utilizzo

| Funzione | Parametri principali | Microservizi che la usano |
|---|---|---|
| `new RedisBus(options)` | `options: url, name, channels` | [DBManager (legacy)](./ms-datahub), [alertingService](./ms-alertingservice), [cacheManager](./ms-cachemanager), [decision-engine](./ms-decision-engine), [ibkr-keepalive](./ms-ibkr-keepalive), [redisWsBridge](./ms-redis-ws-bridge), [scheduler](./ms-scheduler) |
| `connect()` | `-` | [DBManager (legacy)](./ms-datahub), [alertingService](./ms-alertingservice), [cacheManager](./ms-cachemanager), [decision-engine](./ms-decision-engine), [ibkr-keepalive](./ms-ibkr-keepalive), [redisWsBridge](./ms-redis-ws-bridge), [scheduler](./ms-scheduler) |
| `publish(channel, payload)` | `channel + payload serializzabile` | [DBManager (legacy)](./ms-datahub), [alertingService](./ms-alertingservice), [cacheManager](./ms-cachemanager), [decision-engine](./ms-decision-engine), [ibkr-keepalive](./ms-ibkr-keepalive), [redisWsBridge](./ms-redis-ws-bridge), [scheduler](./ms-scheduler) |
| `subscribe(channel, handler)` | `channel + callback` | [DBManager (legacy)](./ms-datahub), [alertingService](./ms-alertingservice), [cacheManager](./ms-cachemanager), [decision-engine](./ms-decision-engine), [ibkr-keepalive](./ms-ibkr-keepalive), [redisWsBridge](./ms-redis-ws-bridge), [scheduler](./ms-scheduler) |
| `psubscribe(pattern, handler)` | `pattern + callback` | [DBManager (legacy)](./ms-datahub), [alertingService](./ms-alertingservice), [cacheManager](./ms-cachemanager), [decision-engine](./ms-decision-engine), [ibkr-keepalive](./ms-ibkr-keepalive), [redisWsBridge](./ms-redis-ws-bridge), [scheduler](./ms-scheduler) |
| `get(key) / set(key,value,opts) / del(key)` | `chiave + valore/opzioni TTL` | [DBManager (legacy)](./ms-datahub), [alertingService](./ms-alertingservice), [cacheManager](./ms-cachemanager), [decision-engine](./ms-decision-engine), [ibkr-keepalive](./ms-ibkr-keepalive), [redisWsBridge](./ms-redis-ws-bridge), [scheduler](./ms-scheduler) |
| `xadd/xaddJson(stream, ... )` | `stream + fields/event` | [DBManager (legacy)](./ms-datahub), [alertingService](./ms-alertingservice), [cacheManager](./ms-cachemanager), [decision-engine](./ms-decision-engine), [ibkr-keepalive](./ms-ibkr-keepalive), [redisWsBridge](./ms-redis-ws-bridge), [scheduler](./ms-scheduler) |
| `consumeLoop(opts)` | `opts: stream/group/consumer/onMessage` | [DBManager (legacy)](./ms-datahub), [alertingService](./ms-alertingservice), [cacheManager](./ms-cachemanager), [decision-engine](./ms-decision-engine), [ibkr-keepalive](./ms-ibkr-keepalive), [redisWsBridge](./ms-redis-ws-bridge), [scheduler](./ms-scheduler) |
| `setChannelConfig(key,cfg)` | `key: telemetry|metrics|...; cfg runtime` | [DBManager (legacy)](./ms-datahub), [alertingService](./ms-alertingservice), [cacheManager](./ms-cachemanager), [decision-engine](./ms-decision-engine), [ibkr-keepalive](./ms-ibkr-keepalive), [redisWsBridge](./ms-redis-ws-bridge), [scheduler](./ms-scheduler) |
| `close()` | `-` | [DBManager (legacy)](./ms-datahub), [alertingService](./ms-alertingservice), [cacheManager](./ms-cachemanager), [decision-engine](./ms-decision-engine), [ibkr-keepalive](./ms-ibkr-keepalive), [redisWsBridge](./ms-redis-ws-bridge), [scheduler](./ms-scheduler) |

## Dettaglio funzioni

### `new RedisBus(options)`

- Cosa fa: Inizializza il bus Redis con canali e scheduler batching.
- Parametri: `options: url, name, channels`

### `connect()`

- Cosa fa: Apre connessioni pub/sub e prepara il bus all'uso.
- Parametri: `-`

### `publish(channel, payload)`

- Cosa fa: Pubblica evento/comando su canale Redis.
- Parametri: `channel + payload serializzabile`

### `subscribe(channel, handler)`

- Cosa fa: Subscribe a canale specifico.
- Parametri: `channel + callback`

### `psubscribe(pattern, handler)`

- Cosa fa: Subscribe con pattern wildcard (pub/sub).
- Parametri: `pattern + callback`

### `get(key) / set(key,value,opts) / del(key)`

- Cosa fa: API KV helper su Redis.
- Parametri: `chiave + valore/opzioni TTL`

### `xadd/xaddJson(stream, ... )`

- Cosa fa: Scrittura eventi su Redis Stream.
- Parametri: `stream + fields/event`

### `consumeLoop(opts)`

- Cosa fa: Loop consumo stream con consumer group.
- Parametri: `opts: stream/group/consumer/onMessage`

### `setChannelConfig(key,cfg)`

- Cosa fa: Aggiorna config runtime dei canali.
- Parametri: `key: telemetry|metrics|...; cfg runtime`

### `close()`

- Cosa fa: Chiude connessioni Redis in shutdown controllato.
- Parametri: `-`

## Esempi di utilizzo

### 1) Inizializzazione nel servizio

```js
const { RedisBus } = require('../shared/redisBus');

const bus = new RedisBus({
  url: process.env.REDIS_URL,
  name: 'scheduler',
  env: process.env.ENV || 'LOCAL',
  channels: {
    telemetry: { on: true, params: { intervalsMs: 1000 } },
    metrics:   { on: true, params: { intervalsMs: 1000 } },
    data:      { on: true, params: { intervalsMs: 0 } },
    logs:      { on: true, params: { intervalsMs: 0 } },
    events:    { on: true, params: { intervalsMs: 0 } },
  },
});

await bus.connect();
```

### 2) Publish su canale data/event

```js
const redisDataChannel = `${process.env.ENV}.market-data-service.data`;
const redisEventsChannel = `${process.env.ENV}.scheduler.events`;

await bus.publish(redisDataChannel, {
  type: 'marketData',
  ticker: 'AAPL',
  price: 189.21,
  ts: Date.now(),
});

await bus.publish(redisEventsChannel, {
  eventKey: 'scheduler.TASK.COMPLETED',
  eventId: 'TASK.COMPLETED',
  ts: new Date().toISOString(),
  payload: { jobKey: 'market-daily', result: 'ok' },
});
```

### 3) Subscribe / Pattern subscribe

```js
await bus.subscribe(`${process.env.ENV}.cachemanager.events`, async (parsed, raw) => {
  // parsed = JSON se valido, altrimenti undefined
  if (parsed?.eventId === 'CACHE.CLEARED') {
    console.log('Cache cleared', parsed.payload);
  }
});

await bus.psubscribe(`${process.env.ENV}.*.status.HOOK`, async (parsed, _raw, channel) => {
  if (parsed?.type === 'job.done') {
    console.log('job done from', channel, parsed.jobId, parsed.status);
  }
});
```

### 4) KV cache con TTL

```js
const key = bus.key('market-data', 'snapshot', 'aapl'); // es: PAPER:market-data:snapshot:aapl

await bus.set(key, { ticker: 'AAPL', price: 189.21 }, { EX: 60 });
const value = await bus.get(key);
await bus.del(key);
```

### 5) Stream + consumer group

```js
await bus.xaddJson('stream:orders', {
  type: 'ORDER.CREATED',
  orderId: 'ord_123',
  ts: new Date().toISOString(),
});

await bus.consumeLoop({
  stream: 'stream:orders',
  group: 'orders-workers',
  consumer: 'worker-1',
  onMessage: async ({ id, json }) => {
    // process event
    return true; // ack
  },
  onError: (err) => console.error('consumeLoop error', err),
});
```

### 6) Aggiornamento runtime canali

```js
bus.setChannelConfig('telemetry', { on: false, params: { intervalsMs: 1000 } });
bus.setChannelConfig('events', { on: true, params: { intervalsMs: 0 } });
```

## Percorso

- `trading-system/shared/redisBus.js`
