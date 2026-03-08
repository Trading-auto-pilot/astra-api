---
sidebar_position: 2
---

# Decision-Engine — Gestione ordini aperti

## Contesto attuale

Il `decision-engine` opera attualmente in modalità **fire-and-forget**: identifica un setup tecnico su un ticker, verifica le condizioni di ingresso, prenota il capitale tramite `capital-manager` e piazza un bracket order su `broker-executor-ibkr`. Dopo il piazzamento dell'ordine, il servizio non monitora più la posizione aperta né reagisce a cambiamenti di mercato successivi all'entry.

Questo significa che:

- Il TP e lo SL restano quelli calcolati al momento dell'ingresso, anche se le zone tecniche si spostano
- Se il regime di liquidità peggiora (`RISK_OFF`), le posizioni aperte rimangono invariate
- Non esiste un meccanismo di chiusura parziale per bloccare profitti parziali in caso di deterioramento del mercato

## Obiettivo

Aggiungere un **Position Review Loop** periodico che:

1. Legge le posizioni aperte da `broker-executor-ibkr`
2. Ricalcola i livelli tecnici (zone + ATR) con i dati di mercato aggiornati
3. Verifica il regime di liquidità corrente
4. Aggiusta TP/SL o chiude parzialmente la posizione in base alle condizioni

Il loop si integra nel flusso esistente **senza modificare** la logica di entry.

---

## Architettura della soluzione

### Componente: Position Review Loop

Un loop periodico (ogni N minuti, configurabile via settings DB come `POSITION_REVIEW_INTERVAL_MS`) attivo **solo quando la live mode è attiva** (`liveState.active === true`).

```
Loop periodico
│
├── GET {brokerExecutorUrl}/positions  (o /orders?status=FILLED)
│
├── Per ogni posizione aperta:
│   ├── fetchCandlesFromCacheManager(symbol, "1day", 120)
│   ├── buildZones(candles)  →  nuove zone tecniche
│   ├── atr(candles)  →  ATR corrente
│   ├── computeEntryLevels(zones, currentPrice, atr)  →  nuovi livelli
│   ├── GET {liquidityManagerUrl}/liquidity-score  →  { regime, liquidityIndex }
│   └── reviewSinglePosition(pos, levels, liquidity)  →  decision tree
│
└── Applica aggiustamenti → broker-executor-ibkr
```

### File coinvolti nel decision-engine

| Funzione nuova | File | Note |
|---|---|---|
| `startPositionReviewLoop()` | `live-manager.js` | Chiamata in `activateLive()`, usa `setInterval` |
| `reviewOpenPositions()` | `live-manager.js` | Ciclo principale, richiama `reviewSinglePosition` per ogni posizione |
| `reviewSinglePosition(pos, levels, liquidity)` | `live-manager.js` | Decision tree puro e testabile |
| `applyPositionAdjustment(symbol, orderId, adjustments)` | `live-manager.js` | Chiama `broker-executor-ibkr` per modifiche e chiusure |

Tutto il codice di analisi tecnica esistente (`buildZones`, `computeEntryLevels`, `atr`) viene riutilizzato senza modifiche.

---

## Decision tree per posizione aperta

