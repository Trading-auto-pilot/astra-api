---
sidebar_position: 9
---

# jobReporter.js

## Utilizzo nei microservizi

[decision-engine](./ms-decision-engine), [tickerScanner](./ms-tickerscanner).

## Funzioni e utilizzo

| Funzione | Parametri principali | Microservizi che la usano |
|---|---|---|
| `reportJobDone(bus, channel, jobId, result)` | `bus RedisBus, channel status, jobId, result payload` | [decision-engine](./ms-decision-engine), [tickerScanner](./ms-tickerscanner) |

## Dettaglio funzioni

### `reportJobDone(bus, channel, jobId, result)`

- Cosa fa: Standardizza il reporting di fine job asincrono (`job.done`).
- Parametri: `bus RedisBus, channel status, jobId, result payload`

## Percorso

- `trading-system/shared/jobReporter.js`
