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
       POST /allocation/quote { userId, symbol, market, ignoreExistingPositions: true }
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

  Regola operativa sul PnL:
  - la riduzione posizione per over-risk (`investedCapital > newMaxInvestable`) va applicata anche se la posizione è in perdita;
  - il criterio principale è il rispetto del limite di rischio aggiornato, non il profitto/perdita istantaneo.

  Filtro anti-rumore consigliato:
  - se il calo di `liquidityIndex` è borderline, eseguire la riduzione solo dopo conferma per N review consecutive
    (es. 2-3 cicli), per evitare vendite impulsive su oscillazioni temporanee.

CASO 3 — Regime RISK_ON, ma nuove zone tecniche diverse dall'entry
  → Aggiorna TP1 alla nuova resistenza sopra il prezzo corrente
  → Trailing stop: se prezzo > avgCost + 1.5 * ATR, sposta SL a avgCost + 0.5 * ATR
  → Qty invariata

CASO 4 — Regime RISK_ON, prezzo tornato sotto zona di entry (pullback profondo)
  → Nessuna azione: il bracket order originale gestisce già il SL
  → Log evento POSITION_REVIEW.NO_ACTION

CASO 5 — Guardrail di sicurezza
  → Condizione: unrealizedPnL < -2 * ATR * qty  E  regime != RISK_ON
  → Chiudi posizione (emergency exit, non aspettare il SL originale)
```

Le soglie (`1.5 * ATR`, `0.5 * ATR`, ecc.) sono parametri configurabili via settings DB, non valori fissi nel codice.

### Priorità di valutazione regole (ordine fisso)

Per evitare comportamenti non deterministici, la valutazione deve seguire sempre questo ordine:

1. `RISK_OFF` sistemico → chiusura totale (CASO 1)
2. Evento calendario ad alta volatilità in finestra D-1 → chiusura parziale/totale
3. Guardrail di sicurezza (loss oltre soglia) → emergency close (CASO 5)
4. Ribilanciamento da calo `liquidityIndex` (CASO 2)
5. Aggiustamento tecnico TP/SL (CASO 3)
6. Nessuna azione (CASO 4)

### Controllo eventi a calendario su posizioni aperte

Oltre alle regole tecniche e di liquidità, il `decision-engine` deve eseguire anche un controllo sugli **eventi a calendario** (macro, earnings, eventi sensibili) per le posizioni già aperte.

Regola operativa:

- se è presente un evento ad alta volatilità sul titolo/mercato, il servizio valuta la **chiusura parziale o totale il giorno precedente** all'evento;
- la logica di accesso ai dati calendario deve riutilizzare gli **stessi endpoint e lo stesso flusso** già adottati dal decision-engine in fase di pre-check prima dell'apertura posizione (nessun canale nuovo dedicato).
- la decisione deve usare una finestra temporale esplicita in timezone di mercato (es. US/Eastern), per evitare errori di giorno dovuti al timezone del container;
- criterio operativo minimo consigliato:
  - evento `HIGH`/`CRITICAL` in D-1 con posizione in profitto moderato → chiusura parziale;
  - evento `HIGH`/`CRITICAL` in D-1 con volatilità già in aumento o profitto fragile → chiusura totale.

> Nota da considerare
> In presenza di `RISK_OFF` sistemico o evento calendario `HIGH/CRITICAL` in D-1, la priorità resta la riduzione del rischio: la chiusura (parziale/totale) non deve dipendere dal fatto che la posizione sia in profitto.

---

## Nuovi endpoint necessari su altri servizi

### broker-executor-ibkr

Tre route da implementare:

| Metodo | Path | Descrizione |
|---|---|---|
| `GET` | `/positions` | Legge esclusivamente le posizioni aperte (qty residua `> 0`) |
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

Con questo flag il capital-manager calcola il `maxInvestable` come se non ci fossero allocazioni in corso per quel simbolo, restituendo la soglia teorica corrispondente al `liquidityIndex` corrente. Il decision-engine usa questo valore per confrontarlo con `avgCost * quantity` e determinare quanti contratti chiudere.

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

Payload minimo consigliato per tutti gli eventi:

```json
{
  "eventKey": "POSITION_REVIEW.PARTIAL_CLOSE",
  "symbol": "AAPL",
  "userId": "8",
  "reason": "LIQUIDITY_DROP",
  "positionQtyBefore": 20,
  "positionQtyAfter": 14,
  "timestamp": "2026-03-08T10:30:00Z"
}
```

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

6. **[MINORE]** Aggiungere idempotenza/concorrenza:
   - lock distribuito per posizione (`userId:symbol`) durante la review;
   - operation key per evitare doppia esecuzione della stessa chiusura/modifica su retry.

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
| Loop su più istanze genera doppie azioni | Lock distribuito + operation key idempotente per `userId:symbol:reviewTs` |

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

---

## Definition of Done (test di accettazione)

1. Con `liquidityIndex` invariato e `currentPrice` in salita, **non** avviene vendita automatica (nessun falso positivo da mark-to-market).
2. Con calo reale di `liquidityIndex` e `avgCost * qty > newMaxInvestable`, viene eseguita una chiusura parziale coerente.
3. Con evento calendario `HIGH` in D-1, viene applicata la regola di riduzione rischio (parziale o totale) senza usare endpoint nuovi.
4. In regime `RISK_OFF`, la chiusura totale ha priorità su qualsiasi altro caso.
5. In presenza di retry/duplicati, non si osservano doppie chiusure sulla stessa posizione.
6. Gli eventi Redis emessi rispettano naming e payload minimo definiti.
