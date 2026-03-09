---
sidebar_position: 3
title: ML Prediction — Predizione basata su correlazioni esterne
---

# ML Prediction — Sistema di predizione basato su correlazioni esterne

## Pagine di dettaglio implementazione

- [Fonti dati esterne — FMP, FRED, API e catalogo](./ml-prediction-fonti-dati)
- [Database — Schema e DDL delle tabelle](./ml-prediction-database)
- [Microservizio `alt-data-collector`](./ml-prediction-ms-alt-data-collector)
- [Microservizi `correlation-engine`, `ml-signal-generator`, `ml-backtest-runner`](./ml-prediction-ms-correlation-engine)

---

## Obiettivo

Affiancare l'analisi tecnica con un sistema di **Machine Learning predittivo** che identifica automaticamente i titoli/ETF per cui esiste una correlazione misurabile tra eventi esterni e variazioni di prezzo future.

Il sistema **non sostituisce** l'analisi tecnica: la integra. Un segnale ML forte, combinato con un segnale tecnico favorevole, aumenta la probabilità di successo dell'operazione.

> **Principio chiave**: il sistema opera solo su titoli per cui la correlazione è dimostrata statisticamente. Per tutti gli altri, non produce segnali.

---

## Idea centrale: correlazione temporale ritardata

Il mercato spesso reagisce a eventi esterni con un ritardo misurabile. Il sistema sfrutta questa caratteristica:

```
Evento esterno (T)  →  [ritardo 1g–14g]  →  Variazione prezzo (T+n)
```

Esempi concreti:
- Un aumento del VIX oggi → calo del titolo X domani (correlazione inversa con lag 1g)
- Un articolo positivo sul settore energia → rialzo dell'ETF energia in 3 giorni
- Il rialzo di un indice europeo oggi → apertura rialzista di un titolo correlato domani

Il valore del lag (ritardo) è **scoperto automaticamente** dal sistema per ogni coppia (titolo, fonte dati), testando lag in `[1, 2, 3, 5, 7, 10, 14]` giorni.

---

## Fonti dati alternative (Feature Sources)

| Categoria | Esempi | Formato |
| --- | --- | --- |
| **Indici macro** | VIX, S&P 500, NASDAQ, settore SPDR | Variazione % giornaliera |
| **Indici correlati** | Euro STOXX 50, Nikkei, FTSE 100 | Variazione % giornaliera |
| **Altri titoli con lag** | Un ETF che anticipa un settore, un future | Variazione % giornaliera |
| **News sentiment** | Sentiment aggregato per settore/ticker da titoli notizie | Score [-1, +1] per giorno |
| **Dati macro** | Tassi FED, CPI, NFP, earnings calendar | Evento + valore |
| **Stagionalità** | Giorno settimana, mese, quarter, exdate | Feature categoriche |
| **Volatilità/Opzioni** | VIX term structure (VIX/VIX3M), VVIX, put/call ratio | Valore numerico giornaliero |
| **Credito/Tassi** | HY spread, IG spread, real yields, curva 2s10s | Variazione giornaliera |
| **Breadth/Flussi** | Advance/Decline, nuovi massimi/minimi, ETF flows settoriali | Valore numerico giornaliero |

> **Nota stazionarietà**: tutte le feature numeriche continue (indici, prezzi) devono essere espresse come **variazione percentuale** rispetto al giorno precedente, non come valore assoluto. Usare valori grezzi non stazionari produce correlazioni spurie causate dai trend di lungo periodo.

---

## Architettura del sistema

Il sistema si compone di quattro fasi operative più un processo di validazione storica separato.

### Fase 1 — Raccolta continua dati alternativi (`alt-data-collector`)

Un nuovo microservizio raccoglie e normalizza le fonti dati esterne su base giornaliera:

- Scarica VIX, indici principali, titoli "correlatori" (configurabili)
- Calcola sentiment score giornaliero da news (FMP News API o simile)
- Normalizza tutto in variazioni % (dove applicabile) e salva in `alt_data_daily`:

