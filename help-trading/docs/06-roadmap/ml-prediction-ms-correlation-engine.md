---
sidebar_position: 7
title: ML Prediction — correlation-engine, signal-generator, backtest-runner
---

# Microservizi `correlation-engine`, `ml-signal-generator`, `ml-backtest-runner`

Questa pagina descrive i tre microservizi che operano sui dati raccolti da `alt-data-collector` per produrre correlazioni, segnali operativi e validazione storica.

---

## Panoramica ruoli

| Microservizio | Frequenza | Input | Output |
| --- | --- | --- | --- |
| `correlation-engine` | Settimanale | `alt_data_daily` + `daily_scores` | `correlation_scores` + `universe.ml_predictability_score` |
| `ml-signal-generator` | Giornaliero | `correlation_scores` + `alt_data_daily` (oggi) | `ml_signals_daily` + Redis `ml:signals` |
| `ml-backtest-runner` | On-demand / trimestrale | `alt_data_daily` storico + `daily_scores` storico | `ml_backtest_runs` + report metriche |

---

## `correlation-engine`

### Scopo

Calcola settimanalmente le correlazioni temporali ritardate tra le fonti dati alternative e le variazioni di prezzo future di ogni titolo nel `universe`. Aggiorna il `ml_predictability_score` per ogni titolo.

### Struttura file

```
correlation-engine/
  server.js
  release.json
  Dockerfile
  modules/
    main.js              # CorrelationEngineService extends BaseService
    pearsonCalculator.js # calcolo Pearson + Spearman rolling window
    fdrCorrection.js     # Benjamini-Hochberg FDR correction
    decayMonitor.js      # rilevamento decay/inversione correlazioni attive
  routes/
    engine.js            # trigger manuale, stato job, lista correlazioni
```

### Porta e variabili ambiente

| Variabile | Valore |
| --- | --- |
| `PORT` | `3026` |
| `DATAHUB_URL` | Standard |
| `REDIS_URL` | Standard |

### Algoritmo principale

```
OGNI DOMENICA NOTTE (cron: "0 2 * * 0"):

Per ogni symbol in universe:
  Per ogni source_id in alt_data_sources (enabled):
    1. Carica serie temporale feature:
         SELECT date, value FROM alt_data_daily
         WHERE source_id = ? AND date >= (today - 252 - 14 giorni)
         AND source_error = 0
         ORDER BY date ASC

    2. Carica serie prezzi del titolo:
         SELECT date, close FROM daily_scores
         WHERE symbol = ? ORDER BY date ASC

    3. Per ogni lag in [1, 2, 3, 5, 7, 10, 14]:
         - Costruisci coppie (feature[T], price_change[T+lag])
         - Calcola Pearson correlation
         - Calcola p-value (t-test approssimato: t = r * sqrt(n-2) / sqrt(1-r²))
         - Aggiungi alla lista test_results

    4. Applica FDR Benjamini-Hochberg su tutti i p-value del symbol
    5. Per ogni test significativo post-FDR:
         - Classifica relationship (DIRECT / INVERSE / BORDERLINE / RANDOM)
         - Se non RANDOM: INSERT INTO correlation_scores
    6. Calcola ml_predictability_score:
         - top-k coppie DIRECT/INVERSE per |correlation|
         - media pesata con penalità su instabilità
         - UPDATE universe SET ml_predictability_score = ?, ml_last_scored_at = NOW()
```

### Implementazione Pearson

```js
// modules/pearsonCalculator.js

function pearson(x, y) {
  const n = x.length;
  if (n < 30) return { r: null, pValue: 1 }; // troppo pochi punti
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  const num = x.reduce((s, xi, i) => s + (xi - meanX) * (y[i] - meanY), 0);
  const denX = Math.sqrt(x.reduce((s, xi) => s + (xi - meanX) ** 2, 0));
  const denY = Math.sqrt(y.reduce((s, yi) => s + (yi - meanY) ** 2, 0));
  const r = num / (denX * denY);
  // t-test approssimato
  const t = r * Math.sqrt(n - 2) / Math.sqrt(1 - r * r);
  const pValue = tDistPValue(t, n - 2); // approssimazione con tabella/formula
  return { r, pValue };
}

function buildLaggedPairs(feature, prices, lagDays) {
  // feature: [{date, value}], prices: [{date, pct_change}]
  // restituisce [{x: feature[T], y: price_change[T+lag]}]
  // ...
}
```

