---
sidebar_position: 9
---


# ibkr-keepalive

Questa pagina e l'hub API del microservizio `ibkr-keepalive`.

## Endpoint disponibili

| Metodo | Path | Descrizione | Dettaglio |
|---|---|---|---|
| `GET` | `/ibkr-keepalive/release` | Nessuno; info release build. | [Apri](./ibkr-keepalive-endpoint-01-get-ibkr-keepalive-release.md) |
| `GET` | `/ibkr-keepalive/settings` | Nessuno; settings runtime correnti. | [Apri](./ibkr-keepalive-endpoint-02-get-ibkr-keepalive-settings.md) |
| `PUT` | `/ibkr-keepalive/settings` | Body `{ setting, value }` oppure `{ KEY: value }`. | [Apri](./ibkr-keepalive-endpoint-03-put-ibkr-keepalive-settings.md) |
| `POST` | `/ibkr-keepalive/settings/reload` | Nessuno; reload settings da datahub. | [Apri](./ibkr-keepalive-endpoint-04-post-ibkr-keepalive-settings-reload.md) |
| `PUT` | `/ibkr-keepalive/connect` | Nessuno; avvia connessione keepalive. | [Apri](./ibkr-keepalive-endpoint-05-put-ibkr-keepalive-connect.md) |
| `DELETE` | `/ibkr-keepalive/connect` | Nessuno; ferma connessione keepalive. | [Apri](./ibkr-keepalive-endpoint-06-delete-ibkr-keepalive-connect.md) |
| `GET` | `/ibkr-keepalive/dbLogger` | Nessuno; stato logging su DB. | [Apri](./ibkr-keepalive-endpoint-07-get-ibkr-keepalive-dblogger.md) |
| `PUT` | `/ibkr-keepalive/dbLogger/:status` | Path `status` (`on`/`off`); abilita/disabilita db log. | [Apri](./ibkr-keepalive-endpoint-08-put-ibkr-keepalive-dblogger-status.md) |
| `GET` | `/ibkr-keepalive/status/health` | Nessuno; health check. | [Apri](./ibkr-keepalive-endpoint-09-get-ibkr-keepalive-status-health.md) |
| `GET` | `/ibkr-keepalive/status/info` | Nessuno; info servizio e stato connessioni. | [Apri](./ibkr-keepalive-endpoint-10-get-ibkr-keepalive-status-info.md) |
