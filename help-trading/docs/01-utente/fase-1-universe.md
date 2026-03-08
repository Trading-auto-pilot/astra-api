---
sidebar_position: 3
---

# Fase 1 — Raccolta universo (Universe Scan)

La Fase 1 costruisce e mantiene aggiornato il catalogo completo di tutti gli strumenti finanziari monitorati dalla piattaforma. È la base dati su cui si appoggiano le fasi successive.

**Frequenza consigliata:** ogni 2–4 settimane, o dopo eventi di mercato significativi (es. fusioni, delistings, nuove IPO).

---

## Scheda operativa

| Voce | Dettaglio |
|---|---|
| Scopo | Popolare e mantenere il catalogo strumenti e fondamentali di base. |
| Punto di partenza | Simboli da processare + API esterne FMP. |
| Deliverable | Tabella `universe` aggiornata (`upsert` su `symbol`). |
| Microservizi coinvolti | `tickerscanner` (fase attiva), `scheduler` (orchestrazione). |

## Parametri di pilotaggio

| Parametro | Tipo | Uso |
|---|---|---|
| `mode` | `normal`/`force` | In `force` ricalcola integralmente; in `normal` privilegia aggiornamenti incrementali. |
| `symbols` | lista opzionale | Limita il perimetro a sottoinsiemi specifici. |
| `batchSize` | numero | Controlla il carico verso provider esterni e DB. |
| `retry`/`timeout` | numero | Regola resilienza su chiamate API esterne. |

---

## Cosa viene recuperato

Per ogni simbolo, vengono chiamate le seguenti API di Financial Modeling Prep:

| Chiamata FMP | Dati recuperati |
|---|---|
| `/stable/profile` | Settore, paese, capitalizzazione, flag ETF/ADR/Fund, prezzo corrente, beta |
| `/stable/key-metrics` | PE, PB, ROE, ROA, margine operativo, D/E, metriche chiave TTM |
| `/stable/ratios` | Ratios finanziari dettagliati |
| `/stable/financial-scores` | Piotroski F-Score, Altman Z-Score |
| `/stable/discounted-cash-flow` | Valore DCF e upside rispetto al prezzo corrente |

---

## Dati salvati in `universe`

### Classificazione

| Campo | Tipo | Descrizione |
|---|---|---|
| `symbol` | `VARCHAR(20)` PK | Ticker di borsa (es. `AAPL`) |
| `is_etf` | `TINYINT` | `1` se è un ETF |
| `is_actively_trading` | `TINYINT` | `1` se il titolo è attivamente scambiato |
| `is_adr` | `TINYINT` | `1` se è un ADR (American Depositary Receipt) |
| `is_fund` | `TINYINT` | `1` se è un fondo |
| `sector` | `VARCHAR` | Settore GICS (es. `Technology`) |
| `industry` | `VARCHAR` | Sotto-settore (es. `Consumer Electronics`) |
| `country` | `VARCHAR` | Paese di quotazione |
| `exchange_full_name` | `VARCHAR` | Borsa (es. `NASDAQ Global Select Market`) |
| `market_cap` | `DECIMAL` | Capitalizzazione di mercato in USD |

### Metriche fondamentali

| Campo | Fonte | Descrizione |
|---|---|---|
| `beta` | Profile | Sensibilità al mercato (1 = neutro, >1 più volatile) |
| `pe` | Key Metrics TTM | Price / Earnings ratio |
| `pb` | Key Metrics TTM | Price / Book ratio |
| `roe` | Ratios | Return on Equity — redditività del patrimonio netto |
| `roa` | Ratios | Return on Assets — redditività degli attivi totali |
| `op_margin` | Ratios | Margine operativo — efficienza operativa |
| `piotroski` | Financial Scores | Piotroski F-Score (0–9, vedi sotto) |
| `debt_equity` | Ratios | Debt-to-Equity ratio — leva finanziaria |
| `altman_z` | Financial Scores | Altman Z-Score (vedi sotto) |
| `dcf_upside` | DCF / Profile | Upside DCF = (valoreModello - prezzoCorrente) / prezzoCorrente |

### JSON raw

| Campo | Contenuto |
|---|---|
| `profile_json` | Oggetto completo `/stable/profile` |
| `ratios_json` | Oggetto completo `/stable/ratios` (normalizzato) |
| `dcf_json` | Oggetto completo `/stable/discounted-cash-flow` |

### Metadata

| Campo | Descrizione |
|---|---|
| `last_scan_date` | Data dell'ultimo aggiornamento da Fase 1 |

---

## Indicatori fondamentali — dettaglio

### PE (Price/Earnings Ratio)
Il rapporto tra prezzo dell'azione e utile per azione. Un PE basso indica un titolo potenzialmente sottovalutato rispetto agli utili.

| Valore PE | Interpretazione |
|---|---|
| < 10 | Molto economico (possibile valore o rischio nascosto) |
| 10 – 15 | Ottimale per value investing |
| 15 – 25 | Valutazione ragionevole |
| 25 – 40 | Prezzo elevato, giustificato da crescita attesa |
| > 60 | Sopravvalutato o crescita speculativa |

### PB (Price/Book Ratio)
Rapporto tra capitalizzazione di mercato e patrimonio netto contabile. Valori < 1 indicano che il mercato valuta l'azienda meno del suo book value.

| Valore PB | Score |
|---|---|
| < 1 | 100 — fortemente sottovalutato |
| 1 – 2 | 90 |
| 2 – 3 | 80 |
| 3 – 5 | 60 |
| 5 – 8 | 40 |
| > 8 | 20 — premium elevato |

### ROE (Return on Equity)
Misura quanto profitto genera l'azienda per ogni euro di patrimonio degli azionisti. Indica l'efficienza nell'uso del capitale proprio.

