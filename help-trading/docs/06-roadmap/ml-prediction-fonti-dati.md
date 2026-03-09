---
sidebar_position: 4
title: ML Prediction — Fonti dati esterne
---

# ML Prediction — Fonti dati esterne e API

Questa pagina descrive le fonti dati alternative utilizzate dal sistema ML, i provider, gli endpoint API specifici e il formato dei dati atteso.

---

## Provider disponibili

| Provider | Chiave env | Tipo dati | Note |
| --- | --- | --- | --- |
| **FMP** (Financial Modeling Prep) | `FMP_API_KEY` | Prezzi, news, macro | Già in uso nel sistema |
| **FRED** (Federal Reserve) | `FRED_API_KEY` | Macro USA | Già in `.env.paper` |
| **Computed** | — | Derivati da FMP | Calcolati internamente (es. VIX/VIX3M ratio) |

---

## Indici e prezzi (FMP)

### Formato generale

Tutti i prezzi vengono convertiti in **variazione % giornaliera** prima del salvataggio:

```
value = (close_oggi - close_ieri) / close_ieri * 100
```

### Endpoint prezzi storici FMP

```
GET https://financialmodelingprep.com/api/v3/historical-price-full/{symbol}?from={YYYY-MM-DD}&to={YYYY-MM-DD}&apikey={FMP_API_KEY}
```

**Simboli prioritari da raccogliere:**

| `source_id` | Simbolo FMP | Descrizione |
| --- | --- | --- |
| `vix` | `%5EVIX` | CBOE Volatility Index |
| `vix3m` | `%5EVIX3M` | VIX a 3 mesi |
| `spy` | `SPY` | S&P 500 ETF |
| `qqq` | `QQQ` | NASDAQ 100 ETF |
| `dia` | `DIA` | Dow Jones ETF |
| `xlk` | `XLK` | Tech sector ETF |
| `xlf` | `XLF` | Financial sector ETF |
| `xle` | `XLE` | Energy sector ETF |
| `xlv` | `XLV` | Healthcare sector ETF |
| `xly` | `XLY` | Consumer Discretionary ETF |
| `xlp` | `XLP` | Consumer Staples ETF |
| `xli` | `XLI` | Industrials ETF |
| `xlb` | `XLB` | Materials ETF |
| `xlre` | `XLRE` | Real Estate ETF |
| `xlu` | `XLU` | Utilities ETF |
| `eem` | `EEM` | Emerging Markets ETF |
| `hyg` | `HYG` | High Yield Corporate Bond ETF |
| `tlt` | `TLT` | 20+ Year Treasury Bond ETF |
| `gld` | `GLD` | Gold ETF |
| `cl_futures` | `OUSX` o `CL=F` | Crude Oil futures (approssimazione via FMP) |

**Risposta FMP (esempio):**

```json
{
  "symbol": "SPY",
  "historical": [
    { "date": "2026-03-07", "open": 561.2, "high": 563.1, "low": 559.8, "close": 562.4, "volume": 75234000 },
    { "date": "2026-03-06", "close": 558.9 }
  ]
}
```

Il servizio usa `historical[0].close` e `historical[1].close` per calcolare la % change giornaliera.

---

## VIX term structure (computed)

Il ratio `VIX / VIX3M` misura la struttura a termine della volatilità implicita:
- ratio > 1 → backwardation (mercato sotto stress acuto)
- ratio < 1 → contango (situazione normale)

Calcolato internamente a partire dai due valori FMP:

```js
vix_term_ratio = vix_close / vix3m_close
// salvato come valore assoluto (non pct_change) in alt_data_daily
// source_id = "vix_term_ratio", value_type = "absolute"
```

---

## Dati macro (FRED)

Base URL:
```
GET https://api.stlouisfed.org/fred/series/observations?series_id={SERIES}&observation_start={YYYY-MM-DD}&api_key={FRED_API_KEY}&file_type=json
```

**Serie FRED prioritarie:**

| `source_id` | Serie FRED | Descrizione | Frequenza | Value type |
| --- | --- | --- | --- | --- |
| `t10y2y` | `T10Y2Y` | Curva rendimenti 10Y-2Y (spread) | Giornaliera | `absolute` |
| `t10y3m` | `T10Y3M` | Curva 10Y-3M (recessione proxy) | Giornaliera | `absolute` |
| `fedfunds` | `FEDFUNDS` | Fed Funds Rate | Mensile | `absolute` |
| `cpi_yoy` | `CPIAUCSL` | CPI Year-over-Year | Mensile | `pct_change_yoy` |
| `hy_spread` | `BAMLH0A0HYM2` | HY bond spread (OAS) | Giornaliera | `absolute` |
| `ig_spread` | `BAMLC0A0CM` | IG bond spread (OAS) | Giornaliera | `absolute` |
| `real_yield_10y` | `DFII10` | Real yield 10Y TIPS | Giornaliera | `absolute` |