```
| date | source_id | value | source_type | available_at |
```

Il campo `available_at` indica **quando il dato è effettivamente disponibile** al sistema (non la data a cui si riferisce). Questo è essenziale per evitare data leakage nel training e nel backtest.

Il servizio gira come job schedulato giornaliero (dopo market close).

**Gestione dati mancanti**: gap per festività/weekend vengono marcati come `NULL` (non interpolati), weekend non hanno record. In caso di failure API il record viene scritto con `value = NULL` e flag `source_error = true` — le fasi successive ignorano record con valore mancante per quella coppia.

---

### Fase 2 — Motore di correlazione (`correlation-engine`)

Analizza storicamente le correlazioni tra le fonti dati e i prezzi futuri dei titoli:

1. Per ogni titolo nell'`universe`, per ogni fonte dati disponibile:
   - Calcola la correlazione tra `feature[T]` e `price_change[T+lag]` per lag in `[1, 2, 3, 5, 7, 10, 14]` giorni
   - Usa **Pearson correlation** per dati continui (su serie già stazionarizzate in % change), **Spearman** come alternativa robusta per distribuzioni non gaussiane, **Point-Biserial** per eventi binari
   - Usa **rolling window** (es. ultimi 252 giorni di trading) per avere una correlazione aggiornata

2. Filtra per significatività statistica (p-value < 0.05)

   > Poiché vengono testate molte combinazioni (titolo × fonte × lag), il filtro p-value deve essere corretto per **multiple testing**:
   > - baseline: controllo **FDR (Benjamini-Hochberg)**;
   > - opzionale conservativo: Bonferroni per set piccoli.
   >
   > Senza questa correzione aumenta il rischio di falsi positivi.

3. Classifica il tipo di relazione:
   - `correlation ≥ +0.6` → `relationship = DIRECT` (feature e titolo si muovono insieme)
   - `correlation ≤ -0.6` → `relationship = INVERSE` (feature e titolo si muovono in senso opposto)
   - `-0.42 < correlation < +0.42` → `RANDOM`, non salvato
   - zona borderline (0.42–0.6) → `BORDERLINE`, salvata ma esclusa dai segnali operativi

4. Salva i risultati nella tabella `correlation_scores`:

```
| symbol | source_id | lag_days | correlation | relationship | p_value | window_days | computed_at |
```

`relationship`: `DIRECT` | `INVERSE` | `BORDERLINE` — i record `RANDOM` non vengono persistiti.

> Il campo `relationship` descrive solo il **tipo di legame** tra feature e titolo, non la direzione del segnale finale. Il segnale BULLISH/BEARISH viene calcolato a runtime nella Fase 4.

---

### Fase 3 — Scoring titoli per predittività (`predictability-scorer`)

Il sistema seleziona i titoli analizzando la correlazione grezza (con segno), non il suo valore assoluto. Una correlazione forte può essere **diretta** (l'evento precede un rialzo) o **inversa** (l'evento precede un calo): entrambe sono utili per la predizione.

#### Logica di selezione: gli estremi sono informativi, il centro è rumore

```
Correlazione forte positiva  ≥ +0.6  →  relazione DIRETTA   (feature sale → titolo sale)
                  [zona grigia: da -0.42 a +0.42]  →  RANDOM, scartato
Correlazione forte negativa  ≤ -0.6  →  relazione INVERSA   (feature sale → titolo scende)
```

I titoli nella fascia centrale (-0.42, +0.42) non mostrano un legame statisticamente sfruttabile con la fonte dati: il sistema li ignora per quella coppia (titolo, fonte).

> **Nota importante**: la correlazione (positiva o negativa) definisce solo il tipo di **relazione** (`DIRECT` / `INVERSE`). Il segnale operativo finale (`BULLISH` / `BEARISH`) viene deciso a runtime in base alle condizioni correnti di mercato.

