---
sidebar_position: 18
---

# strategyUtils.js

## Utilizzo nei microservizi

Nessun utilizzo diretto rilevato.

## Funzioni e utilizzo

| Funzione | Parametri principali | Microservizi che la usano |
|---|---|---|
| `new StrategyUtils()` | `-` | Nessun utilizzo diretto rilevato |
| `getAnnualizedProfit(startDateStr, endDateStr, profit)` | `date inizio/fine + profitto totale` | Nessun utilizzo diretto rilevato |
| `calcMediaMobile(params)` | `params: symbol, periodDays, currentDate, tf` | Nessun utilizzo diretto rilevato |
| `getInfo()` | `-` | Nessun utilizzo diretto rilevato |

## Dettaglio funzioni

### `new StrategyUtils()`

- Cosa fa: Inizializza utility strategiche con logger dedicato.
- Parametri: `-`

### `getAnnualizedProfit(startDateStr, endDateStr, profit)`

- Cosa fa: Calcola profitto annualizzato su periodo.
- Parametri: `date inizio/fine + profitto totale`

### `calcMediaMobile(params)`

- Cosa fa: Calcola media mobile recuperando candles via cacheManager.
- Parametri: `params: symbol, periodDays, currentDate, tf`

### `getInfo()`

- Cosa fa: Restituisce metadati modulo (versione/stato).
- Parametri: `-`

## Percorso

- `trading-system/shared/strategyUtils.js`
