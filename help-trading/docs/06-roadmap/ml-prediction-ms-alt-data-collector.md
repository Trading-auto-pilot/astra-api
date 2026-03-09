---
sidebar_position: 6
title: ML Prediction — alt-data-collector
---

# Microservizio `alt-data-collector`

## Scopo e responsabilità

`alt-data-collector` è il microservizio che raccoglie, normalizza e persiste i valori giornalieri delle fonti dati alternative usate dal sistema ML.

**Responsabilità:**
- Leggere il catalogo `alt_data_sources` (fonti abilitate)
- Per ogni fonte: chiamare il provider appropriato (FMP, FRED, computed)
- Normalizzare il valore in `pct_change` / `absolute` / `score` secondo `value_type`
- Salvare il risultato in `alt_data_daily` con il corretto `available_at`
- Gestire errori per singola fonte senza bloccare le altre (fault isolation)
- Supportare il caricamento storico (bulk backfill) per popolare anni precedenti

---

## Struttura file (pattern BaseService)

```
alt-data-collector/
  server.js                  # createMicroserviceServer (30 righe, boilerplate)
  release.json
  Dockerfile
  modules/
    main.js                  # AltDataCollectorService extends BaseService
    fmpClient.js             # wrapper chiamate FMP (prezzi, news)
    fredClient.js            # wrapper chiamate FRED
    sentimentScorer.js       # calcolo sentiment score da array articoli FMP
    computedSources.js       # fonti calcolate internamente (vix_term_ratio, stagionalità)
  routes/
    collector.js             # endpoint REST per trigger manuale e stato
    backfill.js              # endpoint per bulk backfill storico
  lib/
    normalizer.js            # pct_change, forward-fill mensili, valore assoluto
    sourceRunner.js          # esecuzione fetch + error handling per singola fonte
```

---

## Porta e variabili ambiente

| Variabile | Valore tipico | Note |
| --- | --- | --- |
| `PORT` | `3025` | Porta interna Node.js |
| `FMP_API_KEY` | — | Già presente in `.env` |
| `FRED_API_KEY` | — | Già presente in `.env` |
| `DATAHUB_URL` | — | Per lettura `alt_data_sources` e scrittura `alt_data_daily` |
| `REDIS_URL` | — | Standard BaseService |

---

## Flusso principale (job giornaliero)

Il job viene schedulato tramite `scheduler` alle **23:30 UTC** (18:30 ET, dopo market close USA).

```
1. Leggi alt_data_sources WHERE enabled = 1
2. Per ogni source in parallelo (concurrency max = 5):
   a. Controlla se esiste già record in alt_data_daily per (today, source_id)
      → se esiste e source_error = 0, skip
   b. Chiama il provider (fmpClient / fredClient / computed)
   c. Normalizza il valore secondo value_type
   d. Imposta available_at = NOW()
   e. Upsert in alt_data_daily
3. Emit evento Redis: "alt-data-collector:daily:done" con summary
4. Log riepilogo: N OK, N errori, N skip
```

---

## Dettaglio implementazione per provider

### FMP — Prezzi

```js
// modules/fmpClient.js
async function fetchDailyClose(symbol, date, fmpApiKey) {
  const url = `https://financialmodelingprep.com/api/v3/historical-price-full/${symbol}`
            + `?from=${date}&to=${date}&apikey=${fmpApiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.historical?.[0]?.close ?? null;
}
```

Il `normalizer.js` calcola poi la % change rispetto al giorno precedente (lettura da `alt_data_daily` del giorno prima):

```js
// lib/normalizer.js
function computePctChange(closeToday, closeYesterday) {
  if (!closeToday || !closeYesterday) return null;
  return ((closeToday - closeYesterday) / closeYesterday) * 100;
}
```

### FMP — News Sentiment

