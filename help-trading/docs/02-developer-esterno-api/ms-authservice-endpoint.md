---
sidebar_position: 2
---

# Endpoint dettagliati

## Endpoint business

Consultare le route del servizio sotto prefisso:

- `/auth`

## Endpoint standard microservizio

- `GET /auth/release`
- `GET /auth/settings`
- `PUT /auth/settings`
- `POST /auth/settings/reload`
- `PUT /auth/connect`
- `DELETE /auth/connect`
- `GET /auth/dbLogger`
- `PUT /auth/dbLogger/:status`

## Endpoint status

- `GET /auth/status/health`
- `GET /auth/status/info`
- `GET /auth/status/metrics`
- `GET /auth/status/logLevel`
- `PUT /auth/status/logLevel`
- `GET /auth/status/communicationChannels`
- `PUT /auth/status/communicationChannels`
