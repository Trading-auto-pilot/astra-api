---
sidebar_position: 5
title: ML Prediction — Database e DDL
---

# ML Prediction — Schema database e DDL

Questa pagina descrive le nuove tabelle da creare e le modifiche alle tabelle esistenti per supportare il sistema ML.

---

## Tabelle nuove

### `alt_data_sources` — Catalogo delle fonti dati alternative

Registro di tutte le fonti dati configurate nel sistema. Modificato dall'amministratore per aggiungere/disabilitare fonti.

```sql
CREATE TABLE alt_data_sources (
  id            VARCHAR(50)  NOT NULL,
  name          VARCHAR(100) NOT NULL,
  category      ENUM(
                  'macro_index',
                  'correlated_ticker',
                  'news_sentiment',
                  'macro_event',
                  'seasonality',
                  'volatility',
                  'credit',
                  'breadth'
                ) NOT NULL,
  provider      ENUM('fmp', 'fred', 'computed', 'internal') NOT NULL,
  fetch_config  JSON         NOT NULL,   -- es: {"symbol": "%5EVIX"} o {"series_id": "T10Y2Y"}
  value_type    ENUM(
                  'pct_change',          -- variazione % giornaliera (prezzi)
                  'absolute',            -- valore assoluto (spread, ratio)
                  'score',               -- score normalizzato [-1, +1] (sentiment)
                  'binary'               -- feature categorica (0/1)
                ) NOT NULL,
  enabled       TINYINT(1)   NOT NULL DEFAULT 1,
  description   TEXT,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);
```

---

### `alt_data_daily` — Valori giornalieri delle fonti alternative

Una riga per ogni `(date, source_id)`. Popolata ogni giorno dopo market close da `alt-data-collector`.

```sql
CREATE TABLE alt_data_daily (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  date          DATE         NOT NULL,
  source_id     VARCHAR(50)  NOT NULL,
  value         DECIMAL(15,6),           -- NULL se dato mancante
  source_error  TINYINT(1)   NOT NULL DEFAULT 0,  -- 1 se l'API ha restituito errore
  available_at  DATETIME     NOT NULL,   -- quando il dato è realmente disponibile
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_date_source (date, source_id),
  CONSTRAINT fk_alt_data_source
    FOREIGN KEY (source_id) REFERENCES alt_data_sources(id),
  INDEX idx_source_date (source_id, date),
  INDEX idx_date (date)
);
```

---

### `correlation_scores` — Correlazioni calcolate

Risultato settimanale del `correlation-engine`. Ogni run aggiunge nuovi record con `computed_at` aggiornato (storico mantenuto).

```sql
CREATE TABLE correlation_scores (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  symbol        VARCHAR(20)  NOT NULL,
  source_id     VARCHAR(50)  NOT NULL,
  lag_days      TINYINT      NOT NULL,                -- valori: 1,2,3,5,7,10,14
  correlation   DECIMAL(6,4) NOT NULL,                -- range [-1, +1]
  relationship  ENUM('DIRECT', 'INVERSE', 'BORDERLINE') NOT NULL,
  p_value       DECIMAL(8,6),
  window_days   SMALLINT     NOT NULL DEFAULT 252,
  computed_at   DATETIME     NOT NULL,
  PRIMARY KEY (id),
  -- indice per lettura rapida dell'ultima correlazione per un titolo
  INDEX idx_symbol_computed (symbol, computed_at),
  INDEX idx_source_computed (source_id, computed_at),
  -- per trovare le coppie attive di un titolo (solo DIRECT/INVERSE recenti)
  INDEX idx_relationship_symbol (relationship, symbol)
);
```

> Le correlazioni calcolate e classificate come `RANDOM` non vengono inserite in questa tabella.

---

### `ml_signals_daily` — Segnali ML giornalieri

Un record per ogni segnale generato. Popolata da `ml-signal-generator` ogni giorno dopo market close.

