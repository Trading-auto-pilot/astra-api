---
sidebar_position: 3
title: ML Prediction — Predizione basata su correlazioni esterne
---

# ML Prediction — Sistema di predizione basato su correlazioni esterne

## Obiettivo

Affiancare l'analisi tecnica con un sistema di **Machine Learning predittivo** che identifica automaticamente i titoli/ETF per cui esiste una correlazione misurabile tra eventi esterni e variazioni di prezzo future.

Il sistema **non sostituisce** l'analisi tecnica: la integra. Un segnale ML forte, combinato con un segnale tecnico favorevole, aumenta la probabilità di successo dell'operazione.

> **Principio chiave**: il sistema opera solo su titoli per cui la correlazione è dimostrata statisticamente. Per tutti gli altri, non produce segnali.

---

## Idea centrale: correlazione temporale ritardata

Il mercato spesso reagisce a eventi esterni con un ritardo misurabile. Il sistema sfrutta questa caratteristica:

```
Evento esterno (T)  →  [ritardo 1g–7g]  →  Variazione prezzo (T+n)
```

Esempi concreti:
- Un aumento del VIX oggi → calo del titolo X domani (correlazione negativa con lag 1g)
- Un articolo positivo sul settore energia → rialzo dell'ETF energia in 3 giorni
- Il rialzo di un indice europeo oggi → apertura rialzista di un titolo correlato domani

Il valore del lag (ritardo) è **scoperto automaticamente** dal sistema per ogni coppia (titolo, fonte dati).

---

## Fonti dati alternative (Feature Sources)

| Categoria | Esempi | Formato |
| --- | --- | --- |
| **Indici macro** | VIX, S&P 500, NASDAQ, settore SPDR | Valore numerico giornaliero |
| **Indici correlati** | Euro STOXX 50, Nikkei, FTSE 100 | Valore numerico giornaliero |
| **Altri titoli con lag** | Un ETF che anticipa un settore, un future | Variazione % giornaliera |
| **News sentiment** | Sentiment aggregato per settore/ticker da titoli notizie | Score [-1, +1] per giorno |
| **Dati macro** | Tassi FED, CPI, NFP, earnings calendar | Evento + valore |
| **Stagionalità** | Giorno settimana, mese, quarter, exdate | Feature categoriche |
| **Volatilità/Opzioni** | VIX term structure (VIX/VIX3M), VVIX, put/call ratio | Valore numerico giornaliero |
| **Credito/Tassi** | HY spread, IG spread, real yields, curva 2s10s | Valore numerico giornaliero |
| **Breadth/Flussi** | Advance/Decline, nuovi massimi/minimi, ETF flows settoriali | Valore numerico giornaliero |

---

## Architettura del sistema

Il sistema si compone di quattro fasi:

### Fase 1 — Raccolta continua dati alternativi (`alt-data-collector`)

Un nuovo microservizio raccoglie e normalizza le fonti dati esterne su base giornaliera:

- Scarica VIX, indici principali, titoli "correlatori" (configurabili)
- Calcola sentiment score giornaliero da news (FMP News API o simile)
- Normalizza tutto in una tabella `alt_data_daily` con struttura:

```
| date | source_id | value | source_type |
```

Il servizio gira come job schedulato giornaliero (dopo market close).

---

### Fase 2 — Motore di correlazione (`correlation-engine`)

Analizza storicamente le correlazioni tra le fonti dati e i prezzi futuri dei titoli:

1. Per ogni titolo nell'`universe`, per ogni fonte dati disponibile:
   - Calcola la correlazione tra `feature[T]` e `price_change[T+lag]` per lag in [1, 2, 3, 5, 7, 10, 14] giorni
   - Usa **Pearson correlation** per dati continui, **Point-Biserial** per eventi binari
   - Usa **rolling window** (es. ultimi 252 giorni) per avere una correlazione aggiornata

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

Il sistema seleziona i titoli analizzando la correlazione grezza (con segno), non il suo valore assoluto. Una correlazione forte può essere **positiva** (l'evento precede un rialzo) o **negativa** (l'evento precede un calo): entrambe sono utili per la predizione.

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

