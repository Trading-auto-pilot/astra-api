---
sidebar_position: 2
---

# Endpoint dettagliati

## Endpoint business

Consultare le route del servizio sotto prefisso:

- `/ibkr-keepalive`

## Endpoint standard microservizio

- `GET /ibkr-keepalive/release`
- `GET /ibkr-keepalive/settings`
- `PUT /ibkr-keepalive/settings`
- `POST /ibkr-keepalive/settings/reload`
- `PUT /ibkr-keepalive/connect`
- `DELETE /ibkr-keepalive/connect`
- `GET /ibkr-keepalive/dbLogger`
- `PUT /ibkr-keepalive/dbLogger/:status`

## Endpoint status

- `GET /ibkr-keepalive/status/health`
- `GET /ibkr-keepalive/status/info`
- `GET /ibkr-keepalive/status/metrics`
- `GET /ibkr-keepalive/status/logLevel`
- `PUT /ibkr-keepalive/status/logLevel`
- `GET /ibkr-keepalive/status/communicationChannels`
- `PUT /ibkr-keepalive/status/communicationChannels`