#### Come si calcola il segnale a runtime

Il processo avviene in due step distinti:

1. **Scoperta relazione storica** (offline, settimanale):
   - `DIRECT` (feature e titolo tendono a muoversi nello stesso verso)
   - `INVERSE` (feature e titolo tendono a muoversi in verso opposto)

2. **Decisione operativa runtime** (giornaliera, dopo market close):
   - usa relazione storica + variazione odierna della feature + stato del mercato (regime, volatilità, conferme tecniche);
   - determina il segnale `BULLISH` (bias long) o `BEARISH` (bias short/neutro, secondo policy).

Esempio concettuale:

| Evento oggi | Correlazione storica | Segnale titolo |
| --- | --- | --- |
| VIX **scende** | −0.72 (inversa) | scenario risk-on: bias **BULLISH** |
| VIX **sale** | −0.72 (inversa) | scenario risk-off: bias **BEARISH** |
| S&P500 **sale** | +0.81 (diretta) | bias **BULLISH** se il contesto lo conferma |
| S&P500 **scende** | +0.81 (diretta) | bias **BEARISH** |

#### Predictability Score

Formula robusta consigliata:

```
predictability_score = media pesata delle top-k |correlation| significative
```

Dove i pesi penalizzano:
- instabilità del coefficiente su finestre rolling;
- p-value peggiori;
- bassa persistenza out-of-sample (misurata nel processo di backtest).

Soglie operative (configurabili):

| Fascia | Condizione | Esito |
| --- | --- | --- |
| **Relazione diretta forte** | correlation ≥ +0.6 | Candidato attivo |
| **Relazione inversa forte** | correlation ≤ −0.6 | Candidato attivo |
| **Zona grigia / rumore** | −0.42 < correlation < +0.42 | Scartato per quella coppia |
| **Fascia borderline** | 0.42 ≤ \|correlation\| < 0.6 | Monitorato, non genera segnali operativi |

> Le soglie +0.6 / −0.6 e ±0.42 sono parametri configurabili nel sistema. Vengono affinati tramite il processo di backtest storico.

Questo score viene aggiornato settimanalmente e memorizzato in `universe.ml_predictability_score`.

---

### Fase 4 — Generazione segnali ML (`ml-signal-generator`)

#### V1 — Approccio rule-based (prima implementazione)

Per semplicità e verificabilità, la prima versione è **interamente rule-based**, senza training di modelli ML. Il segnale è determinato direttamente dalla combinazione di relazione storica e variazione odierna della feature:

```
feature_direction = sign(feature_change_oggi)
signal = feature_direction × sign(correlation)
  → +1 = BULLISH
  → −1 = BEARISH
```

Questo approccio è trasparente, interpretabile e verificabile in backtest senza rischi di overfitting.

#### V2 — Approccio ML (evoluzione futura)

In una seconda fase si addestra un modello supervisionato (regressione logistica o gradient boosting) dove:
- **feature input**: vettore delle variazioni odierne delle fonti dati correlate al titolo
- **label target**: `1` se il titolo sale nelle successive `horizon_days` sessioni, `0` altrimenti
- **output**: probabilità `p ∈ [0,1]` → convertita in `BULLISH` se p ≥ 0.55, `BEARISH` se p ≤ 0.45, altrimenti neutro

Il training avviene sul **periodo storico validato** (vedi sezione Backtest), il retraining è trimestrale o su trigger di drift.

#### Struttura del segnale emesso

```json
{
  "symbol": "XLE",
  "signal": "BULLISH",
  "confidence": 0.74,
  "horizon_days": 3,
  "method": "rule_based",
  "top_features": [
    { "source": "VIX", "lag": 1, "correlation": -0.72, "relationship": "INVERSE" },
    { "source": "CL_FUTURES", "lag": 2, "correlation": 0.65, "relationship": "DIRECT" }
  ],
  "generated_at": "2026-03-08T18:00:00Z"
}
```

