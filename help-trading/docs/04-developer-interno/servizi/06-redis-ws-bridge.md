---
sidebar_position: 7
---


# redis-ws-bridge

Questa pagina e l'hub API del microservizio `redis-ws-bridge`.

## Endpoint disponibili

| Metodo | Path | Descrizione | Dettaglio |
|---|---|---|---|
| `GET (WS upgrade)` | `/redis-ws-bridge/ws` | Query: `topics`, `symbols`, `types`, `aggregate`, `rateMs`; apre canale WS filtrato. | [Apri](./redis-ws-bridge-endpoint-01-get-ws-upgrade-redis-ws-bridge-ws.md) |
| `GET` | `/redis-ws-bridge/status/health` | Nessuno; health check bridge. | [Apri](./redis-ws-bridge-endpoint-02-get-redis-ws-bridge-status-health.md) |
| `GET` | `/redis-ws-bridge/status/clients` | Nessuno; client WS connessi e statistiche invio/drop. | [Apri](./redis-ws-bridge-endpoint-03-get-redis-ws-bridge-status-clients.md) |
| `GET` | `/redis-ws-bridge/status/metrics` | Nessuno; metriche runtime bridge. | [Apri](./redis-ws-bridge-endpoint-04-get-redis-ws-bridge-status-metrics.md) |
| `GET` | `/redis-ws-bridge/status/bus` | Nessuno; stato Redis bus pub/sub. | [Apri](./redis-ws-bridge-endpoint-05-get-redis-ws-bridge-status-bus.md) |
| `GET` | `/redis-ws-bridge/status/communicationChannels` | Nessuno; configurazione canali telemetria/eventi. | [Apri](./redis-ws-bridge-endpoint-06-get-redis-ws-bridge-status-communicationchan.md) |
| `PUT` | `/redis-ws-bridge/status/communicationChannels` | Body config canali (`on`, `params.intervalsMs`). | [Apri](./redis-ws-bridge-endpoint-07-put-redis-ws-bridge-status-communicationchan.md) |
| `GET` | `/redis-ws-bridge/status/logLevel` | Nessuno; livello log attivo. | [Apri](./redis-ws-bridge-endpoint-08-get-redis-ws-bridge-status-loglevel.md) |
| `PUT` | `/redis-ws-bridge/status/logLevel` | Body livello log (`trace`,`debug`,`info`,`warning`,`error`). | [Apri](./redis-ws-bridge-endpoint-09-put-redis-ws-bridge-status-loglevel.md) |