**Risposta FRED (esempio):**

```json
{
  "observations": [
    { "date": "2026-03-07", "value": "1.23" },
    { "date": "2026-03-06", "value": "1.19" }
  ]
}
```

> **Nota**: FRED restituisce `"."` per osservazioni mancanti (weekend, festività). Il servizio mappa questo valore a `NULL`.

**Dati mensili (CPI, FEDFUNDS)**: i valori mensili vengono propagati forward-fill su ogni giorno del mese (con `available_at` pari al giorno di pubblicazione FRED, non al primo del mese).

---

## News sentiment (FMP)

### Endpoint news per ticker

```
GET https://financialmodelingprep.com/api/v3/stock_news?tickers={SYMBOL}&limit=50&apikey={FMP_API_KEY}
```

### Endpoint news generali (macro/mercato)

```
GET https://financialmodelingprep.com/api/v4/general_news?page=0&apikey={FMP_API_KEY}
```

**Risposta (esempio):**

```json
[
  {
    "symbol": "AAPL",
    "publishedDate": "2026-03-07 18:23:00",
    "title": "Apple beats earnings expectations",
    "text": "Apple Inc. reported strong quarterly earnings...",
    "sentiment": "Positive",
    "sentimentScore": 0.82
  }
]
```

> FMP fornisce già `sentiment` e `sentimentScore` in risposta — non serve NLP custom per la prima versione.

### Calcolo del sentiment score giornaliero per ticker

```
sentiment_daily = media(sentimentScore) di tutti gli articoli del giorno
```

Con pesi opzionali per recency (articoli più recenti nella giornata pesano di più).

Range output: `[-1, +1]`

Salvato in `alt_data_daily` come `source_id = "news_sentiment_{symbol}"` (es. `news_sentiment_XLE`).

> **Attenzione `available_at`**: un articolo pubblicato alle 18:00 ET è disponibile dopo market close. Un articolo pubblicato alle 6:00 ET è disponibile a mercato aperto. Il campo `available_at` viene impostato a `publishedDate` arrotondato alle 23:59 del giorno per sicurezza (si usa solo per segnali del giorno successivo).

---

## Stagionalità (computed)

Feature computate internamente — nessuna API esterna.

| `source_id` | Tipo | Valori possibili |
| --- | --- | --- |
| `day_of_week` | `binary` | 0=Lunedì, 4=Venerdì |
| `month` | `absolute` | 1–12 |
| `quarter` | `absolute` | 1–4 |
| `is_option_expiry_week` | `binary` | 1 se settimana con scadenza opzioni mensili |
| `days_to_fed_meeting` | `absolute` | giorni al prossimo FOMC (da calendario FMP/FRED) |

---

## Catalogo iniziale `alt_data_sources` (dati di seed)

Al bootstrap, il sistema popola la tabella `alt_data_sources` con questo catalogo:

| id | category | provider | fetch_config (sintesi) | value_type |
| --- | --- | --- | --- | --- |
| `vix` | `volatility` | `fmp` | symbol: `%5EVIX` | `pct_change` |
| `vix3m` | `volatility` | `fmp` | symbol: `%5EVIX3M` | `pct_change` |
| `vix_term_ratio` | `volatility` | `computed` | derived: vix/vix3m | `absolute` |
| `spy` | `macro_index` | `fmp` | symbol: `SPY` | `pct_change` |
| `qqq` | `macro_index` | `fmp` | symbol: `QQQ` | `pct_change` |
| `xlk` | `macro_index` | `fmp` | symbol: `XLK` | `pct_change` |
| `xle` | `macro_index` | `fmp` | symbol: `XLE` | `pct_change` |
| `xlf` | `macro_index` | `fmp` | symbol: `XLF` | `pct_change` |
| `hyg` | `credit` | `fmp` | symbol: `HYG` | `pct_change` |
| `tlt` | `credit` | `fmp` | symbol: `TLT` | `pct_change` |
| `t10y2y` | `credit` | `fred` | series: `T10Y2Y` | `absolute` |
| `hy_spread` | `credit` | `fred` | series: `BAMLH0A0HYM2` | `absolute` |
| `real_yield_10y` | `credit` | `fred` | series: `DFII10` | `absolute` |
| `news_sentiment_XLE` | `news_sentiment` | `fmp` | ticker: `XLE` | `score` |
| `day_of_week` | `seasonality` | `computed` | — | `binary` |
| `is_option_expiry_week` | `seasonality` | `computed` | — | `binary` |

Le voci `news_sentiment_{symbol}` vengono aggiunte dinamicamente quando un titolo viene marcato come candidato ML.