I segnali vengono pubblicati su Redis (`ml:signals`) e salvati in `ml_signals_daily`.

#### Normalizzazione feature

Prima dell'ingresso nel modello, ogni feature viene normalizzata con **z-score rolling** sulla finestra degli ultimi 252 giorni:

```
feature_normalizzata = (value - rolling_mean) / rolling_std
```

Questo garantisce comparabilità tra fonti con scale molto diverse (VIX: 10–80, S&P500: variazioni di 0.1%–3%).

### Guardrail anti-data-leakage

Ogni feature usa il campo `available_at` della tabella `alt_data_daily` (quando il dato è realmente disponibile al sistema).

Regole:
- training e inferenza usano solo feature con `available_at <= decision_time`;
- macro/news soggetti a revisioni: conservare versione iniziale e, separatamente, versione rivista;
- timezone unica di calcolo (UTC) e mapping esplicito alle sessioni US (chiusura 21:00 UTC).

Senza questo guardrail il backtest risulta ottimistico in modo non realistico.

### Monitoring correlation decay

Le correlazioni cambiano nel tempo (regime shift, cambiamenti strutturali del mercato). Il `correlation-engine` deve rilevare attivamente il decadimento:

- **Alert di decay**: se una coppia attiva (`DIRECT` o `INVERSE`) scende sotto il 60% del valore originale su tre ricalcoli consecutivi, viene retrocessa a `BORDERLINE` e il segnale sospeso
- **Alert di inversione**: se una coppia `DIRECT` diventa `INVERSE` (o viceversa) in modo stabile, viene segnalata per revisione manuale
- **Dashboard admin**: lista delle coppie attive con trend del coefficiente nel tempo (ultima, 1 mese fa, 3 mesi fa)

---

## Validazione storica (Backtest)

Poiché le fonti dati alternative forniscono dati storici (FMP, FRED, Yahoo Finance), è possibile eseguire una **validazione out-of-sample** completa prima di andare in produzione.

### Struttura del processo di backtest

Il processo si divide in tre finestre temporali:

```
|←—————— Training window ——————→|←— Validation window —→|←— Live (oggi) —→|
  [data_inizio]            [cutoff_1]              [cutoff_2]         [oggi]

  - Calcolo correlazioni          - Verifica out-of-sample  - Monitoraggio live
  - Scoperta relazioni            - Hit rate, PnL simulato  - Confronto con attese
  - Tuning soglie                 - Confronto con benchmark
```

**Esempio concreto**:
- Training window: `2021-01-01 → 2023-12-31` (3 anni)
- Validation window: `2024-01-01 → 2025-12-31` (2 anni, non visti in training)
- Live: `2026-01-01 → oggi`

### Come gira il backtest (`ml-backtest-runner`)

1. **Input**: `start_date`, `cutoff_date`, `eval_end_date` (configurabili)
2. **Training phase** (su dati `start_date → cutoff_date`):
   - Calcola `correlation_scores` per tutte le coppie (come Fase 2, ma su finestra storica fissa)
   - Identifica coppie con `|correlation| ≥ 0.6` e p-value corretto
   - Fissa le soglie operative ottimali tramite grid search su dati training
3. **Validation phase** (su dati `cutoff_date → eval_end_date`):
   - Simula la generazione dei segnali giorno per giorno con il modello addestrato
   - Usa **solo dati disponibili al momento della simulazione** (rispetta `available_at`) — nessun lookahead
   - Per ogni segnale generato, registra il rendimento del titolo nelle successive `horizon_days` sessioni
4. **Output metriche**:

| Metrica | Descrizione |
| --- | --- |
| `hit_rate` | % segnali in cui il titolo si è mosso nella direzione prevista |
| `avg_return_on_signal` | Rendimento medio nelle `horizon_days` successive al segnale |
| `sharpe_on_signal` | Sharpe ratio dei trade simulati |
| `max_drawdown` | Massimo drawdown della strategia nel periodo di validazione |
| `vs_buy_and_hold` | Confronto con semplice buy-and-hold dei titoli nel periodo |
| `n_signals_per_ticker` | Numero segnali generati (sanity check: troppi = overfitting) |

