---
sidebar_position: 5
---

# Fase 3 — Ranking personalizzato per utente

La Fase 3 prende i dati di sistema prodotti dalla Fase 2 e li personalizza per ogni utente, applicando pesi customizzati e filtri definiti dall'utente stesso.

**Frequenza:** giornaliera, dopo il completamento della Fase 2.

Il processo produce due tabelle distinte:

- **`daily_scores`** — indicatori tecnici e score calcolati con pesi di default, organizzata per `(symbol, score_date)`. Non è legata a nessun utente o pipe specifico.
- **`scores_daily`** — score ricalcolati con i pesi personalizzati dell'utente, organizzata per `(symbol, score_date, user_id, pipe_id)`. Ogni combinazione utente/pipe produce una classifica indipendente.

Il risultato finale è la **lista "best-of" del giorno per utente e pipe**.

---

## Scheda operativa

| Voce | Dettaglio |
|---|---|
| Scopo | Produrre ranking utente/pipe personalizzati. |
| Punto di partenza | `daily_scores` + configurazioni utente (`scoring_models`, filtri). |
| Deliverable | `scores_daily` per `(symbol, score_date, user_id, pipe_id)`. |
| Microservizi coinvolti | `tickerscanner`, `scheduler` (trigger), potenzialmente `authservice`/`datahub` per contesto utente. |

## Parametri di pilotaggio

| Parametro | Tipo | Uso |
|---|---|---|
| `userId` | numero | Identifica il perimetro utente da processare. |
| `pipeId` | numero | Seleziona la strategia/pipeline utente. |
| `targetDate`/`score_date` | data | Data di riferimento dello scoring. |
| `filters` | oggetto | Regole inclusione/esclusione simboli. |
| `weights` | oggetto | Pesi custom sui componenti di score. |
| `mode` | `normal`/`force` | Ricalcolo idempotente o rigenerazione completa. |

---

## Concetto di "Pipe"

Una **pipe** è una configurazione di scoring indipendente. Ogni utente può avere più pipe, ognuna con pesi e filtri diversi per strategia:

| Esempio pipe | Logica |
|---|---|
| Pipe 1 — Default | Pesi di sistema, nessun filtro |
| Pipe 2 — Value | Valuation al 60%, quality al 40%, esclude momentum |
| Pipe 3 — ETF Momentum | Solo ETF, risk 50%, momentum 50% |
| Pipe 4 — Growth | Quality al 50%, momentum al 30%, esclude settori ciclici |

Ogni pipe produce una classifica separata e indipendente.

:::note Nota su pipeId=0
Il `pipeId=0` è riservato al sistema e non è una pipe utente. Identifica il ranking globale di sistema generato dalla **[Fase 4](./fase-4-ranking)** (`AST_RANKING_DAILY`), che il `decision-engine` usa come sorgente quando elabora segnali su tutti i simboli senza una configurazione utente specifica. Le pipe utente iniziano sempre da 1.
:::

---

## Pesi personalizzati

L'utente può ridefinire il peso di ogni componente di score nella formula del `total_score`. I pesi devono sommare a 1.

| Componente | Default (azioni) | Default (ETF) | Personalizzabile |
|---|---|---|---|
| `valuation_score` | 30% | 0% | Sì |
| `quality_score` | 40% | 0% | Sì |
| `risk_score` | 20% | 50% | Sì |
| `momentum_score` | 10% | 50% | Sì |

I pesi possono essere definiti anche a un livello più granulare:

- **Momentum long vs short** — quanto peso dare al momentum di lungo vs breve periodo
- **Volume score** — quanto peso dare alla componente di volume nel momentum
- **Market risk** — quanto peso dare al rischio di mercato corrente nel risk score

I pesi sono salvati nella tabella `scoring_models` con versioning, in modo da poter ricostruire esattamente come è stato calcolato uno score in qualsiasi data passata.

---

## Filtri utente

I filtri permettono di escludere o includere titoli in base a criteri specifici. Ogni filtro è una condizione su un campo di `universe` o `daily_scores`.

**Esempi di filtri tipici:**

| Filtro | Tipo | Esempio |
|---|---|---|
| Settore | Inclusione | Solo `Technology`, `Healthcare` |
| ETF | Esclusione | Escludi `is_etf = 1` |
| Capitalizzazione | Soglia minima | Solo `market_cap > 1B USD` |
| Liquidità | Soglia minima | Solo `dollar_vol_20d > 500k USD` |
| Score minimo | Soglia | Solo `total_score > 60` |
| Paese | Inclusione/Esclusione | Solo USA |
| Volatilità | Soglia massima | Solo `atr_14_pct < 5%` |

I filtri vengono applicati **prima** del ranking, in modo da escludere i titoli non conformi dalla classifica finale.

---

## Output: due tabelle distinte

### `daily_scores` — score di sistema (non legata all'utente)

Chiave primaria: `(symbol, score_date)`.

Viene scritta una volta sola per ogni simbolo e data, indipendentemente da chi ha avviato il job. Se il job viene rieseguito per la stessa data, i record vengono aggiornati (upsert).

