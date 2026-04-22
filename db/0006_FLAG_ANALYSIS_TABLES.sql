-- Migration 0006: Flag pattern analysis tables
-- flag_analysis_runs   → un record per ogni esecuzione dell'analisi (run summary)
-- flag_analysis_events → un record per ogni finestra in cui flagOk=true o flagOk=false con spike

-- -------------------------------------------------------
-- Run summary: una riga per ogni chiamata a POST /flag-analysis/run
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS `flag_analysis_runs` (
  `id`              INT           NOT NULL AUTO_INCREMENT,
  `run_id`          VARCHAR(64)   NOT NULL,
  `started_at`      DATETIME      DEFAULT NULL,
  `finished_at`     DATETIME      DEFAULT NULL,
  `tickers`         JSON          DEFAULT NULL,   -- array di ticker analizzati
  `tf`              VARCHAR(10)   NOT NULL DEFAULT '1Hour',
  `date_from`       DATE          DEFAULT NULL,
  `date_to`         DATE          DEFAULT NULL,
  `flag_bars`       SMALLINT      NOT NULL DEFAULT 20,
  `flag_atr_k`      DECIMAL(6,3)  NOT NULL DEFAULT 1.300,
  `flag_pct_k`      DECIMAL(8,5)  NOT NULL DEFAULT 0.00250,
  `vol_mult`        DECIMAL(6,3)  NOT NULL DEFAULT 1.200,
  `lookahead_bars`  SMALLINT      NOT NULL DEFAULT 20,  -- quante candele successive analizzare
  `total_windows`   INT           NOT NULL DEFAULT 0,
  `flag_ok_count`   INT           NOT NULL DEFAULT 0,
  `status`          VARCHAR(20)   NOT NULL DEFAULT 'running',
  `error`           TEXT          DEFAULT NULL,
  `created_at`      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_run_id` (`run_id`),
  KEY `idx_started_at` (`started_at`),
  KEY `idx_status`     (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------
-- Evento per ogni finestra analizzata dove:
--   flag_ok = 1  → pattern flag rilevato
--   flag_ok = 0  + spike_detected = 1 → flag NON ok ma c'era un'opportunità persa
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS `flag_analysis_events` (
  `id`                  INT            NOT NULL AUTO_INCREMENT,
  `run_id`              VARCHAR(64)    NOT NULL,
  `symbol`              VARCHAR(20)    NOT NULL,
  `candle_ts`           DATETIME       NOT NULL,   -- timestamp dell'ultima candela della finestra
  `tf`                  VARCHAR(10)    NOT NULL,

  -- stato flag al momento dell'evento
  `flag_ok`             TINYINT(1)     NOT NULL DEFAULT 0,
  `trend_ok`            TINYINT(1)     NOT NULL DEFAULT 0,
  `breakout_ok`         TINYINT(1)     NOT NULL DEFAULT 0,
  `pullback_ok`         TINYINT(1)     NOT NULL DEFAULT 0,

  -- livelli chiave calcolati
  `price_at_signal`     DECIMAL(12,4)  DEFAULT NULL,
  `break_level`         DECIMAL(12,4)  DEFAULT NULL,
  `flag_high`           DECIMAL(12,4)  DEFAULT NULL,
  `flag_low`            DECIMAL(12,4)  DEFAULT NULL,
  `flag_range`          DECIMAL(12,4)  DEFAULT NULL,
  `flag_threshold`      DECIMAL(12,4)  DEFAULT NULL,
  `atr_last`            DECIMAL(12,4)  DEFAULT NULL,
  `slope`               DECIMAL(12,6)  DEFAULT NULL,
  `avg_vol_flag`        DECIMAL(14,2)  DEFAULT NULL,
  `avg_vol_impulse`     DECIMAL(14,2)  DEFAULT NULL,

  -- diagnosi del perché flagOk è false (se flag_ok=0)
  `fail_reason`         VARCHAR(80)    DEFAULT NULL,
  -- 'range_too_wide' | 'slope_negative' | 'volume_not_contracted' | 'multiple' | null

  -- analisi lookahead (cosa succede nelle N candele successive)
  `lookahead_bars`      SMALLINT       NOT NULL DEFAULT 20,
  `spike_detected`      TINYINT(1)     NOT NULL DEFAULT 0,  -- prezzo ha superato break_level+buffer nelle successive N candele
  `spike_pct`           DECIMAL(8,4)   DEFAULT NULL,        -- % di movimento massimo nelle successive N candele
  `spike_candle_ts`     DATETIME       DEFAULT NULL,        -- quando è avvenuto lo spike
  `breakout_confirmed`  TINYINT(1)     NOT NULL DEFAULT 0,  -- spike con volume ≥ vol_threshold
  `max_drawdown_pct`    DECIMAL(8,4)   DEFAULT NULL,        -- max drawdown nelle N candele successive (per falsi positivi)

  -- parametri usati (per analisi multi-param)
  `flag_bars`           SMALLINT       NOT NULL DEFAULT 20,
  `flag_atr_k`          DECIMAL(6,3)   NOT NULL DEFAULT 1.300,
  `flag_pct_k`          DECIMAL(8,5)   NOT NULL DEFAULT 0.00250,

  `created_at`          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_run_id`       (`run_id`),
  KEY `idx_symbol`       (`symbol`),
  KEY `idx_candle_ts`    (`candle_ts`),
  KEY `idx_symbol_ts`    (`symbol`, `candle_ts`),
  KEY `idx_flag_ok`      (`flag_ok`),
  KEY `idx_spike`        (`spike_detected`),
  KEY `idx_symbol_flag`  (`symbol`, `flag_ok`, `candle_ts`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