```
INPUT:
  pos             → { symbol, avgCost, quantity, unrealizedPnL }
  levels          → { entryLimit, stopLoss, takeProfit1, takeProfit2 }  (ricalcolati)
  liquidity       → { regime, liquidityIndex }
  currentPrice    → ultimo prezzo live (già in memoria in liveState)

─────────────────────────────────────────────────────────────────

CASO 1 — Regime RISK_OFF
  → Chiudi posizione completamente al mercato
  → Motivo: deterioramento sistemico, priorità sulla conservazione del capitale

CASO 2 — Ribilanciamento per riduzione del liquidityIndex
  → Condizione: liquidityIndex calato rispetto a T0  E  regime != RISK_OFF

  Steps:
  1. Chiama capital-manager con flag ignoreExistingPositions=true
       POST /allocation/quote { symbol, ignoreExistingPositions: true }
       → ottieni newMaxInvestable (es. 3.7K)

  2. Calcola il capitale originariamente allocato (invariante rispetto all'andamento del prezzo):
       investedCapital = avgCost * quantity  (es. 5K)

     ⚠️  Non usare currentPrice * quantity: se il titolo è in rialzo il valore di mercato
     cresce anche senza variazioni del liquidityIndex, causando chiusure false su posizioni
     profittevoli. Il capital-manager ha riservato capitale al prezzo di ingresso (avgCost),
     quindi il confronto va fatto sullo stesso riferimento.

  3. Se investedCapital > newMaxInvestable:
       excessCapital = investedCapital - newMaxInvestable
       contractsToClose = ceil(excessCapital / avgCost)

       → Chiudi contractsToClose contratti (chiusura parziale al mercato, eseguita a currentPrice)
       → Aggiorna reservation su capital-manager
       → Sposta SL a breakeven + 0.5 * ATR come protezione residua
       → Pubblica evento POSITION_REVIEW.PARTIAL_CLOSE

  4. Se investedCapital <= newMaxInvestable:
       → Nessuna azione sul size (la posizione rientra nei nuovi limiti)
       → Applica solo eventuali aggiustamenti di TP/SL (vedi CASO 3)

CASO 3 — Regime RISK_ON, ma nuove zone tecniche diverse dall'entry
  → Aggiorna TP1 alla nuova resistenza sopra il prezzo corrente
  → Trailing stop: se prezzo > avgCost + 1.5 * ATR, sposta SL a avgCost + 0.5 * ATR
  → Qty invariata

CASO 4 — Regime RISK_ON, prezzo tornato sotto zona di entry (pullback profondo)
  → Nessuna azione: il bracket order originale gestisce già il SL
  → Log evento POSITION_REVIEW_NO_ACTION

CASO 5 — Guardrail di sicurezza
  → Condizione: unrealizedPnL < -2 * ATR * qty  E  regime != RISK_ON
  → Chiudi posizione (emergency exit, non aspettare il SL originale)
```

Le soglie (`1.5 * ATR`, `0.5 * ATR`, ecc.) sono parametri configurabili via settings DB, non valori fissi nel codice.

---

## Nuovi endpoint necessari su altri servizi

### broker-executor-ibkr

Due nuove route da implementare:

| Metodo | Path | Descrizione |
|---|---|---|
| `GET` | `/positions` (o `/orders?status=FILLED`) | Legge le posizioni/ordini attivi con stato filled |
| `PATCH` | `/order/:id/levels` | Modifica TP e SL di un ordine bracket esistente |
| `POST` | `/order` con `side=SELL, orderType=MKT` | Chiusura parziale o totale al mercato |

La modifica dell'ordine corrisponde a una **order modification** sull'API IBKR (campo `orderId` + nuovi prezzi). La chiusura parziale richiede di cancellare prima i legs del bracket originale prima di inviare il sell.

### capital-manager

Il CASO 2 richiede di conoscere il **nuovo massimo investibile** al netto della liquidità corrente, ma ignorando che esiste già una posizione aperta per quel simbolo. Attualmente `POST /allocation/quote` restituisce 0 (o il residuo) se il capitale è già allocato per quel ticker.

Va aggiunto un flag opzionale alla richiesta:

```json
POST /allocation/quote
{
  "userId": "...",
  "symbol": "AAPL",
  "market": "US",
  "ignoreExistingPositions": true
}
```

Con questo flag il capital-manager calcola il `maxInvestable` come se non ci fossero allocazioni in corso per quel simbolo, restituendo la soglia teorica corrispondente al `liquidityIndex` corrente. Il decision-engine usa questo valore per confrontarlo con `currentPrice * quantity` e determinare quanti contratti chiudere.

### liquidity-manager

