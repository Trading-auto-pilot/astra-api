---
sidebar_position: 12
---


# tickerscanner

Questa pagina e l'hub API del microservizio `tickerscanner`.

## Endpoint disponibili

| Metodo | Path | Descrizione | Dettaglio |
|---|---|---|---|
| `POST` | `/tickerscanner/fundamentals/ranking/daily` | Body `{ score_date, mode?, limits?, filters? }`; genera snapshot ranking. Sincrono. | [Apri](./tickerscanner-endpoint-01-post-tickerscanner-fundamentals-ranking-dail.md) |
| `GET` | `/tickerscanner/fundamentals/ranking/daily` | Query `score_date` (YYYY-MM-DD); legge snapshot per data. | [Apri](./tickerscanner-endpoint-02-get-tickerscanner-fundamentals-ranking-daily.md) |
| `POST` | `/tickerscanner/universe/scan` | Body opzionale filtri; avvia scan solo sui simboli non ancora in `universe`. | [Apri](./tickerscanner-endpoint-03-post-tickerscanner-universe-scan.md) |
| `POST` | `/tickerscanner/universe/scan/force` | Body opzionale filtri; forza ricalcolo su tutti i simboli. | [Apri](./tickerscanner-endpoint-04-post-tickerscanner-universe-scan-force.md) |
| `GET` | `/tickerscanner/universe/scan/jobs` | Nessuno; lista job universe attivi. | [Apri](./tickerscanner-endpoint-05-get-tickerscanner-universe-scan-jobs.md) |
| `GET` | `/tickerscanner/universe/scan/status/:jobId` | Path `jobId`; stato di un job universe specifico. | [Apri](./tickerscanner-endpoint-06-get-tickerscanner-universe-scan-status-jobid.md) |
| `DELETE` | `/tickerscanner/universe/scan/jobs/:jobId` | Path `jobId`; cancella job universe in corso. | [Apri](./tickerscanner-endpoint-07-delete-tickerscanner-universe-scan-jobs-jobi.md) |
| `GET` | `/tickerscanner/universe` | Query `limit`, `offset`; lista tutti i simboli in `universe`. | [Apri](./tickerscanner-endpoint-08-get-tickerscanner-universe.md) |
| `GET` | `/tickerscanner/universe/:symbol` | Path `symbol`; record singolo (es. `AAPL`). | [Apri](./tickerscanner-endpoint-09-get-tickerscanner-universe-symbol.md) |
| `GET` | `/tickerscanner/screener` | Nessuno; risultati screener correnti. | [Apri](./tickerscanner-endpoint-10-get-tickerscanner-screener.md) |
| `GET` | `/tickerscanner/scan` | Query opzionali scanner; avvio/lettura scan. | [Apri](./tickerscanner-endpoint-11-get-tickerscanner-scan.md) |
| `GET` | `/tickerscanner/scan/force` | Query scanner; forza nuova esecuzione. | [Apri](./tickerscanner-endpoint-12-get-tickerscanner-scan-force.md) |
| `GET` | `/tickerscanner/scan/status/:jobId` | Path `jobId`; stato job scan. | [Apri](./tickerscanner-endpoint-13-get-tickerscanner-scan-status-jobid.md) |
| `GET` | `/tickerscanner/scan/jobs` | Nessuno; lista job scan. | [Apri](./tickerscanner-endpoint-14-get-tickerscanner-scan-jobs.md) |
| `DELETE` | `/tickerscanner/scan/jobs/:jobId` | Path `jobId`; cancella job scan. | [Apri](./tickerscanner-endpoint-15-delete-tickerscanner-scan-jobs-jobid.md) |
| `POST` | `/tickerscanner/momentum/refresh` | Body opzionale filtri; refresh dati momentum. | [Apri](./tickerscanner-endpoint-16-post-tickerscanner-momentum-refresh.md) |
| `GET` | `/tickerscanner/glossary/:fileName` | Path `fileName`; serve glossario/static JSON. | [Apri](./tickerscanner-endpoint-17-get-tickerscanner-glossary-filename.md) |
| `POST` | `/tickerscanner/fundamentals/update-market-daily` | Body opzionale; avvia job aggiornamento prezzi EOD (`market_daily`). | [Apri](./tickerscanner-endpoint-18-post-tickerscanner-fundamentals-update-marke.md) |
| `GET` | `/tickerscanner/fundamentals/update-market-daily` | Nessuno; lista job market daily attivi. | [Apri](./tickerscanner-endpoint-19-get-tickerscanner-fundamentals-update-market.md) |
| `DELETE` | `/tickerscanner/fundamentals/update-market-daily/:jobId` | Path `jobId`; cancella job market daily. | [Apri](./tickerscanner-endpoint-20-delete-tickerscanner-fundamentals-update-mar.md) |
| `GET` | `/tickerscanner/fundamentals/market-daily/compare` | Query `symbol`, `date`; confronto prezzi EOD. | [Apri](./tickerscanner-endpoint-21-get-tickerscanner-fundamentals-market-daily-.md) |
| `CRUD` | `/tickerscanner/fundamentals/market-daily-jobs` | Path `:id` su GET/PUT/DELETE; body definizione job. | [Apri](./tickerscanner-endpoint-22-crud-tickerscanner-fundamentals-market-daily.md) |
| `POST` | `/tickerscanner/fundamentals/user-daily-scores` | Body `userId`, `pipeId`, `scoreDate`; avvia job score utente. | [Apri](./tickerscanner-endpoint-23-post-tickerscanner-fundamentals-user-daily-s.md) |
| `GET` | `/tickerscanner/fundamentals/user-daily-scores` | Nessuno; lista job user daily score attivi. | [Apri](./tickerscanner-endpoint-24-get-tickerscanner-fundamentals-user-daily-sc.md) |
| `DELETE` | `/tickerscanner/fundamentals/user-daily-scores/:jobId` | Path `jobId`; cancella job score utente. | [Apri](./tickerscanner-endpoint-25-delete-tickerscanner-fundamentals-user-daily.md) |
| `GET` | `/tickerscanner/fundamentals/jobs` | Nessuno; aggregato job attivi (market + user). | [Apri](./tickerscanner-endpoint-26-get-tickerscanner-fundamentals-jobs.md) |
| `CRUD` | `/tickerscanner/fundamentals/user-daily-score-jobs` | Path `:id` su GET/PUT/DELETE; body definizione job. | [Apri](./tickerscanner-endpoint-27-crud-tickerscanner-fundamentals-user-daily-s.md) |
| `CRUD` | `/tickerscanner/fundamentals/ticker-scan-jobs` | Path `:id` su GET/PUT/DELETE; body definizione job. | [Apri](./tickerscanner-endpoint-28-crud-tickerscanner-fundamentals-ticker-scan-.md) |
| `GET` | `/tickerscanner/fundamentals/history` | Query `symbol`; storico scan. | [Apri](./tickerscanner-endpoint-29-get-tickerscanner-fundamentals-history.md) |
| `GET` | `/tickerscanner/fundamentals/scores-daily/counts/:pipeId` | Path `pipeId`; conteggio score per pipe. | [Apri](./tickerscanner-endpoint-30-get-tickerscanner-fundamentals-scores-daily-.md) |
| `GET` | `/tickerscanner/fundamentals/scores-daily/by-user/:pipeId/:scoreDate` | Path `pipeId`, `scoreDate`; score utente per data. | [Apri](./tickerscanner-endpoint-31-get-tickerscanner-fundamentals-scores-daily--2.md) |
| `POST` | `/tickerscanner/internal/fundamentals/user-daily-scores` | Header `x-internal-token`; trigger interno scheduler. | [Apri](./tickerscanner-endpoint-32-post-tickerscanner-internal-fundamentals-use.md) |
| `GET` | `/tickerscanner/release` | Info versione. | [Apri](./tickerscanner-endpoint-33-get-tickerscanner-release.md) |
| `GET` | `/tickerscanner/settings` | Configurazione corrente. | [Apri](./tickerscanner-endpoint-34-get-tickerscanner-settings.md) |
| `PUT` | `/tickerscanner/settings` | Body JSON; aggiorna settings. | [Apri](./tickerscanner-endpoint-35-put-tickerscanner-settings.md) |
| `POST` | `/tickerscanner/settings/reload` | Ricarica settings da Redis. | [Apri](./tickerscanner-endpoint-36-post-tickerscanner-settings-reload.md) |
| `PUT` | `/tickerscanner/connect` | Riconnette al DB. | [Apri](./tickerscanner-endpoint-37-put-tickerscanner-connect.md) |
| `DELETE` | `/tickerscanner/connect` | Disconnette dal DB. | [Apri](./tickerscanner-endpoint-38-delete-tickerscanner-connect.md) |
| `GET` | `/tickerscanner/dbLogger` | Stato DB logger. | [Apri](./tickerscanner-endpoint-39-get-tickerscanner-dblogger.md) |
| `PUT` | `/tickerscanner/dbLogger/:status` | Path `status` (`on`/`off`); abilita/disabilita. | [Apri](./tickerscanner-endpoint-40-put-tickerscanner-dblogger-status.md) |
| `GET` | `/tickerscanner/status/health` | Health check. | [Apri](./tickerscanner-endpoint-41-get-tickerscanner-status-health.md) |
| `GET` | `/tickerscanner/status/info` | Info servizio. | [Apri](./tickerscanner-endpoint-42-get-tickerscanner-status-info.md) |
| `GET` | `/tickerscanner/status/metrics` | Metriche. | [Apri](./tickerscanner-endpoint-43-get-tickerscanner-status-metrics.md) |
| `GET` | `/tickerscanner/status/logLevel` | Livello log corrente. | [Apri](./tickerscanner-endpoint-44-get-tickerscanner-status-loglevel.md) |
| `PUT` | `/tickerscanner/status/logLevel` | Body `{ level }`; imposta livello log. | [Apri](./tickerscanner-endpoint-45-put-tickerscanner-status-loglevel.md) |
| `GET` | `/tickerscanner/status/communicationChannels` | Canali Redis attivi. | [Apri](./tickerscanner-endpoint-46-get-tickerscanner-status-communicationchanne.md) |
| `PUT` | `/tickerscanner/status/communicationChannels` | Body canali; aggiorna canali. | [Apri](./tickerscanner-endpoint-47-put-tickerscanner-status-communicationchanne.md) |
