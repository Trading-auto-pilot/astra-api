---
sidebar_position: 1
---

# Architettura e flussi

## Componenti principali

- `server.js`: bootstrap via `shared/serverFactory`;
- `modules/main.js`: classe `TickerScanner` (estende `BaseService`), wiring servizi e job services;
- `routes/*.js`: esposizione API scanner/fundamentals/user;
- `modules/*Service.js`: logica applicativa (screener, fundamentals, scoring, momentum);
- `lib/marketDailyService.js` e `lib/userDailyService.js`: orchestrazione job giornalieri.

## Flusso scanner

1. Il client invoca `/scan` o `/scan/force`.
2. Viene creato job async in memoria (`scanJob.js`).
3. Il servizio esegue screener, recupera dati fundamentals, calcola score e momentum.
4. Salva/aggiorna dati su datahub (`fundamentals`, storico, job tables).
5. Espone stato job su endpoint `/scan/status/:jobId`.

## Flusso market/user daily

- `POST /fundamentals/update-market-daily`: aggiorna dataset giornaliero mercato.
- `POST /fundamentals/user-daily-scores`: calcola score giornalieri utente/pipeline.
- Entrambi i flussi sono asincroni e pubblicano stato/telemetria su Redis.

## Flusso ranking giornaliero (Fase 4)

- `POST /fundamentals/ranking/daily`: flusso **sincrono** che:
  1. Legge `daily_scores` da datahub (paginato, per `score_date`)
  2. Legge `universe` per arricchire con `is_etf`, `market_cap`, `sector`, `country`
  3. Applica filtri opzionali (`min_dollar_vol`, `min_total_score`, ecc.)
  4. Raggruppa per bucket (`LARGECAP`, `MIDCAP`, `SMALLCAP`, `ETF_GENERAL`)
  5. Ordina per `total_score DESC`, applica limiti per bucket
  6. Scrive top-N in `AST_RANKING_DAILY` con 10 POST paralleli

- `GET /fundamentals/ranking/daily?score_date=...`: lettura snapshot con ordinamento client-side per bucket e rank_position.
- Idempotente: mode `normal` salta se dati esistono, mode `force` cancella e ricalcola.

## Integrazioni principali

- `datahub`: persistenza score, job history, dati fundamentals;
- `authservice`: risoluzione `userId` da token/API key;
- `cachemanager`: supporto dati di mercato e cache applicativa;
- FMP API: dataset esterni (screener/fundamentals).

## Endpoint interni e sicurezza

`tickerscanner` espone endpoint interno per job schedulati:

- `POST /internal/fundamentals/user-daily-scores`

Questa route richiede `x-internal-token` valido.

Riferimento:

- [Autenticazione interna tra microservizi](./ms-authservice-autenticazione-interna.md)
