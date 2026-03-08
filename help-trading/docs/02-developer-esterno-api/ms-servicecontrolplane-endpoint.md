---
sidebar_position: 2
---

# Endpoint dettagliati

Prefisso esterno via Traefik: `/servicecontrolplane`.

## Endpoint service flags

### `GET /servicecontrolplane/service-flags`

Lista completa flag (`service_flags`).

### `GET /servicecontrolplane/service-flags/:id`

Dettaglio flag per id.

### `POST /servicecontrolplane/service-flags`

Crea flag.

Body minimo:

- `env` (obbligatorio)
- `microservice` (obbligatorio)
- `enabled` (default `true`)
- `note` (opzionale)

### `PUT /servicecontrolplane/service-flags/:id`

Aggiorna flag per id (stessi campi del create).

### `DELETE /servicecontrolplane/service-flags/:id`

Cancella flag per id.

## Endpoint standard microservizio

- `GET /servicecontrolplane/release`
- `GET /servicecontrolplane/settings`
- `PUT /servicecontrolplane/settings`
- `POST /servicecontrolplane/settings/reload`
- `PUT /servicecontrolplane/connect`
- `DELETE /servicecontrolplane/connect`
- `GET /servicecontrolplane/dbLogger`
- `PUT /servicecontrolplane/dbLogger/:status`

## Endpoint status

Prefisso: `/servicecontrolplane/status`.

- `GET /status/health`
- `GET /status/info`
- `GET /status/metrics`
- `GET /status/logLevel`
- `PUT /status/logLevel`
- `GET /status/communicationChannels`
- `PUT /status/communicationChannels`