### Tabella `ml_backtest_runs`

```
| run_id | start_date | cutoff_date | eval_end_date | config_json | hit_rate | avg_return | sharpe | computed_at |
```

Ogni esecuzione del backtest viene salvata con la configurazione usata (soglie, lag, fonti attive), per confrontare iterazioni diverse.

### Walk-forward validation

Per una validazione più robusta, il backtest può essere eseguito in modalità **walk-forward**: la finestra di training avanza nel tempo con step fisso (es. 6 mesi), producendo N run indipendenti. La performance media e la varianza tra run danno una stima più affidabile della stabilità del modello.

```
Run 1: train [2020-2022]  → test [2023]
Run 2: train [2020-2023]  → test [2024]
Run 3: train [2020-2024]  → test [2025]
→ media hit_rate = X%, deviazione std = Y%
```

---

## Tracking performance live (`ml_signal_performance`)

Dopo il go-live, ogni segnale generato viene tracciato con il suo esito reale:

```
| signal_id | symbol | signal | confidence | horizon_days | price_at_signal | price_at_eval | actual_return | was_correct | generated_at | evaluated_at |
```

Questa tabella alimenta:
- **Dashboard admin**: accuracy rolling degli ultimi 30/90/252 giorni per titolo e per fonte
- **Trigger retraining**: se l'accuracy su finestra 90g scende sotto soglia (es. 52%), il modello viene marcato per revisione
- **Confronto backtest vs live**: verifica che le performance live siano allineate con quelle del backtest (distribution shift alert)

---

## Shadow mode prima dell'integrazione con decision-engine

Prima di collegare i segnali ML al decision-engine in produzione, il sistema opera in **shadow mode** per un periodo minimo di 60 giorni:

- i segnali vengono generati normalmente e salvati in `ml_signals_daily`
- il decision-engine **non li riceve ancora** — continua a operare solo sull'analisi tecnica
- i segnali vengono valutati tramite `ml_signal_performance` con l'esito reale
- solo quando l'accuracy live supera la soglia configurata (es. 55% su 60+ segnali), si abilita l'integrazione

---

## Integrazione con il trading system esistente

### tickerScanner

La pagina di screening può mostrare per ogni titolo:
- badge `ML PREDICTABLE` se il titolo ha almeno una coppia con `|correlation| ≥ 0.6`
- colonna `ML Relationship` con relazione attiva (`DIRECT` / `INVERSE`)
- colonna `ML Signal` con il segnale operativo runtime (`BULLISH` / `BEARISH`)
- dettaglio correlazioni su hover/click: lista delle coppie (fonte, lag, valore, relationship)

### decision-engine

Riceve i segnali ML come input aggiuntivo (opzionale, configurabile per pipe):
- Se ML signal è `BULLISH` e segnale tecnico è positivo → confidence composta aumenta
- Se ML signal contraddice il segnale tecnico → warning, decision-engine riduce la position size

Policy operativa consigliata:
- l'analisi tecnica resta il **gate primario** di esecuzione;
- ML agisce come **overlay di confidence/sizing**;
- se ML e tecnico sono in conflitto, no ingresso automatico oppure size ridotta (configurabile per pipe).
- segnale ML considerato **stale** dopo `horizon_days` sessioni dalla generazione.

### alertingService

Nuova categoria di alert: `ML_SIGNAL_STRONG` — notifica quando un titolo nel portafoglio o watchlist riceve un segnale ML con confidence ≥ 0.7.

---

## Tabelle database (nuove)

