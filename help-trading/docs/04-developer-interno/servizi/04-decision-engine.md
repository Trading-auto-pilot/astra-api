---
sidebar_position: 5
---


# decision-engine

Questa pagina e l'hub API del microservizio `decision-engine`.

## Endpoint disponibili

| Metodo | Path | Descrizione | Dettaglio |
|---|---|---|---|
| `GET` | `/decision-engine/spot-finder` | Query: `ticker` obbligatorio + parametri tuning strategia. | [Apri](./decision-engine-endpoint-01-get-decision-engine-spot-finder.md) |
| `GET` | `/decision-engine/spot-finder/:pipeId` | Path `pipeId`; esecuzione sincrona pipeline. | [Apri](./decision-engine-endpoint-02-get-decision-engine-spot-finder-pipeid.md) |
| `POST` | `/decision-engine/spot-finder/:pipeId` | Path `pipeId`; avvio job asincrono. | [Apri](./decision-engine-endpoint-03-post-decision-engine-spot-finder-pipeid.md) |
| `GET` | `/decision-engine/spot-finder/jobs/:jobId` | Path `jobId`; query `limit` opzionale. | [Apri](./decision-engine-endpoint-04-get-decision-engine-spot-finder-jobs-jobid.md) |
| `POST` | `/decision-engine/spot-finder/jobs/:jobId/stop` | Path `jobId`; stop job in esecuzione. | [Apri](./decision-engine-endpoint-05-post-decision-engine-spot-finder-jobs-jobid-.md) |
| `GET` | `/decision-engine/spot-finder/latest/:pipeId` | Path `pipeId`; ultimo snapshot calcolato. | [Apri](./decision-engine-endpoint-06-get-decision-engine-spot-finder-latest-pipei.md) |
| `POST` | `/decision-engine/spot-finder/live/:pipeId` | Path `pipeId`; abilita/disabilita live mode. | [Apri](./decision-engine-endpoint-07-post-decision-engine-spot-finder-live-pipeid.md) |
| `GET` | `/decision-engine/spot-finder/live/:pipeId` | Path `pipeId`; avvio live asincrono. | [Apri](./decision-engine-endpoint-08-get-decision-engine-spot-finder-live-pipeid.md) |
| `GET` | `/decision-engine/spot-finder/live/:pipeId/status` | Path `pipeId`; stato live corrente. | [Apri](./decision-engine-endpoint-09-get-decision-engine-spot-finder-live-pipeid-.md) |
| `DELETE` | `/decision-engine/spot-finder/live/:pipeId` | Path `pipeId`; stop live e unsubscribe. | [Apri](./decision-engine-endpoint-10-delete-decision-engine-spot-finder-live-pipe.md) |
| `POST` | `/decision-engine/internal/spot-finder/:pipeId` | Header `x-internal-token`; trigger interno (scheduler). | [Apri](./decision-engine-endpoint-11-post-decision-engine-internal-spot-finder-pi.md) |
| `POST` | `/decision-engine/internal/spot-finder/live/:pipeId` | Header `x-internal-token`; avvio live interno. | [Apri](./decision-engine-endpoint-12-post-decision-engine-internal-spot-finder-li.md) |
| `DELETE` | `/decision-engine/internal/spot-finder/live/:pipeId` | Header `x-internal-token`; stop live interno. | [Apri](./decision-engine-endpoint-13-delete-decision-engine-internal-spot-finder-.md) |
