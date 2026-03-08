---
sidebar_position: 2
---

# Endpoint dettagliati

Prefisso esterno via Traefik local: `/broker-executor-ibkr`.

## Endpoint operativi broker

- `GET /broker-executor-ibkr/positions`
- `GET /broker-executor-ibkr/orders`
- `GET /broker-executor-ibkr/ws/status`
- `POST /broker-executor-ibkr/order`
- `PUT /broker-executor-ibkr/order/:orderId`
- `DELETE /broker-executor-ibkr/order/:orderId`

## Note payload ordine

`POST /order` e `PUT /order/:orderId` validano vincoli di bracket:

- `symbol`, `quantity`, `limitPrice`, `stopLossPrice`, `takeProfitPrice`;
- coerenza BUY/SELL tra stop/take-profit/limit;
- supporto metadati `externalCorrelationId`, `decisionEngineRunId`.

## Endpoint standard microservizio

- `GET /broker-executor-ibkr/release`
- `GET /broker-executor-ibkr/settings`
- `PUT /broker-executor-ibkr/settings`
- `POST /broker-executor-ibkr/settings/reload`
- `PUT /broker-executor-ibkr/connect`
- `DELETE /broker-executor-ibkr/connect`
- `GET /broker-executor-ibkr/dbLogger`
- `PUT /broker-executor-ibkr/dbLogger/:status`

## Endpoint status

Prefisso: `/broker-executor-ibkr/status`.

- `GET /status/health`
- `GET /status/info`
- `GET /status/metrics`
- `GET /status/logLevel`
- `PUT /status/logLevel`
- `GET /status/communicationChannels`
- `PUT /status/communicationChannels`