```js
// modules/fmpClient.js
async function fetchNewsSentiment(ticker, date, fmpApiKey) {
  const url = `https://financialmodelingprep.com/api/v3/stock_news`
            + `?tickers=${ticker}&limit=50&apikey=${fmpApiKey}`;
  const articles = await fetch(url).then(r => r.json());
  // filtra solo articoli del giorno target
  const todayArticles = articles.filter(a => a.publishedDate.startsWith(date));
  return todayArticles;
}
```

```js
// modules/sentimentScorer.js
function scoreSentiment(articles) {
  if (!articles.length) return null;
  const avg = articles.reduce((sum, a) => sum + (a.sentimentScore ?? 0), 0) / articles.length;
  return Math.max(-1, Math.min(1, avg)); // clamp [-1, +1]
}
```

### FRED — Dati macro

```js
// modules/fredClient.js
async function fetchFredSeries(seriesId, date, fredApiKey) {
  const url = `https://api.stlouisfed.org/fred/series/observations`
            + `?series_id=${seriesId}&observation_start=${date}&observation_end=${date}`
            + `&api_key=${fredApiKey}&file_type=json`;
  const data = await fetch(url).then(r => r.json());
  const obs = data.observations?.[0];
  if (!obs || obs.value === '.') return null; // FRED restituisce '.' per dati mancanti
  return parseFloat(obs.value);
}
```

**Forward-fill per serie mensili** (CPI, FEDFUNDS): se il giorno richiesto non ha osservazione, si usa l'ultima disponibile. Il modulo `fredClient` gestisce questo cercando le ultime 60 osservazioni e prendendo la più recente non nulla.

### Computed — Fonti interne

```js
// modules/computedSources.js

function computeVixTermRatio(vixClose, vix3mClose) {
  if (!vixClose || !vix3mClose) return null;
  return vixClose / vix3mClose;
}

function computeSeasonality(date) {
  const d = new Date(date);
  return {
    day_of_week: d.getDay() === 0 ? 6 : d.getDay() - 1, // 0=Lun, 4=Ven
    month: d.getMonth() + 1,
    quarter: Math.ceil((d.getMonth() + 1) / 3),
    is_opex_week: isOptionExpiryWeek(d) ? 1 : 0,
  };
}

function isOptionExpiryWeek(date) {
  // terzo venerdì del mese: settimana che lo contiene
  // ...implementazione
}
```

---

## Endpoint REST

### `POST /alt-data-collector/run`

Avvia manualmente il job di raccolta per una data specifica.

**Body:**
```json
{ "date": "2026-03-08" }
```

**Response:**
```json
{
  "ok": true,
  "date": "2026-03-08",
  "jobId": "run-20260308-143022"
}
```

### `GET /alt-data-collector/run/:jobId`

Stato di un job in corso o completato.

```json
{
  "jobId": "run-20260308-143022",
  "status": "completed",
  "date": "2026-03-08",
  "summary": { "ok": 18, "error": 1, "skip": 2 },
  "errors": [{ "source_id": "vix3m", "error": "FMP 429 Too Many Requests" }]
}
```

### `POST /alt-data-collector/backfill`

Avvia il caricamento storico bulk per un intervallo di date. Eseguito una volta per popolare i dati storici (2-3 anni) prima dell'avvio del `correlation-engine`.

**Body:**
```json
{
  "from": "2022-01-01",
  "to": "2025-12-31",
  "sourceIds": ["vix", "spy", "t10y2y"]   // opzionale: ometti per tutte le fonti
}
```

**Comportamento:**
- Itera giorno per giorno (solo giorni di mercato USA)
- Concurrency bassa (2 date in parallelo) per rispettare rate limit FMP
- Skippa automaticamente date già presenti in `alt_data_daily`
- Esegue in background, risponde subito con `jobId`

### `GET /alt-data-collector/backfill/:jobId`

Progresso del backfill:

```json
{
  "jobId": "backfill-20260309-110045",
  "status": "running",
  "progress": { "done": 312, "total": 756, "pct": 41 },
  "eta_minutes": 18
}
```

### `GET /alt-data-collector/sources`

Lista fonti con stato ultimo fetch:

```json
[
  { "source_id": "vix", "enabled": true, "last_date": "2026-03-08", "last_ok": true },
  { "source_id": "vix3m", "enabled": true, "last_date": "2026-03-07", "last_ok": false }
]
```

---

## Gestione rate limit FMP

FMP impone limiti di chiamate per piano (es. 300 req/min su piano Basic). Strategie adottate:

- **Concurrency cap**: max 5 fetch parallele
- **Retry con backoff**: su errore 429, retry dopo 5s, 15s, 30s (3 tentativi)
- **Daily cache**: il job non riesegue fetch per `(date, source_id)` già presenti con `source_error = 0`
- **Backfill throttle**: 2 date in parallelo, pausa 200ms tra batch

---

## Integrazione con scheduler

Il job giornaliero viene registrato nel microservizio `scheduler` come:

```json
{
  "name": "alt-data-collector:daily",
  "cron": "30 23 * * 1-5",
  "timezone": "UTC",
  "url": "http://alt-data-collector:3025/alt-data-collector/run",
  "method": "POST",
  "body": {}
}
```

> `cron: "30 23 * * 1-5"` = ogni giorno feriale alle 23:30 UTC (18:30 ET).
> Il body vuoto fa sì che il servizio usi la data odierna.