### FDR Benjamini-Hochberg

```js
// modules/fdrCorrection.js

function benjaminiHochberg(pValues, alpha = 0.05) {
  const m = pValues.length;
  const indexed = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const rejected = new Set();
  for (let k = m; k >= 1; k--) {
    if (indexed[k - 1].p <= (k / m) * alpha) {
      for (let j = 0; j < k; j++) rejected.add(indexed[j].i);
      break;
    }
  }
  return pValues.map((_, i) => rejected.has(i)); // true = significativo post-FDR
}
```

### Decay monitoring

```js
// modules/decayMonitor.js

// Confronta le correlazioni più recenti con quelle di 4 settimane fa.
// Se una coppia DIRECT/INVERSE scende sotto il 60% del valore originale
// per 3 run consecutivi → retrocede a BORDERLINE e pubblica alert Redis.

async function checkDecay(symbol, sourceId, lagDays) {
  const recent = await getCorrelationHistory(symbol, sourceId, lagDays, 3); // ultimi 3 run
  if (recent.length < 3) return;
  const [r3, r2, r1] = recent; // più vecchio → più recente
  const decayRatio = Math.abs(r1.correlation) / Math.abs(r3.correlation);
  if (decayRatio < 0.6) {
    await publishAlert('ML_CORRELATION_DECAY', { symbol, sourceId, lagDays, decayRatio });
  }
}
```

### Endpoint REST

```
POST /correlation-engine/run           → avvia job manuale
GET  /correlation-engine/run/:jobId    → stato job
GET  /correlation-engine/scores/:symbol → correlazioni attive per un titolo
GET  /correlation-engine/top           → top titoli per ml_predictability_score
```

---

## `ml-signal-generator`

### Scopo

Ogni giorno dopo market close, per ogni titolo con `ml_predictability_score ≥ 0.6`, genera un segnale operativo (`BULLISH` / `BEARISH`) basato sulle correlazioni attive e sui valori odierni delle feature.

### Struttura file

```
ml-signal-generator/
  server.js
  release.json
  Dockerfile
  modules/
    main.js               # MlSignalGeneratorService extends BaseService
    signalComputer.js     # logica rule-based V1: sign(feature) × sign(correlation)
    performanceEvaluator.js # valuta segnali scaduti, aggiorna ml_signal_performance
  routes/
    signals.js            # endpoint segnali correnti, storia, performance
```

### Porta

| `PORT` | `3027` |

### Flusso giornaliero

```
OGNI GIORNO FERIALE (cron: "0 0 * * 1-5", mezzanotte UTC, dopo alt-data-collector):

1. Carica titoli candidati:
     SELECT symbol, ml_predictability_score FROM universe
     WHERE ml_predictability_score >= 0.6

2. Per ogni symbol:
   a. Carica correlazioni attive (ultimo computed_at):
        SELECT * FROM correlation_scores
        WHERE symbol = ? AND relationship IN ('DIRECT', 'INVERSE')
        AND computed_at = (SELECT MAX(computed_at) FROM correlation_scores WHERE symbol = ?)

   b. Per ogni correlazione attiva:
        - Leggi alt_data_daily.value per (today, source_id)
        - Calcola feature_direction = sign(value)   [pct_change > 0 → +1, < 0 → -1]
        - signal_component = feature_direction × sign(correlation)

   c. Aggrega i componenti (media pesata per |correlation|):
        - weighted_signal = Σ(signal_component × |correlation|) / Σ(|correlation|)
        - Se weighted_signal > threshold_bullish → BULLISH
        - Se weighted_signal < threshold_bearish → BEARISH
        - Altrimenti → NEUTRAL (non persistito)

   d. Calcola confidence = |weighted_signal| normalizzato [0, 1]

   e. INSERT INTO ml_signals_daily
   f. Pubblica su Redis: PUBLISH ml:signals <json>

3. Valuta segnali scaduti (expires_at <= today):
     - Recupera price_at_eval dal provider
     - Calcola actual_return, was_correct
     - INSERT INTO ml_signal_performance
```

