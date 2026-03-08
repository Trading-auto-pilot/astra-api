---
sidebar_position: 14
---


# broker-executor-ibkr

Questa pagina e l'hub API del microservizio `broker-executor-ibkr`.

## Endpoint disponibili

| Metodo | Path | Descrizione | Dettaglio |
|---|---|---|---|
| `GET` | `/broker-executor-ibkr/positions` | Query opzionali di filtro account/simbolo (se supportate dal controller). | [Apri](./broker-executor-ibkr-endpoint-01-get-broker-executor-ibkr-positions.md) |
| `GET` | `/broker-executor-ibkr/orders` | Query opzionali stato/periodo/idempotency key. | [Apri](./broker-executor-ibkr-endpoint-02-get-broker-executor-ibkr-orders.md) |
| `GET` | `/broker-executor-ibkr/ws/status` | Nessuno; stato listener websocket ordini. | [Apri](./broker-executor-ibkr-endpoint-03-get-broker-executor-ibkr-ws-status.md) |
| `POST` | `/broker-executor-ibkr/order` | Body bracket order: `symbol`, `quantity`, `limitPrice`, `stopLossPrice`, `takeProfitPrice`, metadati. | [Apri](./broker-executor-ibkr-endpoint-04-post-broker-executor-ibkr-order.md) |
| `PUT` | `/broker-executor-ibkr/order/:orderId` | Path `orderId`; body campi modificabili ordine. | [Apri](./broker-executor-ibkr-endpoint-05-put-broker-executor-ibkr-order-orderid.md) |
| `DELETE` | `/broker-executor-ibkr/order/:orderId` | Path `orderId`; cancella ordine su broker. | [Apri](./broker-executor-ibkr-endpoint-06-delete-broker-executor-ibkr-order-orderid.md) |
