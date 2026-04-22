---
sidebar_position: 2
title: Stato dei Lavori
---

# Stato dei Lavori — Simulator Implementation

> Ultima modifica: 3 aprile 2026
> Riferimento architetturale: [Piano Implementativo Completo](./market-simulator-implementation)

Legenda: ✅ Completato · 🔄 In corso · ⬜ Da fare

---

## Parte 1 — Refactoring Microservizi Esistenti

Adattamento dei microservizi esistenti per supportare la simulazione senza alterare la logica di produzione. Prerequisito bloccante per qualsiasi esecuzione simulata corretta.

---

### 1.1 SimClock — Modulo Condiviso

Creazione di `shared/simClock.js`: singleton che in live mode restituisce `Date.now()`, in sim mode restituisce il timestamp dell'ultima candle ricevuta da sim-engine.

| # | Task | Stato |
|---|------|-------|
| 1.1.1 | Creare `shared/simClock.js` con metodi `now()`, `inject(ts)`, `dayOf()`, `hourOf()`, `toDate()` | ✅ |
| 1.1.2 | Sostituire `Date.now()` di business logic in `decision-engine/modules/live-manager.js` (36 occorrenze: TTL cache earnings/calendar, cooldown alert, guard timing) | ✅ |
| 1.1.3 | Sostituire `Date.now()` in `decision-engine/modules/main.js` (1 occorrenza) | ✅ |
| 1.1.4 | Sostituire `Date.now()` in `decision-engine/modules/job-manager.js` (1 occorrenza) | ✅ |
| 1.1.5 | Sostituire `Date.now()` in `liquidity-manager/providers/spyProviderCachemanager.js` (2 occorrenze: calcolo lookback window date) | ✅ |
| 1.1.6 | Sostituire `Date.now()` in `liquidity-manager/providers/vixProvider.js`, `dxyProvider.js`, `creditProvider.js` (1 occorrenza ciascuno) | ✅ |
| 1.1.7 | Sostituire `Date.now()` in `liquidity-manager/modules/tasks/recomputeTaskManager.js` (2 occorrenze) | ✅ |
| 1.1.8 | Sostituire `Date.now()` in `capital-manager/modules/store/reservationsStore.js` (1 occorrenza: TTL prenotazioni) | ✅ |

> **Non sostituire** i `Date.now()` nei moduli HTTP (`rateLimiter`, `circuitBreaker`, `httpClient`, `yahooHttpClient`): misurano latenza di rete reale, non business time.

---

### 1.2 Routing Simulato via Env Var

Il decision-engine usa già `MARKETDATASERVICE_URL` e `BROKER_EXECUTOR_IBKR_URL` per indirizzare le chiamate. In simulazione questi puntano a `sim-engine`. **Nessuna modifica al codice necessaria** — solo configurazione docker-compose separata.

| # | Task | Stato |
|---|------|-------|
| 1.2.1 | Verificare che decision-engine legga correttamente `MARKETDATASERVICE_URL` e `BROKER_EXECUTOR_IBKR_URL` senza fallback hardcoded | ✅ |
| 1.2.2 | Creare `docker-compose.sim.yml` con override delle URL verso `sim-engine` | ✅ |

---

### 1.3 Liquidity Manager — Endpoint di Backfill

La tabella `liquidity_index_daily` esiste già ed è popolata dal processo di schedulazione giornaliero. Serve un nuovo endpoint che esegua il backfill retroattivo con warm-up 30 giorni per stabilizzare l'EMA iniziale.

| # | Task | Stato |
|---|------|-------|
| 1.3.1 | Implementare `POST /liquidity-manager/admin/backfill?from=YYYY-MM-DD&to=YYYY-MM-DD` | ✅ |
| 1.3.2 | Logica warm-up: 250 giorni precedenti a `from` per stabilizzare SMA(200) ed EMA prima del periodo richiesto | ✅ |
| 1.3.3 | Scrivere risultati su `liquidity_daily_scores` con upsert (non sovrascrivere dati live esistenti, source="backfill") | ✅ |
| 1.3.4 | Test: backfill 18 mesi, verificare coerenza EMA con valori live | ✅ |

---

### 1.4 SimScheduler — Trigger Event-Driven in Sync Mode

Il decision-engine non ha cron interni (delega a un servizio scheduler esterno). In sync mode il SimScheduler deve poter iniettare i trigger `eod`, `bod`, `market-close` via HTTP POST invece di Redis pub/sub.

| # | Task | Stato |
|---|------|-------|
| 1.4.1 | Verificare quali endpoint/canali Redis il decision-engine ascolta per i trigger di scheduling | ✅ |
| 1.4.2 | Aggiungere supporto HTTP POST per gli stessi trigger (usato solo in sync mode) | ✅ |
| 1.4.3 | Garantire che in live mode il comportamento rimanga invariato | ✅ |

---

## Parte 2 — Implementazione del Simulatore

Sviluppo del nuovo microservizio `simulator` (rename da `market-simulator`) e di tutti i componenti di simulazione.

---

### 2.1 Rename market-simulator → simulator

| # | Task | Stato |
|---|------|-------|
| 2.1.1 | Rinominare directory `market-simulator/` → `simulator/` | ✅ |
| 2.1.2 | Aggiornare `Dockerfile`, `package.json`, `release.json` e nome immagine Docker | ✅ |
| 2.1.3 | Aggiornare `docker-compose.local.yml`, `docker-compose.yml`, `docker-compose.sim.yml` | ✅ |
| 2.1.4 | Aggiornare variabile `MARKET_SIMULATOR_VERSION` → `SIMULATOR_VERSION` in deploy workflow e `.env.*` | ✅ |
| 2.1.5 | Aggiornare riferimenti interni: `server.js`, `modules/main.js`, `doc/ports.json` | ✅ |

