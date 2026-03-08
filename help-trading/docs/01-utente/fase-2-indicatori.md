---
sidebar_position: 4
---

# Fase 2 — Indicatori tecnici e scoring giornaliero

La Fase 2 viene eseguita ogni giorno dopo la chiusura dei mercati. Legge i dati fondamentali da `universe` e i prezzi storici da `market_daily`, poi calcola tutti gli indicatori tecnici e gli score di sistema per ogni simbolo.

Il risultato viene salvato in **`daily_scores`** con chiave `(symbol, score_date)`, costruendo uno storico giornaliero completo.

---

## Scheda operativa

| Voce | Dettaglio |
|---|---|
| Scopo | Generare indicatori e score di sistema standardizzati. |
| Punto di partenza | `universe` + storico prezzi (`market_daily`). |
| Deliverable | `daily_scores` giornaliero (chiave `(symbol, score_date)`). |
| Microservizi coinvolti | `tickerscanner`, `cachemanager`, `scheduler`. |

## Parametri di pilotaggio

| Parametro | Tipo | Uso |
|---|---|---|
| `score_date` | data | Data logica di calcolo. |
| `symbols` | lista opzionale | Ricalcolo selettivo per subset ticker. |
| `mode` | `normal`/`force` | Gestione idempotenza e ricalcolo completo. |
| `provider` | enum | Scelta provider dati prezzo quando previsto. |
| `limit`/`batchSize` | numero | Controllo throughput job e consumo risorse. |

---

## Struttura della tabella `daily_scores`

### Prezzi e rendimenti

| Campo | Descrizione |
|---|---|
| `price` | Prezzo di chiusura del giorno |
| `ret_1d` | Rendimento sull'ultimo giorno di trading |
| `ret_5d` | Rendimento sugli ultimi 5 giorni (~1 settimana) |
| `ret_20d` | Rendimento sugli ultimi 20 giorni (~1 mese) |
| `ret_60d` | Rendimento sugli ultimi 60 giorni (~3 mesi) |

I rendimenti sono espressi come variazione decimale (es. `0.05` = +5%).

### Medie mobili semplici (SMA)

Le **Simple Moving Average** sono la media aritmetica dei prezzi di chiusura sugli ultimi N giorni. Servono a identificare la direzione del trend principale.

| Campo | Periodo | Utilizzo tipico |
|---|---|---|
| `sma_10` | 10 giorni | Trend di brevissimo periodo |
| `sma_20` | 20 giorni | Trend di breve periodo (~1 mese) |
| `sma_50` | 50 giorni | Trend di medio periodo (~2 mesi) |
| `sma_200` | 200 giorni | Trend di lungo periodo (~10 mesi) |

**Lettura:** quando il prezzo è sopra la SMA50, il titolo è in uptrend di medio periodo. Quando SMA50 > SMA200, si parla di "golden cross" (segnale rialzista).

### Slope delle medie mobili

| Campo | Descrizione |
|---|---|
| `sma_20_slope` | Pendenza (variazione normalizzata) della SMA20 — positivo = trend crescente |
| `sma_50_slope` | Pendenza della SMA50 |

La slope indica non solo la direzione del trend, ma anche la sua accelerazione o decelerazione.

### Volatilità — ATR (Average True Range)

L'**ATR a 14 periodi** misura la volatilità media giornaliera di un titolo, calcolata sul range reale (considerando anche i gap tra la chiusura precedente e l'apertura del giorno successivo).

| Campo | Descrizione |
|---|---|
| `atr_14` | ATR assoluto in USD |
| `atr_14_pct` | ATR come percentuale del prezzo corrente |

**Utilizzo:** l'ATR viene usato per dimensionare gli stop loss (es. "stop a 2×ATR dal prezzo di entrata") e per confrontare la volatilità tra titoli con prezzi molto diversi.

### RSI — Relative Strength Index

Il **RSI a 14 periodi** è un oscillatore che misura la forza e la velocità dei movimenti di prezzo, con valori tra 0 e 100.

| Campo | Valore | Interpretazione |
|---|---|---|
| `rsi_14` | < 30 | Ipervenduto — possibile rimbalzo |
| `rsi_14` | 30 – 50 | Debolezza — trend ribassista |
| `rsi_14` | 50 – 70 | Forza — trend rialzista |
| `rsi_14` | > 70 | Ipercomprato — possibile correzione |