### Implementazione V1 (rule-based)

```js
// modules/signalComputer.js

function computeSignal(correlations, todayFeatures) {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const corr of correlations) {
    const featureValue = todayFeatures[corr.source_id];
    if (featureValue === null || featureValue === undefined) continue;

    const featureDir = Math.sign(featureValue);  // +1 o -1
    const corrDir    = Math.sign(corr.correlation);
    const component  = featureDir * corrDir;      // +1 = BULLISH, -1 = BEARISH

    const weight = Math.abs(corr.correlation);
    weightedSum  += component * weight;
    totalWeight  += weight;
  }

  if (totalWeight === 0) return null;

  const score = weightedSum / totalWeight; // [-1, +1]
  const signal = score > 0.2 ? 'BULLISH' : score < -0.2 ? 'BEARISH' : 'NEUTRAL';
  const confidence = Math.min(1, Math.abs(score));

  return { signal, confidence, score };
}
```

> Le soglie `0.2` e `-0.2` sono configurabili tramite `settings` del microservizio.

### Struttura segnale Redis

```json
{
  "symbol": "XLE",
  "signal": "BULLISH",
  "confidence": 0.74,
  "horizon_days": 3,
  "method": "rule_based",
  "top_features": [
    { "source": "vix", "lag": 1, "correlation": -0.72, "relationship": "INVERSE", "feature_value": -1.8 },
    { "source": "xle", "lag": 2, "correlation": 0.65, "relationship": "DIRECT", "feature_value": 0.9 }
  ],
  "generated_at": "2026-03-08T23:05:00Z"
}
```

### Endpoint REST

```
GET  /ml-signal-generator/signals           → segnali attivi oggi
GET  /ml-signal-generator/signals/:symbol   → ultimi N segnali per titolo
GET  /ml-signal-generator/performance       → accuracy rolling 30/90/252g globale
GET  /ml-signal-generator/performance/:symbol → accuracy per titolo
POST /ml-signal-generator/run               → trigger manuale
```

**Response `/performance` (esempio):**

```json
{
  "window_30d": { "n_signals": 42, "hit_rate": 0.61, "avg_return": 0.83 },
  "window_90d": { "n_signals": 118, "hit_rate": 0.58, "avg_return": 0.71 },
  "window_252d": { "n_signals": 394, "hit_rate": 0.56, "avg_return": 0.64 }
}
```

---

## `ml-backtest-runner`

### Scopo

Esegue la validazione storica out-of-sample del sistema ML su dati passati. L'esecuzione è manuale (o pianificata trimestralmente) e produce metriche che decidono se il sistema è pronto per il go-live.

### Struttura file

```
ml-backtest-runner/
  server.js
  release.json
  Dockerfile
  modules/
    main.js              # MlBacktestRunnerService extends BaseService
    backtestEngine.js    # orchestrazione: training → validation → metriche
    metricsCalculator.js # hit_rate, sharpe, max_drawdown, avg_return
  routes/
    backtest.js          # CRUD run, avvio, risultati
```

### Porta

| `PORT` | `3028` |

### Flusso di un backtest run