---

### 2.2 sim-engine — Moduli Core

Estensione del microservizio esistente con i moduli mancanti. Il `candleFetcher` e `sessionState` esistono già parzialmente.

| # | Task | Stato |
|---|------|-------|
| 2.2.1 | **fillEngine**: logica fill ordini con slippage configurabile, commissioni, MIN/MAX price check | ✅ |
| 2.2.2 | **accountState**: gestione cash, posizioni aperte, NAV mark-to-market, P&L running | ✅ |
| 2.2.3 | Estendere `sessionState` per supportare SimClock e le tre modalità (sync/passive/inject) | ✅ |
| 2.2.4 | Estendere `candleFetcher` con `preload()`/`getCached()` per range query storiche (sync mode) | ✅ |

---

### 2.3 sim-engine — API Routes

Esposizione dei due prefissi che replicano i servizi reali + endpoint di controllo simulazione.

| # | Task | Stato |
|---|------|-------|
| 2.3.1 | `/subscriptions` esistente + nota: DE legge candle da cachemanager (non market-data-service) | ✅ |
| 2.3.2 | Route `/order`, `/orders`, `/positions` — replica broker-executor-ibkr (montato a root) | ✅ |
| 2.3.3 | `POST /sim/start` — preload candles, init accountState, configura sessione sync | ✅ |
| 2.3.4 | `POST /sim/tick` — fill ordini pendenti, mark-to-market, avanza SimClock | ✅ |
| 2.3.5 | `POST /sim/stop` — finalizza run, ritorna KPI (persistenza DB in task 2.4) | ✅ |
| 2.3.6 | `GET /sim/status` — progress %, session snapshot, account snapshot | ✅ |
| 2.3.7 | `GET /sim/results/:runId` — ultimi KPI in-memory (persistenza DB in task 2.4) | ✅ |

---

### 2.4 Database Schema — Schema Simul

Le tabelle vengono create nello schema `Simul` nel datahub. Completamente trasparente agli altri microservizi: datahub è l'unica interfaccia di accesso.

| # | Task | Stato |
|---|------|-------|
| 2.4.1 | Tabella `sim_runs`: metadati sessione, config snapshot, capital iniziale/finale, KPI aggregati (Sharpe, Sortino, Calmar, max drawdown, win rate, profit factor, expectancy) | ✅ |
| 2.4.2 | Tabella `sim_trades`: trade individuali con entry/exit date+price, P&L, MAE/MFE, holding duration, exit reason, liquidity context at entry | ✅ |
| 2.4.3 | Tabella `sim_daily_snapshots`: snapshot EOD — valore portafoglio, cash, P&L giornaliero, drawdown %, trade count, capital manager state | ✅ |
| 2.4.4 | Tabella `sim_ticker_stats`: per-ticker win rate, P&L totale, avg return, avg holding, contributo al risultato complessivo | ✅ |
| 2.4.5 | Aggiungere endpoint datahub per le 4 tabelle (GET/POST/schema) | ✅ |

---

### 2.5 Modalità Operative

| # | Task | Stato |
|---|------|-------|
| 2.5.1 | **Sync Mode** (priorità): `POST /sim/tick` sincrono, nessun timer, nessun Redis — anni simulati in secondi | ✅ |
| 2.5.2 | **Passive Mode**: decision-engine fa `GET /candle` on-demand — utile per debug step-by-step | ✅ |
| 2.5.3 | **Inject Mode**: sim-engine pubblica candle su Redis a intervalli (50-100x) — decision-engine consuma come live | ✅ |

---

### 2.6 Infrastructure Spot (bassa priorità)

| # | Task | Stato |
|---|------|-------|
| 2.6.1 | Script provisioning spot instance on-demand | ⬜ |
| 2.6.2 | Cloudflare Tunnel per monitoring remoto (`simul.trading.expovin.it`) | ⬜ |
| 2.6.3 | Copia read-only cachemanager sull'istanza spot | ⬜ |
| 2.6.4 | Docker tag con commit hash (`SIMUL-{hash}`) per riproducibilità | ⬜ |
| 2.6.5 | Teardown sicuro: attende `sim_runs.status = 'COMPLETED'` prima di terminare | ⬜ |

---

### 2.7 Parameter Sweep (bassa priorità)

| # | Task | Stato |
|---|------|-------|
| 2.7.1 | Supporto varianti parallele su configurazioni diverse | ⬜ |
| 2.7.2 | Aggregazione risultati multi-run per confronto parametri | ⬜ |

---

## Riepilogo Avanzamento

| Sezione | Completati | Totale | % |
|---------|-----------|--------|---|
| 1.1 SimClock | 8 | 8 | 100% |
| 1.2 Routing simulato | 2 | 2 | 100% |
| 1.3 Liquidity backfill | 4 | 4 | 100% |
| 1.4 SimScheduler | 3 | 3 | 100% |
| 2.1 Rename simulator | 5 | 5 | 100% |
| 2.2 sim-engine core | 4 | 4 | 100% |
| 2.3 sim-engine API | 7 | 7 | 100% |
| 2.4 DB Schema | 5 | 5 | 100% |
| 2.5 Modalità operative | 3 | 3 | 100% |
| 2.6 Infra spot | 0 | 5 | 0% |
| 2.7 Parameter sweep | 0 | 2 | 0% |
| **Totale** | **41** | **48** | **85%** |
