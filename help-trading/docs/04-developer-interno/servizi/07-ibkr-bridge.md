---
sidebar_position: 8
---


# ibkr-bridge

Questa pagina e l'hub API del microservizio `ibkr-bridge`.

## Endpoint disponibili

| Metodo | Path | Descrizione | Dettaglio |
|---|---|---|---|
| `ALL` | `/ibkr-bridge/mirror/*` | Proxy verso IBKR Gateway; path e query pass-through. | [Apri](./ibkr-bridge-endpoint-01-all-ibkr-bridge-mirror.md) |
| `GET` | `/ibkr-bridge/accounts` | Nessuno; lista account disponibili. | [Apri](./ibkr-bridge-endpoint-02-get-ibkr-bridge-accounts.md) |
| `GET` | `/ibkr-bridge/account` | Query `accountId` obbligatorio; summary + performance. | [Apri](./ibkr-bridge-endpoint-03-get-ibkr-bridge-account.md) |
| `GET` | `/ibkr-bridge/status/health` | Nessuno; health servizio. | [Apri](./ibkr-bridge-endpoint-04-get-ibkr-bridge-status-health.md) |
| `GET` | `/ibkr-bridge/status/info` | Nessuno; stato servizio + auth/connectivity IBKR. | [Apri](./ibkr-bridge-endpoint-05-get-ibkr-bridge-status-info.md) |
| `GET` | `/ibkr-bridge/status/communicationChannels` | Nessuno; canali bus. | [Apri](./ibkr-bridge-endpoint-06-get-ibkr-bridge-status-communicationchannels.md) |
| `PUT` | `/ibkr-bridge/status/communicationChannels` | Body configurazione canali e intervalli. | [Apri](./ibkr-bridge-endpoint-07-put-ibkr-bridge-status-communicationchannels.md) |