Il RSI viene usato sia come segnale di inversione (divergenze) sia come conferma del trend.

### Gap medio e drawdown

| Campo | Descrizione |
|---|---|
| `avg_gap_20` | Gap medio overnight (apertura - chiusura precedente) sugli ultimi 20 giorni, in percentuale. Gap positivi frequenti indicano domanda sostenuta. |
| `max_dd_60` | Maximum Drawdown sugli ultimi 60 giorni: la perdita massima dal picco locale. Misura il rischio reale sopportato da chi ha comprato in un momento sfortunato. |

### Volume

| Campo | Descrizione |
|---|---|
| `dollar_vol_20d` | Dollar volume medio sugli ultimi 20 giorni = prezzo × volume. Indica la liquidità effettiva del titolo (non il numero di azioni scambiate, ma il valore in USD). |

Un `dollar_vol_20d` elevato garantisce che sia possibile entrare e uscire da posizioni significative senza impatto sul prezzo.

---

## Score di sistema

Gli score sono numeri in scala **0–100** (0 = pessimo, 100 = eccellente), calcolati con **pesi di default** uguali per tutti gli utenti. Ogni utente può poi personalizzarli in Fase 3.

### Valuation Score

Misura quanto il titolo è economico rispetto al suo valore intrinseco. Rilevante solo per azioni (non ETF).

**Componenti e pesi (media aritmetica dei componenti non-null):**

| Componente | Fonte | Descrizione |
|---|---|---|
| `pe_score` | PE ratio | Score PE (vedi Fase 1) |
| `pb_score` | PB ratio | Score PB (vedi Fase 1) |
| `dcf_score` | DCF upside | Upside DCF normalizzato tra -20% e +50% |

### Quality Score

Misura la solidità e la profittabilità dell'azienda. Rilevante solo per azioni (non ETF).

**Componenti:**

| Componente | Fonte | Descrizione |
|---|---|---|
| `roe_score` | ROE | Return on Equity (vedi Fase 1) |
| `roa_score` | ROA | Return on Assets (vedi Fase 1) |
| `op_margin_score` | Margine operativo | Efficienza operativa (vedi Fase 1) |
| `piot_score` | Piotroski F-Score | Salute finanziaria (0–9 → 0–100) |

### Risk Score

Misura la rischiosità strutturale del titolo. Valido anche per ETF (solo beta).

**Componenti:**

| Componente | Fonte | Descrizione |
|---|---|---|
| `beta_score` | Beta | Distanza da beta=1: score = (1 - \|beta-1\|/1.5) × 100 |
| `debt_equity_score` | D/E ratio | Leva finanziaria (vedi Fase 1) |
| `altman_z_score` | Altman Z | Rischio insolvenza, normalizzato tra 1 e 3 |

**Nota Beta:** il punteggio è massimo (100) per beta=1 (perfettamente allineato al mercato) e diminuisce sia per beta troppo basso (&lt;0, inversamente correlato) sia per beta troppo alto (&gt;2, molto più volatile del mercato).

### Score di Momentum

Gli score di momentum derivano dall'analisi tecnica dei prezzi e dei volumi storici. Sono calcolati dal `MomentumCalculator` che usa le candele OHLCV degli ultimi 12+ mesi.

#### Momentum Long Score
Cattura il momentum di lungo periodo (1, 3, 6, 12 mesi) e la qualità del trend.

| Sotto-componente | Descrizione |
|---|---|
| `mom12mScore` | Performance sull'anno solare vs peers |
| `mom6mScore` | Performance sui 6 mesi |
| `mom3mScore` | Performance sugli ultimi 3 mesi |
| `mom1mScore` | Performance sull'ultimo mese |
| `trendScore` | Qualità e coerenza del trend (SMA alignment) |

#### Momentum Short Score
Cattura il momentum di breve-medio periodo (settimane).

| Sotto-componente | Descrizione |
|---|---|
| `retScore` | Rendimento recente normalizzato |
| `trendScoreNorm` | Allineamento del prezzo alle medie mobili |
| `structureScoreNorm` | Struttura di minimi e massimi crescenti/decrescenti |
| `rsiScore` | RSI normalizzato (favorisce zone 50–70) |

#### Volume Score
Valuta la qualità e la direzione dei volumi.

