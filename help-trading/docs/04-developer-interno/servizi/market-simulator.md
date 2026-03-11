---
sidebar_position: 17
---

# market-simulator

Questa pagina è l'hub API del microservizio `market-simulator`.

## Endpoint disponibili

| Metodo | Path | Descrizione | Dettaglio |
|---|---|---|---|
| `POST` | `/market-simulator/session` | Body `startDate`, `endDate`, `tf?`, `dataSource?`; configura sessione. | [Apri](./market-simulator-endpoint-01-post-market-simulator-session.md) |
| `GET` | `/market-simulator/session` | Nessuno; stato corrente della sessione. | [Apri](./market-simulator-endpoint-02-get-market-simulator-session.md) |
| `DELETE` | `/market-simulator/session` | Nessuno; ferma sessione e svuota tickers. | [Apri](./market-simulator-endpoint-03-delete-market-simulator-session.md) |
| `POST` | `/market-simulator/session/tick` | Nessuno; avanza di un passo e pubblica snapshot su Redis. | [Apri](./market-simulator-endpoint-04-post-market-simulator-session-tick.md) |
| `POST` | `/market-simulator/subscriptions` | Body `tickers: string[]`; iscrive ticker. | [Apri](./market-simulator-endpoint-05-post-market-simulator-subscriptions.md) |
| `GET` | `/market-simulator/subscriptions` | Nessuno; ticker attualmente iscritti. | [Apri](./market-simulator-endpoint-06-get-market-simulator-subscriptions.md) |
| `DELETE` | `/market-simulator/subscriptions` | Nessuno; svuota tutte le sottoscrizioni. | [Apri](./market-simulator-endpoint-07-delete-market-simulator-subscriptions.md) |
| `DELETE` | `/market-simulator/subscriptions/:symbol` | Path `symbol`; rimuove un ticker. | [Apri](./market-simulator-endpoint-08-delete-market-simulator-subscriptions-symbol.md) |
| `GET` | `/market-simulator/candle` | Query `symbol`, `date`, `tf?`, `source?`; singola candela. | [Apri](./market-simulator-endpoint-09-get-market-simulator-candle.md) |
| `GET` | `/market-simulator/candle/range` | Query `symbol`, `startDate`, `endDate`, `tf?`; range candele. | [Apri](./market-simulator-endpoint-10-get-market-simulator-candle-range.md) |
| `POST` | `/market-simulator/candle/push` | Body `symbol`, `candle`; inietta candela custom come snapshot. | [Apri](./market-simulator-endpoint-11-post-market-simulator-candle-push.md) |