| Tabella | Descrizione |
| --- | --- |
| `alt_data_daily` | Valori giornalieri delle fonti dati alternative (con `available_at`) |
| `alt_data_sources` | Catalogo delle fonti (VIX, indici, news, ...) con metadati |
| `correlation_scores` | Correlazioni calcolate per (symbol, source, lag) |
| `ml_signals_daily` | Segnali ML giornalieri per titolo |
| `ml_signal_performance` | Tracking esito reale di ogni segnale generato |
| `ml_backtest_runs` | Storico run di backtest con configurazione e metriche |

Campo aggiunto a `universe`:
- `ml_predictability_score` FLOAT — score di predittività aggiornato settimanalmente

---

## Nuovi microservizi previsti

| Microservizio | Responsabilità |
| --- | --- |
| `alt-data-collector` | Raccolta e normalizzazione dati alternativi (VIX, news, indici) |
| `correlation-engine` | Calcolo correlazioni rolling, scoring predittività, decay monitoring |
| `ml-signal-generator` | Produzione segnali giornalieri per titoli high-predictability |
| `ml-backtest-runner` | Validazione storica out-of-sample, walk-forward, metriche |

Tutti i servizi seguono il pattern `BaseService` e si integrano via `datahub` e `Redis`.

---

## Roadmap di implementazione

### Milestone 1 — Fondamenta dati
- [ ] Definire catalogo fonti dati (`alt_data_sources`) con priorità: VIX, SPY, settori SPDR
- [ ] Implementare `alt-data-collector` con VIX + indici principali
- [ ] Popolare `alt_data_daily` con storico 3 anni (per avere training window adeguata)
- [ ] Pipeline stazionarizzazione: tutti i valori salvati come % change giornaliera

### Milestone 2 — Motore correlazione
- [ ] Implementare `correlation-engine` con calcolo Pearson rolling + correzione FDR
- [ ] Calcolo `ml_predictability_score` per tutti i titoli `universe`
- [ ] Dashboard admin: lista titoli per predittività decrescente + trend correlazione nel tempo
- [ ] Implementare decay monitoring e alert di inversione

### Milestone 3 — Backtest storico
- [ ] Implementare `ml-backtest-runner` con finestre configurabili
- [ ] Prima run: training `[2021-2023]`, validation `[2024-2025]`
- [ ] Walk-forward su 3 run con step 12 mesi
- [ ] Analisi metriche: hit_rate, sharpe, confronto buy-and-hold
- [ ] **Solo se backtest supera soglie**: procedere con Milestone 4

### Milestone 4 — Segnali live (shadow mode)
- [ ] Implementare `ml-signal-generator` V1 rule-based
- [ ] Integrazione Redis channel `ml:signals`
- [ ] Visualizzazione nella pagina tickerScanner
- [ ] Avvio shadow mode (60 giorni minimo, nessuna esecuzione automatica)
- [ ] Tracking `ml_signal_performance` e dashboard accuracy live

### Milestone 5 — Integrazione decision-engine
- [ ] decision-engine legge segnali ML come feature opzionale (solo dopo shadow mode OK)
- [ ] Alert `ML_SIGNAL_STRONG` in alertingService
- [ ] Confronto performance con/senza ML overlay in produzione
- [ ] Valutazione upgrade a V2 (modello ML supervisionato) se V1 stabile

---

## Note tecnologiche

- **Modelli V1**: rule-based (nessun training) — interpretabile, zero rischio overfitting, verificabile in backtest
- **Modelli V2**: regressione logistica o gradient boosting (sklearn/lightgbm) — richiede microservice Python o esecuzione via subprocess
- **Runtime ML**: per V1 Node.js è sufficiente; per V2 valutare Python sidecar container
- **Dati minimi**: correlazione affidabile richiede almeno 252 giorni per coppia; backtest sensato richiede almeno 2 anni training + 1 anno validation
- **Aggiornamento**: correlazioni ricalcolate settimanalmente; segnali prodotti giornalmente dopo market close; backtest rieseguito trimestralmente
- **Validazione**: oltre ad accuracy/hit-rate, monitorare `expectancy`, `max drawdown`, turnover, net PnL dopo costi di transazione stimati
