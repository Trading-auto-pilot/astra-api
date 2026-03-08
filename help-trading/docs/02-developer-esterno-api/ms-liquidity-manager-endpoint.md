---
sidebar_position: 2
---

# Endpoint dettagliati

Prefisso esterno via Traefik local: `/liquidity-manager`.

## Endpoint liquidity score

- `GET /liquidity-manager/liquidity-score`
- `POST /liquidity-manager/liquidity-score/recompute`
- `GET /liquidity-manager/liquidity-score/history?days=30`
- `GET /liquidity-manager/liquidity-score/providers/status`
- `GET /liquidity-manager/liquidity-score/tasks`
- `GET /liquidity-manager/liquidity-score/tasks/:taskId`

## Endpoint health alias

- `GET /liquidity-manager/health`

Alias semplice per orchestratori che si aspettano `/health` oltre a `/status/health`.

## Endpoint standard microservizio

- `GET /liquidity-manager/release`
- `GET /liquidity-manager/settings`
- `PUT /liquidity-manager/settings`
- `POST /liquidity-manager/settings/reload`
- `PUT /liquidity-manager/connect`
- `DELETE /liquidity-manager/connect`
- `GET /liquidity-manager/dbLogger`
- `PUT /liquidity-manager/dbLogger/:status`

## Endpoint status

Prefisso: `/liquidity-manager/status`.

- `GET /status/health`
- `GET /status/info`
- `GET /status/metrics`
- `GET /status/logLevel`
- `PUT /status/logLevel`
- `GET /status/communicationChannels`
- `PUT /status/communicationChannels`
