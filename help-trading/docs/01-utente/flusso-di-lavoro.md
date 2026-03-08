---
sidebar_position: 2
---

# Flusso di lavoro

Questa pagina definisce il modello operativo completo delle fasi di lavorazione. Attualmente sono attive **7 fasi**.

## Schema a blocchi (pipeline)

```text
[Fase 1] --> [Fase 2] --> [Fase 3] --> [Fase 4] --> [Fase 5] --> [Fase 6] --> [Fase 7]
   |            |            |            |            |            |            |
   v            v            v            v            v            v            v
universe    daily_scores  scores_daily  AST_RANKING  Redis snap.  ENTRY_SIGNAL  ORDINE
            market_daily               _DAILY        livelli oper. su hooks ch.  su broker
```

## Catalogo fasi

| Fase | Stato | Scopo | Punto di partenza (input) | Deliverable (output) | Microservizi principali |
|---|---|---|---|---|---|
| 1 | Attiva | Costruire l'universo strumenti | API FMP + cataloghi simboli | `universe` | `tickerscanner` |
| 2 | Attiva | Calcolare indicatori e score di sistema | `universe` + `market_daily` | `daily_scores` | `tickerscanner`, `cachemanager` |
| 3 | Attiva | Personalizzare score per utente/pipe | `daily_scores` + config utente | `scores_daily` | `tickerscanner` |
| 4 | Attiva | Ranking globale per bucket | `daily_scores` | `AST_RANKING_DAILY` | `tickerscanner` |
| 5 | Attiva | Analisi tecnica e segnali di ingresso | `AST_RANKING_DAILY` + candlestick | Snapshot Redis (livelli operativi per ticker) | `decision-engine`, `cachemanager` |
| 6 | Attiva | Monitoraggio live e segnali di ingresso in tempo reale | Snapshot Redis (Fase 5) + tick live `market-data-service` + score `liquidity-manager` | `ENTRY_SIGNAL` su canale Redis `{ENV}.hooks` | `decision-engine`, `cachemanager`, `liquidity-manager` |
| 7 | Attiva | Guardrail multi-livello e invio ordine a broker | `ENTRY_SIGNAL` (Fase 6) + guardrail macro/eventi + verifica account IBKR + capital manager | Ordine bracket su `brokerExecutor-ibkr` (PAPER only) | `decision-engine`, `brokerExecutor-ibkr`, `ibkr-bridge`, `capital-manager` |

## Matrice coinvolgimento microservizi

Questa matrice serve a chiarire che in futuro una fase puo coinvolgere piu microservizi e che lo stesso microservizio puo ricomparire in fasi non consecutive.

| Microservizio | F1 | F2 | F3 | F4 | F5 | F6 | F7 |
|---|---|---|---|---|---|---|---|
| `tickerscanner` | X | X | X | X | src | | |
| `cachemanager` |  | X |  |  | X | X |  |
| `decision-engine` |  |  |  |  | X | X | X |
| `market-data-service` |  |  |  |  |  | X |  |
| `liquidity-manager` |  |  |  |  |  | X | X |
| `brokerExecutor-ibkr` |  |  |  |  |  |  | X |
| `ibkr-bridge` |  |  |  |  |  |  | X |
| `capital-manager` |  |  |  |  |  |  | X? |
| `scheduler` | X | X | X | X | X | X | X |
| `servicecontrolplane` |  |  |  |  | X? | X? | X? |
| `alertingservice` |  |  |  |  | X? | X | X |

_Legenda: **X** = microservizio attivo nella fase, **src** = fonte dati (non elaborazione), **X?** = probabile, da confermare._

## Contract standard di documentazione per ogni fase

Ogni pagina fase deve avere sempre le stesse sezioni:

1. `Scopo`
2. `Punto di partenza (input dati e prerequisiti)`
3. `Elaborazione`
4. `Deliverable (output dati/eventi/API)`
5. `Parametri di pilotaggio`
6. `Microservizi coinvolti`
7. `Avvio manuale e monitoraggio`
8. `Errori comuni e recovery`

Questo rende leggibile la pipeline anche quando le fasi aumentano.

## Parametri di pilotaggio (modello unico)

Per ogni fase, i parametri vanno classificati in modo consistente:

| Categoria | Esempi |
|---|---|
| Selezione perimetro | `symbols`, `bucket`, `userId`, `pipeId` |
| Tempo | `score_date`, `targetDate`, `startDate`, `endDate` |
| Modalita | `mode=normal/force`, `dryRun`, `incremental` |
| Limiti | `limit`, `topN`, soglie min/max |
| Resilienza | `retry`, `timeout`, `asyncTimeoutMs` |

## Dettaglio fasi attive

- [Fase 1: Raccolta universo](./fase-1-universe)
- [Fase 2: Indicatori e scoring](./fase-2-indicatori)
- [Fase 3: Ranking personalizzato](./fase-3-filtro)
- [Fase 4: Ranking di sistema](./fase-4-ranking)
- [Fase 5: Analisi tecnica e segnali di ingresso](./fase-5-decision-engine)
- [Fase 6: Live Daily Update e segnali in tempo reale](./fase-6-live-update)
- [Fase 7: Guardrail e invio ordine a broker](./fase-7-live-order)

## Avvio manuale (fasi attuali)

| Fase | Endpoint | Tipo risposta |
|---|---|---|
| Fase 1 (nuovi ticker) | `POST /tickerscanner/universe/scan` | Asincrona (`jobId`) |
| Fase 1 (forza tutto) | `POST /tickerscanner/universe/scan/force` | Asincrona (`jobId`) |
| Fase 2 (prezzi EOD) | `POST /tickerscanner/fundamentals/update-market-daily` | Asincrona (`jobId`) |
| Fase 3 | `POST /tickerscanner/fundamentals/user-daily-scores` | Asincrona (`jobId`) |
| Fase 4 | `POST /tickerscanner/fundamentals/ranking/daily` | Sincrona |
| Fase 5 | `POST /decision-engine/spot-finder/0?date=YYYY-MM-DD&cache=true` | Asincrona (`jobId`) |
| Fase 6 (avvio live) | `GET /decision-engine/spot-finder/live/0` | Asincrona (`jobId`) |
| Fase 6 (stop live) | `DELETE /decision-engine/spot-finder/live/0` | Sincrona |
| Fase 6 (stato live) | `GET /decision-engine/spot-finder/live/0/status` | Sincrona |
| Fase 7 (config guardrail) | `GET /decision-engine/guards/config` | Sincrona |
| Fase 7 (modifica guardrail) | `PATCH /decision-engine/guards/config` | Sincrona |
