---
sidebar_position: 2
---

# Endpoint dettagliati

## Endpoint business IBKR

Prefisso esterno: `/ibkr-bridge`.

### `ALL /ibkr-bridge/mirror/*`

Proxy generico verso API IBKR Gateway:

- `/ibkr-bridge/mirror/iserver/marketdata/snapshot`
- `/ibkr-bridge/mirror/iserver/secdef/search`

Il bridge aggiunge prefisso `/v1/api/` se mancante.

Nota:

- su `secdef/search`, se è presente `exchange` (o `market`/`venue`), applica filtro risultati lato bridge.

### `GET /ibkr-bridge/accounts`

Lista account (`/v1/api/portfolio/accounts`).

### `GET /ibkr-bridge/account?accountId=...`

Dettaglio account:

- summary (`/v1/api/portfolio/{accountId}/summary`)
- performance (`/v1/api/pa/performance`)

## Endpoint standard microservizio

- `GET /release`
- `GET /settings`
- `PUT /settings`
- `POST /settings/reload`
- `PUT /connect`
- `DELETE /connect`
- `GET /dbLogger`
- `PUT /dbLogger/:status`

## Endpoint status

Prefisso: `/status`.

- `GET /status/health`
- `GET /status/info` (include anche `authStatus` e stato connectivity)
- `GET /status/metrics`
- `GET /status/logLevel`
- `PUT /status/logLevel`
- `GET /status/communicationChannels`
- `PUT /status/communicationChannels`
