---
sidebar_position: 7
---

# Fase 5 — Analisi tecnica e segnali di ingresso

La Fase 5 è eseguita dal microservizio `decision-engine`. Legge i ticker del ranking di sistema (`AST_RANKING_DAILY`, Fase 4) e per ciascuno esegue un'analisi tecnica multi-timeframe, producendo livelli operativi di ingresso: entry limit, stop loss e target di prezzo.

**Frequenza:** su richiesta manuale o tramite scheduler, dopo la Fase 4.

---

## Scheda operativa

| Voce | Dettaglio |
|---|---|
| Scopo | Analisi tecnica multi-timeframe e calcolo segnali di ingresso per ogni ticker nel ranking. |
| Punto di partenza | `AST_RANKING_DAILY` (Fase 4) + dati candlestick da `cachemanager`. |
| Deliverable | Snapshot Redis (TTL 12h) con livelli operativi per ticker: entry, stop loss, TP1, TP2. |
| Microservizi coinvolti | `decision-engine`, `cachemanager` (candles), `tickerscanner` (input tickers). |

---

## Parametri di pilotaggio

| Parametro | Tipo | Uso |
|---|---|---|
| `date` | data (YYYY-MM-DD) | Score date del ranking da elaborare. Obbligatorio. |
| `cache` | boolean | Se `true`, riusa i risultati già in cache Redis per i ticker già processati. |
| `maxAtrPct` | numero | Filtro: salta ticker con `atr_14_pct > valore` (default: 8%). |
| `requireSma50` | boolean | Filtro: salta ticker con prezzo < SMA50. Default: false. |
| `requireSma200` | boolean | Filtro: salta ticker con SMA50 < SMA200 (golden cross). Default: false. |
| `maxLevelDistanceAtr` | numero | Distanza massima (in ATR) tra prezzo corrente e zona supporto. Default: adattiva per tier. |
| `limit` | intero | Processa solo i primi N ticker del ranking. |
| `concurrency` | intero | Parallelismo nell'elaborazione (default: 3, max: 6). |

---

## Elaborazione

### Step 0: Pre-filtro (prima dell'analisi tecnica)

Prima di chiamare il motore di analisi, ogni ticker viene validato usando i metadati già presenti in `reason_json` di `AST_RANKING_DAILY`. Questo evita chiamate inutili al `cachemanager`.

| Regola | Effetto |
|---|---|
| `atr_14_pct` mancante | Skip: nessuna base per il sizing |
| `atr_14_pct > maxAtrPct` (default 8%) | Skip: troppo volatile, zone inaffidabili |
| `requireSma50=true` e `price_gt_sma50 = false` | Skip: prezzo sotto SMA50 (contro-trend) |
| `requireSma200=true` e `sma50_gt_sma200 = false` | Skip: golden cross non confermato |

I ticker scartati non consumano slot di concorrenza e vengono loggati (`"pre-filter: X passed, Y skipped"`).

### Tier di volatilità e parametri adattativi

Il valore `atr_14_pct` dal `reason_json` di Fase 4 viene usato per tarare automaticamente i parametri dell'analisi:

| Tier | `atr_14_pct` | `maxLevelDistanceAtr` | `volatilityK` | `flagAtrK` |
|---|---|---|---|---|
| LOW | < 1.5% | 2 | 1.0 | 1.1 |
| NORMAL | 1.5% – 4% | 3 | 1.2 | 1.3 |
| HIGH | ≥ 4% | 4 | 1.5 | 1.6 |

I parametri adattativi possono essere sovrascritti con query string esplicita.

---

### Step 1: Costruzione zone (supporti e resistenze)

I dati candlestick vengono scaricati dal `cachemanager` su **4 timeframe** in sequenza:

| Timeframe | Finestra | Scopo |
|---|---|---|
| `1day` | ultimi 120 giorni | Analisi zone primarie |
| `1week` | ultimi 365 giorni | Conferma struttura di lungo periodo |
| `1h` | ultimi 14 giorni | Zone recenti e dettaglio ravvicinato |
| `1min` | ultima sessione | Conferma intraday del prezzo |

Per ogni timeframe il motore individua le zone di prezzo significative:

1. **Calcolo ATR(20)** sulla finestra di candele
2. **Rilevamento swing** (massimi e minimi locali) con finestra `swingWindow = 3`
3. **Clustering per prezzo**: pivot vicini entro `eps = ATR × clusterMultiplier` vengono raggruppati
4. **Scoring zone**: ogni zona riceve un punteggio basato su:
   - `reaction` — ampiezza del rimbalzo futuro rispetto all'ATR
   - `timeWeight` — peso temporale (recente=1.0, medio=0.6, vecchio=0.3)
   - `score = Σ(reaction_i × timeWeight_i)`