```sql
CREATE TABLE ml_signals_daily (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  symbol        VARCHAR(20)  NOT NULL,
  signal        ENUM('BULLISH', 'BEARISH', 'NEUTRAL') NOT NULL,
  confidence    DECIMAL(4,2),             -- [0.00, 1.00]
  horizon_days  TINYINT      NOT NULL,   -- orizzonte previsionale (es. 3)
  method        ENUM('rule_based', 'logistic', 'gradient_boost') NOT NULL DEFAULT 'rule_based',
  top_features  JSON,
  -- es: [{"source":"vix","lag":1,"correlation":-0.72,"relationship":"INVERSE"}]
  expires_at    DATE         NOT NULL,   -- data in cui il segnale non è più valido
  generated_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  INDEX idx_symbol_generated (symbol, generated_at),
  INDEX idx_generated_at (generated_at),
  INDEX idx_expires (expires_at)
);
```

---

### `ml_signal_performance` — Tracking esito reale dei segnali

Valutata automaticamente dopo `horizon_days` sessioni dalla generazione del segnale. Alimenta il monitoring dell'accuracy live.

```sql
CREATE TABLE ml_signal_performance (
  id              BIGINT       NOT NULL AUTO_INCREMENT,
  signal_id       BIGINT       NOT NULL,
  symbol          VARCHAR(20)  NOT NULL,
  signal          ENUM('BULLISH', 'BEARISH', 'NEUTRAL') NOT NULL,
  confidence      DECIMAL(4,2),
  horizon_days    TINYINT      NOT NULL,
  price_at_signal DECIMAL(12,4),          -- prezzo close al momento del segnale
  price_at_eval   DECIMAL(12,4),          -- prezzo close dopo horizon_days sessioni
  actual_return   DECIMAL(8,4),           -- (price_at_eval - price_at_signal) / price_at_signal
  was_correct     TINYINT(1),             -- 1 se la direzione era giusta, 0 altrimenti
  generated_at    DATETIME     NOT NULL,
  evaluated_at    DATETIME,               -- NULL finché non è trascorso horizon_days
  PRIMARY KEY (id),
  CONSTRAINT fk_signal_perf
    FOREIGN KEY (signal_id) REFERENCES ml_signals_daily(id),
  INDEX idx_symbol (symbol),
  INDEX idx_generated_at (generated_at),
  INDEX idx_evaluated_at (evaluated_at)
);
```

---

### `ml_backtest_runs` — Storico run di backtest

Ogni esecuzione del `ml-backtest-runner` produce un record. Conserva configurazione e metriche per confronto tra iterazioni.

```sql
CREATE TABLE ml_backtest_runs (
  id              BIGINT       NOT NULL AUTO_INCREMENT,
  run_name        VARCHAR(100),
  start_date      DATE         NOT NULL,  -- inizio finestra training
  cutoff_date     DATE         NOT NULL,  -- fine training / inizio validation
  eval_end_date   DATE         NOT NULL,  -- fine validation
  config_json     JSON         NOT NULL,  -- soglie, lag, fonti attive, metodo usato
  hit_rate        DECIMAL(5,2),           -- % segnali corretti in validation
  avg_return      DECIMAL(8,4),           -- rendimento medio su segnale
  sharpe          DECIMAL(8,4),
  max_drawdown    DECIMAL(8,4),
  n_signals       INT,
  n_correct       INT,
  status          ENUM('running', 'completed', 'failed') NOT NULL DEFAULT 'running',
  error_message   TEXT,
  computed_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at    DATETIME,
  PRIMARY KEY (id),
  INDEX idx_status (status),
  INDEX idx_computed_at (computed_at)
);
```

---

## Modifiche a tabelle esistenti

### `universe` — Aggiunta campi ML

```sql
ALTER TABLE universe
  ADD COLUMN ml_predictability_score  FLOAT        DEFAULT NULL
    COMMENT 'Media pesata |correlation| coppie significative. NULL = non ancora calcolato.',
  ADD COLUMN ml_last_scored_at        DATETIME     DEFAULT NULL
    COMMENT 'Ultima volta che il predictability score è stato ricalcolato.',
  ADD INDEX idx_ml_score (ml_predictability_score);
```

