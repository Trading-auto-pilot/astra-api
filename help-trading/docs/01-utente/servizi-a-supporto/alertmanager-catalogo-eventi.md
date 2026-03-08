---
sidebar_position: 1
---

# Catalogo eventi (alert disponibili)

Questa pagina contiene il catalogo degli eventi su cui puoi costruire regole alert nell'`alertmanager`.

Di seguito il catalogo attuale, diviso per microservizio.


### decision-engine

| Event key | Severita | Cosa descrive |
|---|---|---|
| `decision-engine.PRICEFLAG.CHANGED` | `info` | Pubblicato quando uno o piu flag di valutazione prezzo/volume cambiano rispetto allo snapshot precedente. |
| `decision-engine.ENTRY.CONDITION_MET` | `info` | Pubblicato quando prezzo e volume live soddisfano le condizioni di ingresso (con cooldown applicato). |
| `decision-engine.ENTRY.EARNINGS_PROXIMITY_BLOCKED` | `warning` | Pubblicato quando un segnale BUY viene bloccato perché la data di earnings è entro la finestra di blocco configurata (default: 14 giorni / 2 settimane). Il segnale rimane attivo e verrà rivalutato al prossimo tick. Configurabile via env DE_EARNINGS_GUARD_ENABLED e EARNINGS_BLOCK_WEEKS. Richiede FMP_API_KEY. Aggiornabile a runtime via PATCH /guards/config. |
| `decision-engine.ENTRY.FOMC_PROXIMITY_BLOCKED` | `warning` | Pubblicato quando un segnale BUY viene bloccato perché una riunione FOMC è entro la finestra di blocco (default: 2 giorni). Configurabile via env DE_FOMC_GUARD_ENABLED e DE_FOMC_BLOCK_DAYS. Richiede FMP_API_KEY. Aggiornabile a runtime via PATCH /guards/config. |
| `decision-engine.ENTRY.MACRO_EVENT_PROXIMITY_BLOCKED` | `warning` | Pubblicato quando un segnale BUY viene bloccato per un evento macro ad alto impatto imminente (CPI, NFP/Non-Farm Payroll). Default: 1 giorno. Configurabile via env DE_MACRO_GUARD_ENABLED e DE_MACRO_BLOCK_DAYS. Richiede FMP_API_KEY. Aggiornabile a runtime via PATCH /guards/config. |
| `decision-engine.ENTRY.DIVIDEND_PROXIMITY_BLOCKED` | `warning` | Pubblicato quando un segnale BUY viene bloccato perché l'ex-dividend date è entro la finestra di blocco (default: 3 giorni). Evita l'acquisto prima del gap-down da stacco dividendo. Configurabile via env DE_DIVIDEND_GUARD_ENABLED e DE_DIVIDEND_BLOCK_DAYS. Richiede FMP_API_KEY. Aggiornabile a runtime via PATCH /guards/config. |
| `decision-engine.ENTRY.BREAKOUT_OPEN_BLOCKED` | `info` | Pubblicato quando un segnale BREAKOUT viene rilevato ma siamo nella finestra di alta volatilità di apertura (default: primi 25 min). Il segnale viene differito, non scartato: verrà rivalutato al prossimo tick. Configurabile via env BREAKOUT_OPEN_BLOCK_MINUTES e MARKET_OPEN_UTC. |

### capital-manager

| Event key | Severita | Cosa descrive |
|---|---|---|
| `capital-manager.CAPITAL.ALLOCATED` | `info` | Pubblicato quando una richiesta di quotazione viene approvata e viene allocato capitale per un'operazione. |
| `capital-manager.CAPITAL.QUOTE_REJECTED` | `warning` | Pubblicato quando una richiesta di quotazione viene rifiutata per insufficienza di capitale o violazione dei limiti di concentrazione. |

### cacheManager

| Event key | Severita | Cosa descrive |
|---|---|---|
| `cacheManager.CACHE.L2.CLEANING` | `warning` | Pubblicato quando la cache L2 supera il limite e vengono rimossi i file piu vecchi. |
| `cacheManager.CACHE.L3.THRESHOLD.REACHED` | `warning` | Pubblicato quando l'utilizzo memoria Redis della cache L3 raggiunge la soglia configurata. |

### scheduler

| Event key | Severita | Cosa descrive |
|---|---|---|
| `scheduler.TASK.STARTED` | `info` | Pubblicato quando un task schedulato parte in esecuzione. |
| `scheduler.TASK.COMPLETED` | `info` | Pubblicato quando un task termina correttamente (sincrono o asincrono). |
| `scheduler.TASK.ERROR` | `error` | Pubblicato quando un task termina in errore. |

### authService

| Event key | Severita | Cosa descrive |
|---|---|---|
| `authService.USER.CREATED` | `info` | Pubblicato alla creazione riuscita di un utente da endpoint admin. |
| `authService.API_KEY.CREATED` | `info` | Pubblicato alla creazione riuscita di una API key da endpoint admin. |