5. **Filtri**: mantenute solo le zone con `touches ≥ 2`, `score ≥ 1`, nelle ultime 60 candele

Le zone di tutti i timeframe vengono poi **unite e prioritizzate** (daily > hourly) in `supports` e `resistances`.

---

### Step 2: Conferma trend (EMA)

Sul timeframe `1h` (finestra 28 giorni, 800 candele), il motore verifica la struttura di trend:

- **EMA20 > EMA50** → uptrend strutturale (`trendOk = true`)
- **≥ 8 delle ultime 12 candele** chiudono sopra EMA20 → trend sostenuto nel recente

---

### Step 3: Rilevamento pattern flag + breakout

Sulla stessa finestra oraria, viene analizzato il pattern tecnico:

| Condizione | Descrizione |
|---|---|
| **Flag OK** | Range ultime 20 candele < `max(flagAtrK × ATR, 0.25% del prezzo)`. Volume compresso rispetto all'impulso precedente. |
| **Breakout OK** | Prezzo supera il massimo della flag con volume ≥ media 20 periodi × `volMult (1.2)`. |
| **Pullback OK** | Prezzo ritocca il livello di breakout con volume decrescente. |
| **Setup valido** | `trendOk` AND `flagOk` AND (`breakoutOk` OR `pullbackOk`) |

---

### Step 4: Calcolo livelli di ingresso

Il motore produce **due tipologie di livello** per ogni ticker:

#### Retracement (ingresso su supporto)

```
entryLimit  = support.low + 0.55 × support.width
stopLoss    = min(support.low − 0.2 × ATR, entry − volatilityK × ATR)
takeProfit1 = prossima resistenza (se disponibile)
takeProfit2 = entry + 5 × ATR
```

#### Breakout (ingresso su rottura di resistenza)

```
entryLimit  = resistance.high + 0.25 × ATR
stopLoss    = min(resistance.low − 0.2 × ATR, entry − volatilityK × ATR)
takeProfit1 = prossima resistenza sopra il breakout
takeProfit2 = entry + 5 × ATR
```

Il `volatilityK` è adattivo in base al tier di volatilità (1.0 / 1.2 / 1.5).

---

### Step 5: Guardrail (controllo qualità del livello)

Prima di marcare un livello come `actionable = true`, vengono applicati due controlli minimi:

| Guardrail | Condizione minima |
|---|---|
| Stop minimo | `entry − stopLoss ≥ 1.0 × ATR` (stop troppo stretto = rumore di mercato) |
| TP2 minimo | `takeProfit2 − entry ≥ 3.0 × ATR` (risk/reward insufficiente) |

Se un guardrail fallisce, il livello è marcato `actionable = false` con relativa motivazione.

---

### Step 6: Retry con parametri rilassati

Se per un ticker non viene trovata una zona di supporto valida (`"support not available"`), il motore tenta automaticamente un secondo passaggio con parametri più permissivi:

| Parametro | Standard | Rilassato |
|---|---|---|
| `lookbackDays` | 120 | 180 |
| `minTouches` | 2 | 1 |
| `minScore` | 1 | 0 |
| `minRecentBars` | 60 | 180 |
| `swingWindow` | 3 | 2 |

---

## Deliverable

I risultati vengono salvati in **Redis** con chiave `spot-finder:0:{userId}:{date}` (TTL: 12 ore).

### Struttura del risultato per ticker

```json
{
  "ticker": "AAPL",
  "currentPrice": 175.50,
  "levels": {
    "retracement": {
      "entryLimit": 171.60,
      "stopLoss": 168.00,
      "takeProfit1": 180.50,
      "takeProfit2": 189.75,
      "risk": 3.60,
      "actionable": true
    },
    "breakout": {
      "entryLimit": 182.40,
      "stopLoss": 170.00,
      "takeProfit1": 185.20,
      "takeProfit2": 194.25,
      "risk": 12.40,
      "actionable": false,
      "reason": "stop too tight vs ATR"
    }
  }
}
```

---

## Come interpretare i risultati

### `actionable: true` — Condizioni strutturali favorevoli

Un livello è operabile quando:

1. La zona di supporto (o resistenza) ha sufficiente storia di touchpoint con reazione documentata
2. Il rapporto rischio/rendimento soddisfa entrambi i guardrail ATR
3. Il prezzo corrente è abbastanza vicino alla zona (`maxLevelDistanceAtr`)