Verificare che `GET /liquidity-score` restituisca il valore numerico `liquidityIndex` (0–100 o 0–1) e non solo il label del regime (`RISK_ON` / `NEUTRAL` / `RISK_OFF`). Se non è presente, va aggiunto alla risposta esistente. Questo valore è necessario al decision-engine per rilevare il **calo** tra T0 e T1 e attivare il CASO 2.

---

## Nuovi eventi Redis

Seguendo il pattern esistente su `{ENV}.decision-engine.events` e `{ENV}.hooks`:

| eventKey | Quando |
|---|---|
| `POSITION_REVIEW.LEVELS_UPDATED` | TP/SL aggiornato con successo |
| `POSITION_REVIEW.PARTIAL_CLOSE` | Chiusura parziale eseguita |
| `POSITION_REVIEW.EMERGENCY_CLOSE` | Chiusura completa per rischio |
| `POSITION_REVIEW.NO_ACTION` | Review completata senza modifiche |
| `POSITION_REVIEW.FETCH_ERROR` | Errore nella lettura delle posizioni |

---

## Prerequisiti (ordine di priorità)

1. **[BLOCCO]** Implementare in `broker-executor-ibkr`:
   - `GET /positions` o `GET /orders?status=FILLED`
   - `PATCH /order/:id/levels`
   - `POST /order` con `side=SELL, orderType=MKT`

2. **[BLOCCO]** Aggiungere flag `ignoreExistingPositions` a `POST /allocation/quote` nel `capital-manager`

3. **[BLOCCO]** Verificare o aggiungere il campo `liquidityIndex` numerico nella risposta di `GET /liquidity-score` nel `liquidity-manager`

4. **[MINORE]** Il decision-engine deve memorizzare il `liquidityIndex` al momento dell'entry (T0) per confrontarlo al review (T1) e rilevare il calo — probabilmente in Redis insieme allo snapshot del spot-finder

5. **[MINORE]** Il loop deve girare solo in orario di mercato (09:30–16:00 ET), coerente con il guard `opening_volatility` già presente

---

## Rischi e contromisure

| Rischio | Contromisura |
|---|---|
| IBKR limita le modify order (rate limit API) | Rate limit nel loop: max 1 modifica ogni 30s per ticker |
| Chiusura parziale con bracket order ancora attivo → ordini orfani | Cancellare i legs del bracket esistente prima di inviare il sell |
| Loop gira su posizioni già chiuse | Filtrare: `quantity > 0` nella risposta di `/positions` |
| `liquidityIndex` volatile → ribilanciamenti frequenti | Usare media mobile su N misurazioni consecutive (es. ultimi 3 check) invece del valore istantaneo; aggiungere una soglia minima di variazione (es. Δ > 10 punti rispetto a T0) prima di attivare il CASO 2 |
| Calcolo `contractsToClose` genera sell superiore alla posizione reale | Clampare: `contractsToClose = min(ceil(excessCapital / avgCost), quantity - 1)` — non chiudere mai tutta la posizione via CASO 2 (per quello esiste CASO 1) |
| Modifica SL durante gap di prezzo overnight | Aggiungere controllo: non modificare SL se `currentPrice < avgCost - 1 * ATR` (possibile gap, attendere stabilizzazione) |

---

## Riepilogo effort stimato

```
decision-engine
  ├── startPositionReviewLoop()     ~30 righe
  ├── reviewOpenPositions()         ~50 righe
  ├── reviewSinglePosition()        ~80 righe
  └── applyPositionAdjustment()     ~40 righe

broker-executor-ibkr
  ├── GET  /positions               nuova route
  └── PATCH /order/:id/levels       nuova route

capital-manager
  └── flag ignoreExistingPositions su /allocation/quote   modifica minore

liquidity-manager
  └── liquidityIndex numerico nel response   modifica minore

decision-engine (Redis snapshot)
  └── salva liquidityIndex a T0 insieme allo snapshot spot-finder   modifica minore
```

Nessun nuovo microservizio richiesto. Tutte le funzioni di analisi tecnica esistenti vengono riutilizzate senza modifiche.