| Sotto-componente | Descrizione |
|---|---|
| `volSpikeScore` | Picchi di volume nelle sessioni rialziste vs ribassiste |
| `directionalVolume` | Prevalenza di giorni ad alto volume rialzista |
| `efficiencyScore` | Efficienza del movimento (rendimento per unità di volume) |
| `rangeScore` | Ampiezza delle candele nei giorni ad alto volume |

#### Market Risk Score
Valuta il rischio di mercato corrente (volatilità, drawdown, gap risk).

| Sotto-componente | Descrizione |
|---|---|
| `volSafe` | Sicurezza rispetto alla volatilità storica (ATR) |
| `ddSafe` | Sicurezza rispetto al drawdown massimo recente |
| `gapSafe` | Sicurezza rispetto ai gap overnight |
| `trendSafe` | Sicurezza rispetto alla direzione del trend |

### Score totale (default)

Il `total_score` è la media ponderata degli score principali con i pesi di default:

| Score | Peso (Azioni) | Peso (ETF) |
|---|---|---|
| Valuation Score | 30% | — |
| Quality Score | 40% | — |
| Risk Score | 20% | 50% |
| Momentum Score | 10% | 50% |

:::info Personalizzazione
Questi sono i pesi di **sistema**, usati per `daily_scores`. Ogni utente può impostare pesi diversi in Fase 3, generando un `total_score` personalizzato in `scores_daily`.
:::

### Growth Probability

Un indicatore composito che stima la probabilità che il titolo abbia una performance positiva nel breve periodo, combinando forza del trend, rischio e momentum.

---

## Fase successiva

L'output di questa fase (`daily_scores`) è il punto di partenza di due percorsi paralleli:

- **[Fase 3: Ranking personalizzato](./fase-3-filtro)** — ricalcola gli score con i pesi dell'utente e genera classifiche per ogni combinazione utente/pipe in `scores_daily`.
- **[Fase 4: Ranking di sistema](./fase-4-ranking)** — usa gli score di default per produrre il ranking globale per bucket di asset in `AST_RANKING_DAILY`.

---

## Frequenza e aggiornamento

- La Fase 2a aggiorna prima `market_daily` con i prezzi EOD del giorno
- La Fase 2b legge da `market_daily` e `universe`, calcola tutto e scrive in `daily_scores`
- I dati vengono aggiunti come nuova riga giornaliera (non sovrascrivono i giorni precedenti)
- Il sistema mantiene quindi uno **storico completo** di indicatori e score, interrogabile per qualsiasi data

---

## Avvio manuale e monitoraggio

### Fase 2a — Aggiornamento prezzi EOD (`market_daily`)

```http
POST /tickerscanner/fundamentals/update-market-daily
```

Body opzionale:
```json
{
  "score_date": "2026-03-15",
  "mode": "normal"
}
```

Risponde con `jobId`. Scarica i prezzi di chiusura del giorno da FMP per tutti i simboli in `universe`.

### Fase 2b — Calcolo indicatori e score (`daily_scores`)

Il calcolo degli score avviene automaticamente dopo l'aggiornamento `market_daily`, oppure può essere avviato manualmente. Lo stato del job può essere monitorato con:

```http
GET /tickerscanner/fundamentals/market-daily-jobs
```

### Verifica dati prodotti

```http
GET /tickerscanner/fundamentals/market-daily/compare?score_date=2026-03-15
```

Confronta il numero di simboli in `universe` con quelli aggiornati in `market_daily` per la data, utile per rilevare simboli mancanti.

---

## Errori comuni e recovery

| Errore | Causa probabile | Recovery |
|---|---|---|
| `daily_scores` vuota per una data | Fase 2 non ancora eseguita per quella data | Avviare `update-market-daily` con la data desiderata |
| Simbolo senza score | Prezzi storici insufficienti (< 200 candele) | Atteso per ticker nuovi; si autocorregge col tempo |
| Score invariati rispetto al giorno prima | `mode=normal` ha rilevato dati già presenti | Usare `mode=force` per rigenerare |
| `market_daily` aggiornata ma `daily_scores` no | Job 2b non eseguito o fallito | Controllare i log del job; riavviare il calcolo score |
| Prezzi anomali o spike nei rendimenti | Dati FMP errati (split non gestito, dati mancanti) | Segnalare il simbolo; escluderlo temporaneamente dalla scansione |