---

## Seed iniziale `alt_data_sources`

Script di popolamento iniziale del catalogo:

```sql
INSERT INTO alt_data_sources (id, name, category, provider, fetch_config, value_type, description) VALUES
-- Volatilità
('vix',             'CBOE VIX',               'volatility',    'fmp',      '{"symbol":"%5EVIX"}',              'pct_change', 'Volatility Index giornaliero'),
('vix3m',           'CBOE VIX 3M',            'volatility',    'fmp',      '{"symbol":"%5EVIX3M"}',            'pct_change', 'VIX a 3 mesi'),
('vix_term_ratio',  'VIX/VIX3M ratio',        'volatility',    'computed', '{"derived":"vix/vix3m"}',          'absolute',   'Term structure: >1 stress acuto'),
-- Indici macro
('spy',             'S&P 500 ETF',            'macro_index',   'fmp',      '{"symbol":"SPY"}',                 'pct_change', 'Proxy S&P 500'),
('qqq',             'NASDAQ 100 ETF',         'macro_index',   'fmp',      '{"symbol":"QQQ"}',                 'pct_change', 'Proxy NASDAQ 100'),
('dia',             'Dow Jones ETF',          'macro_index',   'fmp',      '{"symbol":"DIA"}',                 'pct_change', 'Proxy Dow Jones'),
-- Settori
('xlk',             'Tech Sector ETF',        'macro_index',   'fmp',      '{"symbol":"XLK"}',                 'pct_change', 'Settore tecnologia'),
('xlf',             'Financial Sector ETF',   'macro_index',   'fmp',      '{"symbol":"XLF"}',                 'pct_change', 'Settore finanziario'),
('xle',             'Energy Sector ETF',      'macro_index',   'fmp',      '{"symbol":"XLE"}',                 'pct_change', 'Settore energia'),
('xlv',             'Healthcare Sector ETF',  'macro_index',   'fmp',      '{"symbol":"XLV"}',                 'pct_change', 'Settore healthcare'),
('xly',             'Cons. Discretionary ETF','macro_index',   'fmp',      '{"symbol":"XLY"}',                 'pct_change', 'Consumer discretionary'),
-- Credito / tassi
('hyg',             'High Yield Bond ETF',    'credit',        'fmp',      '{"symbol":"HYG"}',                 'pct_change', 'Proxy risk appetite credito'),
('tlt',             '20Y Treasury ETF',       'credit',        'fmp',      '{"symbol":"TLT"}',                 'pct_change', 'Tassi lunghi USA'),
('t10y2y',          'Yield Curve 10Y-2Y',     'credit',        'fred',     '{"series_id":"T10Y2Y"}',           'absolute',   'Spread: positivo=normale, neg=inversione'),
('hy_spread',       'HY OAS Spread',          'credit',        'fred',     '{"series_id":"BAMLH0A0HYM2"}',    'absolute',   'Credit spread HY in basis points'),
('real_yield_10y',  'Real Yield 10Y TIPS',    'credit',        'fred',     '{"series_id":"DFII10"}',           'absolute',   'Rendimento reale 10 anni'),
-- Macro USA (mensile)
('cpi_yoy',         'CPI Year-over-Year',     'macro_event',   'fred',     '{"series_id":"CPIAUCSL","freq":"monthly"}', 'pct_change', 'Inflazione USA YoY'),
('fedfunds',        'Fed Funds Rate',         'macro_event',   'fred',     '{"series_id":"FEDFUNDS","freq":"monthly"}', 'absolute',   'Tasso FED'),
-- Stagionalità
('day_of_week',     'Giorno settimana',       'seasonality',   'computed', '{}',                               'binary',     '0=Lun, 4=Ven'),
('month',           'Mese',                   'seasonality',   'computed', '{}',                               'binary',     '1-12'),
('is_opex_week',    'Settimana scadenza opzioni','seasonality', 'computed', '{}',                               'binary',     '1 se terzo venerdì del mese');
```