```
POST /ml-backtest-runner/runs  { start_date, cutoff_date, eval_end_date, config }

1. INSERT ml_backtest_runs (status = 'running')
2. TRAINING PHASE [start_date → cutoff_date]:
   a. Calcola correlation_scores su dati storici di quella finestra
      (stesso algoritmo di correlation-engine ma su range fisso)
   b. Identifica coppie con |correlation| ≥ threshold e p-value ok (post-FDR)
   c. Salva correlazioni temporanee in memoria (non in DB, sono "training-only")

3. VALIDATION PHASE [cutoff_date → eval_end_date]:
   Simula giorno per giorno in ordine cronologico:

   FOR ogni giorno D in [cutoff_date, eval_end_date]:
     a. Carica alt_data_daily.value per (D, source_id)
        WHERE available_at <= D 23:59  ← no lookahead!
     b. Applica signalComputer con le correlazioni training
     c. Per ogni segnale generato:
          - Nota price[D] dal daily_scores
          - Attendi horizon_days e nota price[D+lag]
          - Calcola actual_return, was_correct
     d. Accumula risultati

4. Calcola metriche:
   - hit_rate = n_correct / n_signals
   - avg_return = media(actual_return) su segnali BULLISH/BEARISH
   - sharpe = avg_return / std(actual_return) * sqrt(252/horizon_days)
   - max_drawdown = calcolo drawdown della curva P&L cumulata
   - vs_buy_and_hold = confronto con SPY nello stesso periodo

5. UPDATE ml_backtest_runs SET status='completed', hit_rate=?, sharpe=?, ...
6. Pubblica evento Redis: "ml:backtest:completed"
```

### Endpoint REST

```
POST /ml-backtest-runner/runs              → avvia nuovo backtest
GET  /ml-backtest-runner/runs              → lista run (più recenti prima)
GET  /ml-backtest-runner/runs/:id          → dettaglio run con metriche
DELETE /ml-backtest-runner/runs/:id        → cancella run (solo se completed/failed)
GET  /ml-backtest-runner/runs/:id/signals  → segnali simulati del run (per analisi)
```

**Esempio config body:**

```json
{
  "run_name": "walk-forward-run-1",
  "start_date": "2021-01-01",
  "cutoff_date": "2023-12-31",
  "eval_end_date": "2025-12-31",
  "config": {
    "corr_threshold_high": 0.6,
    "corr_threshold_low": 0.42,
    "lags": [1, 2, 3, 5, 7, 10, 14],
    "horizon_days": 3,
    "signal_threshold_bullish": 0.2,
    "signal_threshold_bearish": -0.2,
    "window_days": 252
  }
}
```

**Esempio response metriche:**

```json
{
  "id": 1,
  "run_name": "walk-forward-run-1",
  "status": "completed",
  "start_date": "2021-01-01",
  "cutoff_date": "2023-12-31",
  "eval_end_date": "2025-12-31",
  "hit_rate": 58.4,
  "avg_return": 0.72,
  "sharpe": 1.14,
  "max_drawdown": -8.3,
  "n_signals": 847,
  "n_correct": 495,
  "computed_at": "2026-03-09T02:15:00Z",
  "completed_at": "2026-03-09T03:42:00Z"
}
```

### Soglie di go/no-go

Prima di procedere con il go-live (Milestone 4), il backtest deve superare:

| Metrica | Soglia minima |
| --- | --- |
| `hit_rate` | ≥ 54% |
| `avg_return` | ≥ 0.3% per segnale |
| `sharpe` | ≥ 0.8 |
| `max_drawdown` | ≤ −15% |
| `n_signals` | ≥ 200 (campione statisticamente significativo) |

Se anche una sola soglia non è rispettata → il team discute prima di procedere.

---

## Integrazione tra i tre microservizi

```
alt-data-collector
    │ (daily, 23:30 UTC)
    ▼ Redis: "alt-data-collector:daily:done"
ml-signal-generator
    │ (daily, 00:00 UTC)
    ▼ Redis: "ml:signals" (live)
decision-engine (shadow mode / live)

correlation-engine
    │ (weekly, domenica 02:00 UTC)
    ▼ aggiorna correlation_scores + ml_predictability_score in universe

ml-backtest-runner
    │ (on-demand, trimestrale)
    ▼ ml_backtest_runs → report go/no-go
```

### Redis channels

| Channel | Producer | Consumer | Payload |
| --- | --- | --- | --- |
| `alt-data-collector:daily:done` | alt-data-collector | ml-signal-generator | `{ date, summary }` |
| `ml:signals` | ml-signal-generator | decision-engine, alertingService | segnale JSON completo |
| `ml:backtest:completed` | ml-backtest-runner | admin dashboard | `{ runId, hit_rate, sharpe }` |
| `ml:correlation:decay` | correlation-engine | alertingService | `{ symbol, sourceId, decayRatio }` |
