---
sidebar_position: 15
---


# liquidity-manager

Questa pagina e l'hub API del microservizio `liquidity-manager`.

## Endpoint disponibili

| Metodo | Path | Descrizione | Dettaglio |
|---|---|---|---|
| `GET` | `/liquidity-manager/liquidity-score` | Query opzionali contesto/provider; ritorna score corrente. | [Apri](./liquidity-manager-endpoint-01-get-liquidity-manager-liquidity-score.md) |
| `POST` | `/liquidity-manager/liquidity-score/recompute` | Body opzionale per forzare recompute e policy sorgenti. | [Apri](./liquidity-manager-endpoint-02-post-liquidity-manager-liquidity-score-recom.md) |
| `GET` | `/liquidity-manager/liquidity-score/history` | Query `days` (es. 30); storico score. | [Apri](./liquidity-manager-endpoint-03-get-liquidity-manager-liquidity-score-histor.md) |
| `GET` | `/liquidity-manager/liquidity-score/providers/status` | Nessuno; stato provider e freshness dati. | [Apri](./liquidity-manager-endpoint-04-get-liquidity-manager-liquidity-score-provid.md) |
| `GET` | `/liquidity-manager/liquidity-score/tasks` | Query opzionali stato/task type; elenco task asincroni. | [Apri](./liquidity-manager-endpoint-05-get-liquidity-manager-liquidity-score-tasks.md) |
| `GET` | `/liquidity-manager/liquidity-score/tasks/:taskId` | Path `taskId`; dettaglio task. | [Apri](./liquidity-manager-endpoint-06-get-liquidity-manager-liquidity-score-tasks-.md) |
| `GET` | `/liquidity-manager/health` | Nessuno; alias health rapido per orchestratori. | [Apri](./liquidity-manager-endpoint-07-get-liquidity-manager-health.md) |