| ROE | Score |
|---|---|
| < 0% | 0 — perdita |
| 0 – 5% | 20 |
| 5 – 10% | 40 |
| 10 – 15% | 60 |
| 15 – 20% | 80 |
| > 20% | 100 — eccellente |

### ROA (Return on Assets)
Misura quanto profitto genera l'azienda rispetto ai suoi attivi totali. Più alto è, più l'azienda è efficiente nell'uso delle risorse.

| ROA | Score |
|---|---|
| < 0% | 0 |
| 0 – 2% | 20 |
| 2 – 5% | 40 |
| 5 – 8% | 60 |
| 8 – 12% | 80 |
| > 12% | 100 |

### Margine Operativo (Op Margin)
Percentuale dei ricavi che rimane dopo aver coperto i costi operativi. Indica la capacità dell'azienda di trasformare i ricavi in profitto operativo.

| Margine | Score |
|---|---|
| < 0% | 0 — in perdita operativa |
| 0 – 5% | 20 |
| 5 – 10% | 40 |
| 10 – 20% | 60 |
| 20 – 30% | 80 |
| > 30% | 100 — eccellente |

### Piotroski F-Score
Il Piotroski F-Score è un indicatore composito (0–9) che valuta la salute finanziaria di un'azienda su tre dimensioni:

- **Profittabilità** (3 punti): ROA positivo, flusso di cassa operativo positivo, ROA in crescita, accrual basso
- **Leva e liquidità** (3 punti): D/E in calo, current ratio in crescita, nessuna nuova emissione azionaria
- **Efficienza operativa** (3 punti): margine lordo in crescita, turnover degli asset in crescita

| F-Score | Interpretazione |
|---|---|
| 0 – 2 | Azienda debole, rischio elevato |
| 3 – 5 | Situazione neutrale |
| 6 – 7 | Buona salute finanziaria |
| 8 – 9 | Eccellente, tipico di value stock di qualità |

### Debt-to-Equity (D/E)
Rapporto tra debito totale e patrimonio netto. Misura la leva finanziaria. Valori molto alti indicano elevata dipendenza dal debito.

| D/E | Score |
|---|---|
| < 0.2 | 100 — azienda quasi debt-free |
| 0.2 – 0.5 | 90 |
| 0.5 – 1.0 | 80 |
| 1.0 – 1.5 | 60 |
| 1.5 – 2.0 | 40 |
| > 2.0 | 20 — leva elevata |

### Altman Z-Score
Modello predittivo del rischio di fallimento. Combina cinque ratio finanziari in un unico indice.

| Z-Score | Rischio |
|---|---|
| < 1.8 | Zona di pericolo — rischio fallimento elevato |
| 1.8 – 2.7 | Zona grigia — incerto |
| > 3.0 | Zona sicura — basso rischio di insolvenza |

### DCF Upside
Differenza percentuale tra il valore intrinseco calcolato con il modello DCF (Discounted Cash Flow) e il prezzo di mercato corrente.

- **Positivo** (es. +30%): il titolo è potenzialmente sottovalutato rispetto al valore dei flussi di cassa futuri
- **Negativo** (es. -20%): il titolo è potenzialmente sopravvalutato

Il sistema normalizza il DCF Upside tra -20% (score 0) e +50% (score 100).

---

## Fase successiva

L'output di questa fase (`universe`) è il punto di partenza della **[Fase 2: Indicatori tecnici e scoring giornaliero](./fase-2-indicatori)**, eseguita dal microservizio `tickerscanner`.

La Fase 2 legge i fondamentali da `universe` e i prezzi storici da `market_daily`, calcola tutti gli indicatori tecnici e produce lo score di sistema per ogni simbolo nella tabella `daily_scores`.

---

## Nota per gli ETF

Gli ETF non sono aziende: non hanno utili propri, patrimonio netto aziendale o flussi di cassa operativi nel senso tradizionale. Per questo motivo:

- `pe`, `pb`, `roe`, `roa`, `op_margin`, `piotroski`, `altman_z`, `dcf_upside` vengono lasciati a `null`
- Solo `beta` e `market_cap` sono valorizzati
- In Fase 2, lo scoring degli ETF usa solo rischio (beta) e momentum con pesi 50%/50%

---

## Avvio manuale e monitoraggio

### Scansione incrementale (solo nuovi ticker)

```http
POST /tickerscanner/universe/scan
```

Processa solo i simboli che non sono mai stati scansionati o che non hanno un aggiornamento recente. Risponde immediatamente con un `jobId`.

### Scansione completa (forza ricalcolo)

```http
POST /tickerscanner/universe/scan/force
```

Ricalcola tutti i fondamentali per tutti i simboli dell'universo. Risposta asincrona con `jobId`.

### Monitoraggio job

```http
GET /tickerscanner/universe/scan/jobs
GET /tickerscanner/universe/scan/status/:jobId
```

### Cancellazione job

```http
DELETE /tickerscanner/universe/scan/jobs/:jobId
```

---

## Errori comuni e recovery

| Errore | Causa probabile | Recovery |
|---|---|---|
| Simboli mancanti in `universe` | Scansione non ancora eseguita per quel ticker | Avviare scan mirato con `symbols: ["TICKER"]` nel body |
| Campi fondamentali a `null` (azioni) | FMP non ha dati per quel simbolo | Verificare su FMP direttamente; il simbolo potrebbe non avere copertura |
| Job bloccato in `running` | Errore non gestito durante il batch | Cancellare il job con DELETE e riavviare |
| Timeout API FMP | Carico elevato o rate limit | Ridurre `batchSize`, aumentare `timeout`, riavviare il job |
| `universe` non aggiornata dopo scan | Job completato ma con `errors > 0` | Controllare i log del job; i simboli con errori non vengono scritti |