| Campo | Descrizione |
|---|---|
| `price` | Prezzo di chiusura alla data |
| `ret_1d` / `ret_5d` / `ret_20d` / `ret_60d` | Rendimenti su 1, 5, 20, 60 giorni |
| `sma_10` / `sma_20` / `sma_50` / `sma_200` | Medie mobili semplici |
| `sma_20_slope` / `sma_50_slope` | Pendenza delle SMA (trend direction) |
| `atr_14` | Average True Range 14 giorni (volatilità assoluta) |
| `atr_14_pct` | ATR normalizzato sul prezzo (volatilità relativa %) |
| `rsi_14` | RSI 14 giorni |
| `avg_gap_20` | Gap overnight medio su 20 giorni |
| `max_dd_60` | Drawdown massimo su 60 giorni |
| `dollar_vol_20d` | Volume in dollari medio su 20 giorni |
| `valuation_score` | Componente valutazione |
| `quality_score` | Componente qualità |
| `risk_score` | Risk strutturale |
| `momentum_score` | Momentum di lungo periodo |
| `momentum_short_score` | Momentum di breve periodo |
| `momentum_volume_score` | Componente volume del momentum |
| `total_score` | Score totale |
| `growth_probability` | Probabilità di crescita (0–100) |
| `momentum_json` | Dettaglio completo del calcolo momentum |
| `scores_json` | Score accessori (market_score, market_risk_score, short_risk_score) |

### `scores_daily` — score personalizzati per utente/pipe

Chiave primaria: `(symbol, score_date, user_id, pipe_id)`.

Per ogni combinazione utente/pipe viene salvata una riga con gli score ricalcolati usando i pesi configurati dall'utente.

| Campo | Descrizione |
|---|---|
| `total_score` | Score totale ricalcolato con i pesi dell'utente |
| `valuation_score` | Componente valutazione |
| `quality_score` | Componente qualità |
| `risk_score` | Risk strutturale |
| `momentum_score` | Momentum di lungo periodo (ricalcolato con pesi utente) |
| `momentum_score_short` | Momentum di breve periodo |
| `volume_score` | Score volume |
| `market_score` | Score mercato |
| `market_risk_score` | Risk di mercato corrente |
| `short_risk_score` | Risk composito breve = structural×60% + market×40% |
| `growth_probability` | Probabilità di crescita (0–100) |
| `model_id` | ID del modello di scoring usato (`scoring_models`) |
| `model_version` | Versione del modello (per riproducibilità storica) |

---

## Come leggere i risultati

### Recupero per data

```
GET /tickerscanner/fundamentals/scores-daily/by-user/:pipeId/:scoreDate
```

Restituisce tutti i simboli con il loro score personalizzato per la pipe e la data richiesta, già ordinati per `total_score` decrescente.

### Conteggio disponibilità date

```
GET /tickerscanner/fundamentals/scores-daily/counts/:pipeId
```

Restituisce le date per cui sono disponibili dati di scoring per quella pipe. Utile per popolare un selettore di date nel frontend.

---

## Audit e riproducibilità

Per garantire che i risultati del passato siano sempre riproducibili:

- Ogni riga di `scores_daily` è collegata al `model_id` del modello di pesi usato
- La tabella `scoring_models` conserva la versione storica dei pesi con `valid_from` e `valid_to`
- Se l'utente cambia i propri pesi, una nuova versione del modello viene creata e le righe future useranno la nuova versione

---

## Fase successiva

L'output di questa fase (`scores_daily`) è disponibile alle watchlist personalizzate degli utenti nel frontend. Parallelamente, se non ancora eseguita, può essere avviata la **[Fase 4: Ranking di sistema](./fase-4-ranking)**, che parte dalla stessa sorgente (`daily_scores`) ma produce un ranking globale indipendente dall'utente.

---

## Avvio manuale

```http
POST /tickerscanner/fundamentals/user-daily-scores
```

Body:
```json
{
  "userId": 1,
  "pipeId": 0,
  "targetDate": "2026-03-15"
}
```

Body con pipe specifica:
```json
{
  "userId": 1,
  "pipeId": 2,
  "targetDate": "2026-03-15"
}
```

Risponde subito con un `jobId`. Lo stato del job può essere monitorato con:

```http
GET /tickerscanner/fundamentals/user-daily-score-jobs
```

---

## Errori comuni e recovery

| Errore | Causa probabile | Recovery |
|---|---|---|
| `scores_daily` vuota per una data | Fase 3 non eseguita o Fase 2 non ancora completata | Verificare che `daily_scores` esista per la data; poi avviare il job |
| Score identici per tutti gli utenti | Pesi personalizzati non configurati | Verificare la configurazione in `scoring_models` per userId/pipeId |
| Job completato ma nessun simbolo scritto | Nessun simbolo supera i filtri configurati | Allentare i filtri utente (es. abbassare `min_total_score`) |
| Risultati non aggiornati dopo modifica pesi | Vecchi dati in `scores_daily` non rigenerati | Rieseguire con `mode=force` per sovrascrivere i dati esistenti |
| `pipeId` non trovata | Pipe non configurata per l'utente | Creare la configurazione pipe in `scoring_models` prima di eseguire |
