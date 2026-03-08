---
sidebar_position: 6
---

# Fase 4 — Ranking giornaliero di sistema

La Fase 4 produce uno **snapshot giornaliero di ranking** leggendo la tabella `daily_scores` (Fase 2b) e scrivendo le migliori opportunità del giorno nella tabella `AST_RANKING_DAILY`, organizzate per bucket di asset.

**Frequenza:** giornaliera, dopo il completamento della Fase 2.

A differenza della Fase 3 (personalizzata per utente), il ranking di Fase 4 è **di sistema** e indipendente da qualunque configurazione utente. Usa gli score di default calcolati in Fase 2 senza rielaborazioni.

---

## Scheda operativa

| Voce | Dettaglio |
|---|---|
| Scopo | Generare ranking globale di sistema per bucket di asset. |
| Punto di partenza | `daily_scores` (score di sistema, non personalizzati). |
| Deliverable | `AST_RANKING_DAILY` con top-N per bucket. |
| Microservizi coinvolti | `tickerscanner`, `scheduler` (orchestrazione). |

## Parametri di pilotaggio

| Parametro | Tipo | Uso |
|---|---|---|
| `score_date` | data | Snapshot date da calcolare/leggere. |
| `mode` | `normal`/`force` | Idempotenza: skip o rigenerazione completa. |
| `limits` | oggetto | Top-N per bucket (`LARGECAP`, `MIDCAP`, `SMALLCAP`, `ETF_GENERAL`). |
| `filters` | oggetto | Soglie min/max su score, volumi, volatilita, settore, paese. |

---

## Bucket di asset

Ogni simbolo viene assegnato a uno dei seguenti bucket in base al tipo di asset e alla capitalizzazione di mercato (da `universe`):

| Bucket | Criteri |
|---|---|
| `LARGECAP` | Equity con `market_cap ≥ 10B USD` |
| `MIDCAP` | Equity con `2B ≤ market_cap < 10B USD` |
| `SMALLCAP` | Equity con `market_cap < 2B USD` (o non disponibile) |
| `ETF_GENERAL` | Tutti gli ETF (flag `is_etf = 1`) |

Il ranking è **indipendente tra bucket**: ogni bucket produce la propria classifica ordinata.

---

## Criteri di ranking

All'interno di ogni bucket, i simboli vengono ordinati per:

1. **`total_score` discendente** — lo score totale di sistema calcolato in Fase 2
2. **`dollar_vol_20d` discendente** — come tiebreaker in caso di parità di score

---

## Limiti per bucket (default)

| Bucket | Numero massimo di simboli nel ranking |
|---|---|
| `LARGECAP` | 50 |
| `MIDCAP` | 30 |
| `SMALLCAP` | 20 |
| `ETF_GENERAL` | 30 |

I limiti possono essere sovrascritti nella chiamata all'endpoint (`limits` nel body della POST).

---

## Filtri opzionali

Prima del ranking, è possibile applicare filtri per escludere simboli che non soddisfano certi criteri minimi:

| Filtro | Tipo | Descrizione |
|---|---|---|
| `min_dollar_vol` | Soglia minima | Es. `500000` — esclude simboli con volume giornaliero < 500k USD |
| `min_market_cap` | Soglia minima (equity) | Es. `500000000` — esclude equity con cap < 500M USD |
| `min_total_score` | Soglia minima | Es. `40` — esclude simboli con score < 40 |
| `max_atr_14_pct` | Soglia massima | Es. `0.05` — esclude simboli con volatilità > 5% |
| `exclude_etf` | Boolean | Se `true`, esclude tutti gli ETF |
| `sectors` | Lista | Es. `["Technology", "Healthcare"]` — solo questi settori |
| `countries` | Lista | Es. `["US"]` — solo questi paesi |

I filtri vengono applicati **prima** del ranking, quindi solo i simboli che superano tutti i filtri vengono inclusi nella classifica.

---

## Idempotenza

Il processo è **idempotente** per default:

- **Mode `normal`** (default) — se esistono già dati in `AST_RANKING_DAILY` per la data richiesta, il job viene saltato e restituisce i dati esistenti.
- **Mode `force`** — cancella i record esistenti per quella data e ricalcola da zero.

---

## Output: tabella `AST_RANKING_DAILY`

