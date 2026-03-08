---
sidebar_position: 3
---

# Implementazione per file

## Struttura principale

- `tickerScanner/server.js`
- `tickerScanner/modules/main.js`
- `tickerScanner/routes/scanner.js`
- `tickerScanner/routes/userScores.js`
- `tickerScanner/routes/marketDaily.js`
- `tickerScanner/routes/tickerData.js`
- `tickerScanner/routes/universe.js`
- `tickerScanner/routes/rankingRoutes.js`
- `tickerScanner/routes/userData.js`

## Moduli dominio

- `tickerScanner/modules/screenerService.js`
- `tickerScanner/modules/fmpFundamentalsService.js`
- `tickerScanner/modules/fundamentalsService.js`
- `tickerScanner/modules/scoringService.js`
- `tickerScanner/modules/momentumCalculator.js`
- `tickerScanner/modules/scanJob.js`
- `tickerScanner/modules/rateLimiter.js`

## Librerie locali supporto

- `tickerScanner/lib/marketDailyService.js`
- `tickerScanner/lib/userDailyService.js`
- `tickerScanner/lib/filterEngine.js`
- `tickerScanner/lib/weightsConfig.js`
- `tickerScanner/lib/scoreDecorator.js`
- `tickerScanner/lib/universeService.js`
- `tickerScanner/lib/rankingDailyService.js`

## Ruolo dei file

### `server.js`

- usa `createMicroserviceServer` shared;
- monta router scanner/fundamentals/user;
- monta route interna `/internal/fundamentals/*` per scheduler.

### `modules/main.js`

- implementa classe `TickerScanner` estesa da `BaseService`;
- inizializza servizi di dominio e client datahub;
- espone API applicative per scan, score, refresh momentum e job status.

### `routes/scanner.js`

- endpoint operativi scanner (`/scan`, `/scan/status`, `/momentum/refresh`);
- gestione async job + report stato completion.

### `routes/userScores.js`

- job user daily score e CRUD `user_daily_score_jobs`;
- endpoint interno `buildInternalUserScoresRouter` con `verifyInternalToken`.

### `routes/marketDaily.js`

- job market daily async;
- confronto date mercato (`/market-daily/compare`);
- CRUD `market_daily_jobs`.

### `routes/tickerData.js`

- CRUD `ticker_scan_jobs`;
- endpoint `history` e query su `scores_daily`.

### `routes/universe.js`

- CRUD `universe` (GET lista, GET singolo simbolo);
- avvio/cancellazione job Universe scan (Fase 1);
- stato job per `jobId`.

### `routes/rankingRoutes.js`

- `POST /ranking/daily` — avvia la Fase 4: legge `daily_scores`, applica filtri/bucket, scrive in `AST_RANKING_DAILY`;
- `GET /ranking/daily?score_date=YYYY-MM-DD` — legge snapshot ranking per una data.

### `lib/rankingDailyService.js`

- `createRankingDailyService({ logger, datahubAxios })` — factory stateless;
- `buildDailyRankingSnapshot({ scoreDate, mode, limits, filters })` — logica completa di Fase 4: fetch paginato da `daily_scores` + `universe`, join, filtri, bucketing, ranking, scrittura concorrente su `AST_RANKING_DAILY`;
- `getRanking(scoreDate)` — lettura snapshot con ordinamento client-side.

### `lib/universeService.js`

- `createUniverseScanService({ logger, datahubAxios, fmpFundamentals, screener })`;
- `scanUniverse(filterOverrides, options)` — Fase 1: screener FMP, fetch fondamentali, upsert in `universe`.

### `routes/userData.js`

- preferenze utente (filtri, ordinamenti, pesi, viste);
- API aggregate orientate al frontend;
- contiene path dinamici, per questo è l'ultimo router montato.

## Note implementative utili

- Compatibilita URL datahub: `DATAHUB_URL` preferito, fallback `DBMANAGER_URL`.
- Autenticazione utente risolta via `authservice` (token/API key -> `userId`).
- Route interne validate con token service-to-service (`x-internal-token`).