Questo **non garantisce** il successo dell'operazione: indica che le condizioni strutturali sono soddisfatte.

### `actionable: false` — Perché scartare il segnale

| Motivazione | Interpretazione |
|---|---|
| `"stop too tight vs ATR"` | Il rischio assoluto è troppo basso rispetto alla volatilità del titolo. Lo stop verrebbe raggiunto per rumore normale di mercato. |
| `"tp2 too tight vs ATR"` | Il potenziale guadagno non giustifica il rischio. Risk/reward insufficiente. |
| `"no support found"` | Nessuna zona di supporto recente entro `maxLevelDistanceAtr × ATR` dal prezzo corrente. Tipico in mercati in forte momentum. |

### Retracement vs Breakout

| | Retracement | Breakout |
|---|---|---|
| **Quando** | Prezzo vicino a una zona supporto | Prezzo ha appena rotto una resistenza con volume |
| **Rischio** | Minore (entry nella zona di valore) | Maggiore (entry sopra resistenza) |
| **Reward** | Maggiore (più spazio fino alle resistenze) | Minore (entry già in area di potenziale resistenza) |
| **Pattern richiesto** | `trendOk + flagOk + pullbackOk` | `trendOk + flagOk + breakoutOk` |
| **R/R tipico** | 1:3 – 1:5 | 1:2 – 1:3 |

### ATR e sizing della posizione

L'ATR (Average True Range a 20 periodi) è il denominatore comune di tutti i calcoli:

- **Stop loss** — mai inferiore a 1× ATR dall'entry (guardrail minimo)
- **Take profit 2** — sempre ≥ 5× ATR dall'entry
- **Risk per azione** = `entry − stopLoss` in punti

> **Regola pratica:** Il rischio percentuale per operazione si calcola come `risk / currentPrice`. Esempio: `risk = 3.60`, `price = 175` → rischio = **2.1% per azione**. Il sizing della posizione si adatta a partire da questo valore in funzione del rischio massimo del portafoglio.

---

## Microservizi coinvolti

| Microservizio | Ruolo |
|---|---|
| `tickerscanner` | Fonte dati: lista ticker da `AST_RANKING_DAILY` via `GET /fundamentals/ranking/daily` |
| `cachemanager` | Fonte dati: candlestick multi-timeframe via `GET /candles` |
| `decision-engine` | Orchestrazione, analisi tecnica, calcolo livelli, persistenza Redis |
| `scheduler` | Avvio automatico schedulato (opzionale) |

---

## Avvio manuale e monitoraggio

### Avvio job asincrono (pipe virtuale 0 = ranking daily)

```http
POST /decision-engine/spot-finder/0?date=2026-03-04&cache=true
```

Risposta immediata:

```json
{
  "ok": true,
  "type": "async",
  "jobId": "spot_1772616440778_rpzknl",
  "stats": {
    "status": "running",
    "total": 87,
    "processed": 0
  }
}
```

### Polling stato job

```http
GET /decision-engine/spot-finder/jobs/spot_1772616440778_rpzknl
```

Risposta a completamento:

```json
{
  "ok": true,
  "status": "completed",
  "total": 87,
  "processed": 87,
  "ok": 71,
  "errorCount": 16,
  "cachedUsed": true,
  "cachedCount": 30
}
```

### Lettura risultati

```http
GET /decision-engine/spot-finder/latest/0?date=2026-03-04
```

Restituisce lo snapshot Redis più recente per `pipeId=0` e la data specificata.

---

## Errori comuni e recovery

| Errore | Causa probabile | Recovery |
|---|---|---|
| `total: 0` dopo il job | `score_date` non ha dati in `AST_RANKING_DAILY` | Verificare che la Fase 4 sia stata eseguita per quella data: `GET /tickerscanner/fundamentals/ranking/daily?score_date=...` |
| `"support not available"` per molti ticker | Mercato in forte trend senza pullback — nessuna zona di supporto vicina | Normale in momentum estremo. Aumentare `maxLevelDistanceAtr` oppure considerare solo i segnali di breakout. |
| `errorCount` elevato | Timeout `cachemanager` (dati storici non disponibili) | Verificare che `cachemanager` sia operativo. Rilanciare con `cache=true` per riutilizzare i risultati già salvati. |
| Job bloccato su `running` | Crash del container durante l'elaborazione | Rilanciare con `cache=true`: i ticker già processati vengono recuperati da Redis, quelli mancanti vengono rielaborati. |