1. **Scoperta relazione storica**:
   - `DIRECT` (feature e titolo tendono a muoversi nello stesso verso)
   - `INVERSE` (feature e titolo tendono a muoversi in verso opposto)

2. **Decisione operativa runtime**:
   - usa relazione storica + stato corrente del mercato (regime, volatilità, conferme tecniche, guardrail);
   - determina il segnale `BULLISH` (apertura long) o `BEARISH` (short/nessun long, secondo policy).

Esempio concettuale:

| Evento oggi | Correlazione storica | Segnale titolo |
| --- | --- | --- |
| VIX **scende** | −0.72 (inversa) | candidato scenario risk-on: può risultare **BULLISH** se confermato dal contesto |
| VIX **sale** | −0.72 (inversa) | candidato scenario risk-off: può risultare **BEARISH** |
| S&P500 **sale** | +0.81 (diretta) | bias potenzialmente **BULLISH** se il contesto lo conferma |
| S&P500 **scende** | +0.81 (diretta) | bias potenzialmente **BEARISH** |

Quindi: il modello identifica prima una relazione affidabile; il verso operativo finale viene deciso dal motore in base alle condizioni di mercato correnti.

#### Predictability Score

Formula robusta consigliata:

```
predictability_score = media pesata delle top-k |correlation| significative
```

Dove i pesi penalizzano:
- instabilità del coefficiente su finestre rolling;
- p-value peggiori;
- bassa persistenza out-of-sample.

`max(|correlation|)` può restare come metrica diagnostica, ma non come score operativo principale.

Soglie operative (configurabili):

| Fascia | Condizione | Esito |
| --- | --- | --- |
| **Relazione diretta forte** | correlation ≥ +0.6 | Candidato attivo |
| **Relazione inversa forte** | correlation ≤ −0.6 | Candidato attivo |
| **Zona grigia / rumore** | −0.42 < correlation < +0.42 | Scartato per quella coppia |
| **Fascia borderline** | 0.42 ≤ \|correlation\| < 0.6 | Monitorato, non genera segnali operativi |

> Le soglie +0.6 / −0.6 e ±0.42 sono parametri configurabili nel sistema. Vengono affinati nel tempo tramite backtest.

Questo score viene aggiornato settimanalmente e memorizzato in `universe.ml_predictability_score`.

---

### Fase 4 — Generazione segnali ML (`ml-signal-generator`)

Per i titoli ad alta predittività, quando arriva il dato giornaliero della fonte correlata:

1. Recupera le correlazioni significative per quel titolo
2. Costruisce un feature vector con i valori attuali delle fonti
3. Applica un modello predittivo (partenza: **regressione logistica** o **gradient boosting** su feature normalizzate)
4. Produce un segnale:

```json
{
  "symbol": "XLE",
  "signal": "BULLISH",
  "confidence": 0.74,
  "horizon_days": 3,
  "top_features": [
    { "source": "VIX", "lag": 1, "correlation": -0.62 },
    { "source": "CL_FUTURES", "lag": 2, "correlation": 0.58 }
  ],
  "generated_at": "2026-03-08T18:00:00Z"
}
```

I segnali vengono pubblicati su Redis (`ml:signals`) e salvati in `ml_signals_daily`.

### Guardrail anti-data-leakage

Ogni feature deve avere un timestamp `available_at` (quando il dato è realmente disponibile al sistema).

Regole:
- training e inferenza usano solo feature con `available_at <= decision_time`;
- macro/news soggetti a revisioni: conservare versione iniziale e, separatamente, versione rivista;
- timezone unica di calcolo (consigliato UTC) e mapping esplicito alle sessioni US.

Senza questo guardrail il backtest può risultare ottimistico in modo non realistico.

---

## Integrazione con il trading system esistente

### tickerScanner

