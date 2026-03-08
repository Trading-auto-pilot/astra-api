---
sidebar_position: 6
---


# market-data-service

Questa pagina e l'hub API del microservizio `market-data-service`.

## Endpoint disponibili

| Metodo | Path | Descrizione | Dettaglio |
|---|---|---|---|
| `GET` | `/market-data-service/subscriptions` | Nessuno; ticker attualmente sottoscritti. | [Apri](./market-data-service-endpoint-01-get-market-data-service-subscriptions.md) |
| `POST` | `/market-data-service/subscriptions` | Body `tickers: string[]`; sostituisce set sottoscrizioni. | [Apri](./market-data-service-endpoint-02-post-market-data-service-subscriptions.md) |
| `DELETE` | `/market-data-service/subscriptions/:ticker` | Path `ticker` o body `tickers[]`; rimozione sottoscrizioni. | [Apri](./market-data-service-endpoint-03-delete-market-data-service-subscriptions-tic.md) |
| `POST` | `/market-data-service/subscriptions/resubscribe` | Nessuno; unsubscribe/subscribe completo. | [Apri](./market-data-service-endpoint-04-post-market-data-service-subscriptions-resub.md) |
| `GET` | `/market-data-service/fields` | Nessuno; campi market data attivi. | [Apri](./market-data-service-endpoint-05-get-market-data-service-fields.md) |
| `POST` | `/market-data-service/fields` | Body `fields: string[]`; aggiorna campi e forza resubscribe. | [Apri](./market-data-service-endpoint-06-post-market-data-service-fields.md) |
| `GET` | `/market-data-service/ibkr/status` | Nessuno; stato connessione IBKR/WS/snapshot loop. | [Apri](./market-data-service-endpoint-07-get-market-data-service-ibkr-status.md) |
| `GET` | `/market-data-service/snapshot/loop` | Nessuno; stato loop snapshot. | [Apri](./market-data-service-endpoint-08-get-market-data-service-snapshot-loop.md) |
| `POST` | `/market-data-service/snapshot/loop` | Body `intervalMs` (>=10000); avvia loop snapshot. | [Apri](./market-data-service-endpoint-09-post-market-data-service-snapshot-loop.md) |
| `DELETE` | `/market-data-service/snapshot/loop` | Nessuno; stop loop snapshot. | [Apri](./market-data-service-endpoint-10-delete-market-data-service-snapshot-loop.md) |
| `PUT` | `/market-data-service/snapshot/interval` | Body `intervalMs` (>=60000); persiste nuovo intervallo. | [Apri](./market-data-service-endpoint-11-put-market-data-service-snapshot-interval.md) |
