---
sidebar_position: 3
---

# Messages

Questa pagina descrive i principali messaggi scambiati tra microservizi via Redis Bus.

## Convenzioni generali

- I canali Pub/Sub usano pattern: `ENV.microservice.tipo` (es. `PAPER.tickerscanner.telemetry`).
- I tipi standard di canale configurabili sono: `telemetry`, `metrics`, `data`, `logs`, `events`.
- Ogni microservizio espone anche un canale `status` e, per task asincroni, `status.HOOK`.
- I messaggi sono JSON; quando non-string, il bus aggiunge `__source` con nome publisher.

## Mappa tipi messaggio

| Tipo | Canale tipico | Scopo |
|---|---|---|
| `logs` | `ENV.<service>.<module>.logs.<level>` | Log applicativi strutturati e forward verso monitoring/alerting. |
| `metrics` | `ENV.<service>.metrics` | Metriche runtime del servizio (snapshot/campionamento). |
| `data` | `ENV.<service>.data` | Dati di dominio (market data, subscriptions, risultati elaborazioni). |
| `telemetry` | `ENV.<service>.telemetry` | Avanzamento job e segnali operativi near-real-time. |
| `events` | `ENV.<service>.events` | Eventi business/event-sourcing (TASK.*, LIVE.*, AUTH.*). |
| `status` | `ENV.<service>.status` | Stato lifecycle servizio (`STARTING`, `READY`, `ERROR`, ...). |
| `status.HOOK` | `ENV.<service>.status.HOOK` | Notifica completion job asincroni (`job.done`) consumata dallo scheduler. |

## Formati ed esempi

### 1) `logs`

Messaggi pubblicati dal logger condiviso (`shared/logger.js`).

Campi principali:

- `ts`: timestamp log
- `level`: livello (`trace`, `info`, `warning`, `error`, ...)
- `microservice`, `moduleName`, `moduleVersion`
- `functionName`: opzionale, estratta dal prefisso `[fn]`
- `message`: testo log normalizzato
- `details`: JSON opzionale

Esempio:

```json
{
  "ts": "2026-03-01T12:34:56.123Z",
  "level": "warning",
  "microservice": "tickerscanner",
  "moduleName": "marketDailyService",
  "moduleVersion": "1.0.0",
  "functionName": "runJob",
  "message": "telemetry publish failed",
  "details": {
    "jobId": "job_123",
    "error": "Redis timeout"
  },
  "__source": "tickerscanner"
}
```

### 2) `metrics`

Le metriche sono mantenute in memoria dai servizi (`pushMetric` / `getMetricsSnapshot`) e rese disponibili su `/status/metrics`.

Campi tipici:

- `type`: tipo metrica
- campi specifici della metrica (`value`, `latencyMs`, `count`, ...)
- `ts`: aggiunto automaticamente alla push

Esempio:

```json
{
  "type": "job.duration",
  "jobKey": "market-daily",
  "value": 842,
  "unit": "ms",
  "ts": 1767338123456
}
```

### 3) `data`

Messaggi di dominio pubblicati dai servizi (es. market-data-service, liquidity-manager).

Campi tipici:

- `type`: sotto-tipo payload (`marketData`, `subscriptions`, ...)
- dati dominio specifici
- `ts` (spesso presente)

Esempio (`market-data-service`, `type=marketData`):

```json
{
  "type": "marketData",
  "ts": 1767338123456,
  "ticker": "AAPL",
  "conid": "265598",
  "dataMode": "snapshot",
  "payload": {
    "31": "189.21",
    "84": "189.19",
    "86": "189.25"
  },
  "__source": "market-data-service"
}
```

Esempio (`market-data-service`, `type=subscriptions`):

```json
{
  "type": "subscriptions",
  "tickers": ["AAPL", "MSFT"],
  "added": ["MSFT"],
  "removed": [],
  "__source": "market-data-service"
}
```

### 4) `telemetry`

Messaggi di avanzamento operativo, spesso per job asincroni (es. tickerScanner).

Campi tipici:

- `type`: processo sorgente (`updateMarketDaily`, `userDailyScores`, ...)
- `jobId`, `jobKey`
- `startedAt`, `finishedAt`, `durationMs`
- contatori (`processed`, `savedItems`, `errorCount`, ...)
- `status`

Esempio:

```json
{
  "type": "userDailyScores",
  "jobKey": "manual",
  "jobId": "job_789",
  "startedAt": "2026-03-01T12:00:00.000Z",
  "finishedAt": "2026-03-01T12:00:05.100Z",
  "durationMs": 5100,
  "totalItems": 320,
  "savedItems": 318,
  "errorCount": 2,
  "status": "COMPLETED",
  "__source": "tickerscanner"
}
```

### 5) `events`

Eventi business/tecnici con envelope standard (usati da decision-engine, scheduler, authservice, broker-executor, ecc.).

Campi principali:

- `eventKey`: `<service>.<eventId>`
- `eventId`
- `service`, `env`
- `ts`
- `severity`
- `correlationId`
- `payload`

Esempio:

```json
{
  "eventKey": "scheduler.TASK.COMPLETED",
  "eventId": "TASK.COMPLETED",
  "service": "scheduler",
  "env": "PAPER",
  "ts": "2026-03-01T12:45:10.000Z",
  "severity": "info",
  "correlationId": "8e4a8d25-3f5f-4f0e-bc44-0c2bc5ea9f9f",
  "payload": {
    "jobKey": "market-daily",
    "durationMs": 734,
    "result": "ok"
  },
  "__source": "scheduler"
}
```

### 6) `status`

Messaggi lifecycle pubblicati dal `BaseService`.

Campi principali:

- `status`: stato servizio (`STARTING`, `READY`, `ERROR`, ...)
- `details`: descrizione testuale

Esempio:

```json
{
  "status": "READY",
  "details": "Initialization complete",
  "__source": "cachemanager"
}
```

### 7) `status.HOOK` (`job.done`)

Messaggio speciale usato per notificare completamento task asincroni; pubblicato da `shared/jobReporter.js`.

Campi principali:

- `type`: sempre `job.done`
- `jobId`
- `status`: `COMPLETED | FAILED | CANCELLED`
- `summary`: contatori risultato
- `error`
- `finishedAt`

Esempio:

```json
{
  "type": "job.done",
  "jobId": "job_789",
  "status": "FAILED",
  "summary": {
    "processed": 120,
    "errors": 3
  },
  "error": "FMP_API_KEY non configurata",
  "finishedAt": "2026-03-01T13:02:11.902Z",
  "__source": "tickerscanner"
}
```

## Configurazione canali

La configurazione puo essere letta/aggiornata via endpoint `GET/PUT /status/communicationChannels`.

Chiavi configurabili:

- `telemetry`
- `metrics`
- `data`
- `logs`
- `events`

Ogni chiave supporta:

- `on`: abilita/disabilita publish
- `params.intervalsMs`: intervallo flush/batching per il tipo canale