La pagina di screening può mostrare per ogni titolo:
- badge `ML PREDICTABLE` se il titolo ha almeno una coppia con `|correlation| ≥ 0.6`
- colonna `ML Relationship` con relazione attiva (`DIRECT` / `INVERSE`)
- colonna `ML Signal` con il segnale operativo runtime (`BULLISH` / `BEARISH`) determinato dalle condizioni di mercato correnti
- dettaglio correlazioni su hover/click: lista delle coppie (fonte, lag, valore) con indicazione della direzione

### decision-engine

Riceve i segnali ML come input aggiuntivo (opzionale, configurabile per pipe):
- Se ML signal è `BULLISH` e segnale tecnico è positivo → confidence composta aumenta
- Se ML signal contraddice il segnale tecnico → warning, decision-engine può ridurre la position size

Policy operativa consigliata:
- l'analisi tecnica resta il gate primario di esecuzione;
- ML agisce come **overlay di confidence/sizing**;
- se ML e tecnico sono in conflitto, no ingresso automatico oppure size ridotta (configurabile).

### alertingService

Nuova categoria di alert: `ML_SIGNAL_STRONG` — notifica quando un titolo nel portafoglio o watchlist riceve un segnale ML con confidence ≥ 0.7.

---

## Tabelle database (nuove)

| Tabella | Descrizione |
| --- | --- |
| `alt_data_daily` | Valori giornalieri delle fonti dati alternative |
| `alt_data_sources` | Catalogo delle fonti (VIX, indici, news, ...) con metadati |
| `correlation_scores` | Correlazioni calcolate per (symbol, source, lag) |
| `ml_signals_daily` | Segnali ML giornalieri per titolo |

Campo aggiunto a `universe`:
- `ml_predictability_score` FLOAT — score di predittività aggiornato settimanalmente

---

## Nuovi microservizi previsti

| Microservizio | Responsabilità |
| --- | --- |
| `alt-data-collector` | Raccolta e normalizzazione dati alternativi (VIX, news, indici) |
| `correlation-engine` | Calcolo correlazioni temporali rolling, scoring predittività |
| `ml-signal-generator` | Produzione segnali ML giornalieri per titoli high-predictability |

Tutti e tre i servizi seguono il pattern `BaseService` e si integrano via `datahub` e `Redis`.

---

## Roadmap di implementazione

### Milestone 1 — Fondamenta dati
- [ ] Definire catalogo fonti dati (`alt_data_sources`)
- [ ] Implementare `alt-data-collector` con VIX + indici principali
- [ ] Popolare `alt_data_daily` con storico 2 anni

### Milestone 2 — Motore correlazione
- [ ] Implementare `correlation-engine` con calcolo Pearson rolling
- [ ] Calcolo `ml_predictability_score` per tutti i titoli `universe`
- [ ] Dashboard admin: lista titoli per predittività decrescente

### Milestone 3 — Segnali
- [ ] Implementare `ml-signal-generator` con regressione logistica
- [ ] Integrazione Redis channel `ml:signals`
- [ ] Visualizzazione nella pagina tickerScanner

### Milestone 4 — Integrazione decision-engine
- [ ] decision-engine legge segnali ML come feature opzionale
- [ ] Alert `ML_SIGNAL_STRONG` in alertingService
- [ ] Backtest: confronto performance con/senza ML overlay
- [ ] Walk-forward validation con costi/slippage e test di robustezza out-of-sample

---

## Note tecnologiche

- **Modelli**: si parte con modelli interpretabili (regressione logistica, gradient boosting con SHAP) — evitare black-box nella prima versione
- **Runtime ML**: possibile uso di `Python` microservice o librerie JS (`ml-regression`, `brain.js`) per semplicità infrastrutturale
- **Dati minimi**: correlazione affidabile richiede almeno 252 giorni di storico per entrambe le serie
- **Aggiornamento**: correlazioni ricalcolate settimanalmente; segnali prodotti giornalmente dopo market close
- **Validazione**: oltre ad accuracy/hit-rate, monitorare metriche trading (`expectancy`, `max drawdown`, turnover, net PnL dopo costi)