| Campo | Descrizione |
|---|---|
| `score_date` | Data del ranking (YYYY-MM-DD) |
| `symbol` | Simbolo ticker |
| `asset_type` | `EQUITY` o `ETF` |
| `bucket` | `LARGECAP`, `MIDCAP`, `SMALLCAP`, `ETF_GENERAL` |
| `rank_position` | Posizione nella classifica del bucket (1 = migliore) |
| `rank_score` | Score usato per il ranking (uguale a `total_score` di `daily_scores`) |
| `source_score` | Score originale da `daily_scores` |
| `passed_filters` | `1` se il simbolo ha superato i filtri |
| `reason_json` | JSON con dettagli: `total_score`, `quality_score`, `risk_score`, `momentum_score`, `price`, `atr_14_pct` (% sul prezzo, es. `2.13` = 2.13%), `dollar_vol_20d`, e indicatori di trend (SMA50/SMA200) |

### Struttura di `reason_json`

```json
{
  "source": "daily_scores",
  "total_score": 78,
  "quality_score": 70,
  "risk_score": 40,
  "momentum_score": 65,
  "price": 264.72,
  "atr_14_pct": 2.13,
  "dollar_vol_20d": 123456789,
  "trend": {
    "price_gt_sma50": true,
    "sma50_gt_sma200": true
  },
  "filters": {}
}
```

---

## Endpoint

### Calcolo snapshot giornaliero

```http
POST /tickerscanner/fundamentals/ranking/daily
```

Body:
```json
{
  "score_date": "2026-03-15",
  "mode": "normal",
  "limits": {
    "LARGECAP": 50,
    "MIDCAP": 30,
    "SMALLCAP": 20,
    "ETF_GENERAL": 30
  },
  "filters": {
    "min_dollar_vol": 500000,
    "min_total_score": 40
  }
}
```

Risposta:
```json
{
  "ok": true,
  "score_date": "2026-03-15",
  "source_count": 4821,
  "passed_count": 3102,
  "written": 130,
  "errors": 0,
  "buckets": {
    "LARGECAP": 50,
    "MIDCAP": 30,
    "SMALLCAP": 20,
    "ETF_GENERAL": 30
  }
}
```

Se i dati esistono già (mode `normal`):
```json
{
  "ok": true,
  "skipped": true,
  "score_date": "2026-03-15"
}
```

### Lettura snapshot

```http
GET /tickerscanner/fundamentals/ranking/daily?score_date=2026-03-15
```

Restituisce tutti i simboli nel ranking per la data, ordinati per `bucket` e `rank_position`.

---

## Differenze rispetto alla Fase 3

| Aspetto | Fase 3 (`scores_daily`) | Fase 4 (`AST_RANKING_DAILY`) |
|---|---|---|
| Personalizzazione | Per utente e pipe | Di sistema, nessuna |
| Score | Ricalcolati con pesi utente | Score di default da `daily_scores` |
| Chiave primaria | `(symbol, score_date, user_id, pipe_id)` | `id` auto-increment |
| Bucket | Nessuno | LARGECAP, MIDCAP, SMALLCAP, ETF |
| Uso tipico | Watchlist personalizzata | Esplorazione mercato globale |

---

## Fase successiva

L'output di questa fase (`AST_RANKING_DAILY`) è il punto di partenza della **[Fase 5: Analisi tecnica e segnali di ingresso](./fase-5-decision-engine)**, eseguita dal microservizio `decision-engine`.

La Fase 5 legge i ticker del ranking, applica un pre-filtro basato su `atr_14_pct` e `trend`, e per ciascun ticker esegue un'analisi tecnica multi-timeframe che produce livelli operativi di ingresso (entry limit, stop loss, target di prezzo).

---

## Errori comuni e recovery

| Errore | Causa probabile | Recovery |
|---|---|---|
| `AST_RANKING_DAILY` vuota per una data | Fase 4 non ancora eseguita o Fase 2 non completata | Verificare `daily_scores` per la data; poi avviare `POST /ranking/daily` |
| Pochi simboli nel ranking | Filtri troppo restrittivi o `daily_scores` incompleta | Verificare `passed_count` vs `source_count` nella risposta; allentare i filtri |
| Ranking invariato dopo riesecuzione | `mode=normal` ha rilevato dati esistenti | Usare `mode=force` nel body della POST per rigenerare |
| Bucket vuoti (es. nessun `MIDCAP`) | Nessun simbolo in quel bucket supera i filtri | Verificare i filtri `min_dollar_vol`, `min_total_score` e la copertura `market_cap` in `universe` |
| Dati `reason_json` incompleti | Simboli con `daily_scores` parziale (indicatori non calcolati) | Atteso per ticker nuovi; si autocorregge dopo 200+ candele storiche |
