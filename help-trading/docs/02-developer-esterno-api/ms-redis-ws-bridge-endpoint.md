---
sidebar_position: 2
---

# Endpoint dettagliati

## Endpoint WebSocket

### `GET /redis-ws-bridge/ws` (upgrade WS)

Apre connessione WebSocket.

Parametri query supportati:

- `topics`: lista pattern/topic separati da virgola
- `symbols`: lista ticker separati da virgola
- `types`: lista tipi evento (`tick`, `candle`, ...)
- `aggregate`: `throttle`, `lastPerSymbol`, `tickToBar1s`
- `rateMs`: intervallo aggregazione/throttle

## Endpoint status bridge

Prefisso: `/status`.

### `GET /status/health`

Health check base.

### `GET /status/clients`

Snapshot client WS connessi e statistiche (`sent`, `dropped`, `matched`, filtri).

### `GET /status/metrics`

Metriche bridge (attualmente aggregate dai dati client hub).

### `GET /status/bus`

Stato RedisBus (pub/sub readiness e canali).

### `GET /status/communicationChannels`

Configurazione canali bus (telemetry/metrics/data/logs/events).

### `PUT /status/communicationChannels`

Aggiorna configurazione canali bus (`on`, `params.intervalsMs`).

### `GET /status/logLevel`

Livello log corrente.

### `PUT /status/logLevel`

Aggiorna livello log runtime.

## Endpoint operativi standard

- `GET /release`
- `GET /settings`
- `PUT /settings`
- `GET /dbLogger`
- `PUT /dbLogger/:status`
