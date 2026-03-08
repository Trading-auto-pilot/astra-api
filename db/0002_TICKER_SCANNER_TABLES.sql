-- Migration 0002: TickerScanner 3-phase architecture tables
-- Phase 1: universe (master ticker list + FMP fundamentals)
-- Phase 2a: market_daily (EOD price data)
-- Phase 2b: daily_scores (technical indicators + default scores)
-- Phase 3b: AST_RANKING_DAILY (ranked snapshot by bucket)

CREATE TABLE IF NOT EXISTS `universe` (
  `symbol`               VARCHAR(20)    NOT NULL,
  `is_etf`               TINYINT(1)     NOT NULL DEFAULT 0,
  `is_actively_trading`  TINYINT(1)     NOT NULL DEFAULT 1,
  `is_adr`               TINYINT(1)     NOT NULL DEFAULT 0,
  `is_fund`              TINYINT(1)     NOT NULL DEFAULT 0,
  `name`                 VARCHAR(255)   DEFAULT NULL,
  `exchange`             VARCHAR(50)    DEFAULT NULL,
  `exchange_full_name`   VARCHAR(255)   DEFAULT NULL,
  `sector`               VARCHAR(100)   DEFAULT NULL,
  `industry`             VARCHAR(100)   DEFAULT NULL,
  `country`              VARCHAR(100)   DEFAULT NULL,
  `currency`             VARCHAR(10)    DEFAULT NULL,
  `market_cap`           DECIMAL(24,2)  DEFAULT NULL,
  `beta`                 DECIMAL(10,4)  DEFAULT NULL,
  `pe`                   DECIMAL(10,4)  DEFAULT NULL,
  `fwd_pe`               DECIMAL(10,4)  DEFAULT NULL,
  `peg`                  DECIMAL(10,4)  DEFAULT NULL,
  `pb`                   DECIMAL(10,4)  DEFAULT NULL,
  `ps`                   DECIMAL(10,4)  DEFAULT NULL,
  `ev_ebitda`            DECIMAL(10,4)  DEFAULT NULL,
  `debt_equity`          DECIMAL(10,4)  DEFAULT NULL,
  `roe`                  DECIMAL(10,4)  DEFAULT NULL,
  `roa`                  DECIMAL(10,4)  DEFAULT NULL,
  `revenue_growth_yoy`   DECIMAL(10,4)  DEFAULT NULL,
  `earnings_growth_yoy`  DECIMAL(10,4)  DEFAULT NULL,
  `dividend_yield`       DECIMAL(10,4)  DEFAULT NULL,
  `scanned_at`           DATETIME       DEFAULT NULL,
  `updated_at`           DATETIME       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`symbol`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `market_daily` (
  `id`          INT            NOT NULL AUTO_INCREMENT,
  `symbol`      VARCHAR(20)    NOT NULL,
  `trade_date`  DATE           NOT NULL,
  `open`        DECIMAL(16,4)  DEFAULT NULL,
  `high`        DECIMAL(16,4)  DEFAULT NULL,
  `low`         DECIMAL(16,4)  DEFAULT NULL,
  `close`       DECIMAL(16,4)  DEFAULT NULL,
  `adj_close`   DECIMAL(16,4)  DEFAULT NULL,
  `volume`      BIGINT         DEFAULT NULL,
  `vwap`        DECIMAL(16,4)  DEFAULT NULL,
  `updated_at`  DATETIME       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_market_daily_symbol_date` (`symbol`, `trade_date`),
  KEY `idx_market_daily_trade_date` (`trade_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `daily_scores` (
  `id`              INT            NOT NULL AUTO_INCREMENT,
  `symbol`          VARCHAR(20)    NOT NULL,
  `score_date`      DATE           NOT NULL,
  `total_score`     DECIMAL(10,4)  DEFAULT NULL,
  `quality_score`   DECIMAL(10,4)  DEFAULT NULL,
  `risk_score`      DECIMAL(10,4)  DEFAULT NULL,
  `momentum_score`  DECIMAL(10,4)  DEFAULT NULL,
  `price`           DECIMAL(16,4)  DEFAULT NULL,
  `atr_14_pct`      DECIMAL(10,6)  DEFAULT NULL,
  `dollar_vol_20d`  DECIMAL(24,2)  DEFAULT NULL,
  `sma_50`          DECIMAL(16,4)  DEFAULT NULL,
  `sma_200`         DECIMAL(16,4)  DEFAULT NULL,
  `updated_at`      DATETIME       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_daily_scores_symbol_date` (`symbol`, `score_date`),
  KEY `idx_daily_scores_score_date` (`score_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `AST_RANKING_DAILY` (
  `id`              INT            NOT NULL AUTO_INCREMENT,
  `score_date`      DATE           NOT NULL,
  `symbol`          VARCHAR(20)    NOT NULL,
  `asset_type`      VARCHAR(10)    NOT NULL,
  `bucket`          VARCHAR(20)    NOT NULL,
  `rank_position`   INT            NOT NULL,
  `rank_score`      DECIMAL(10,4)  DEFAULT NULL,
  `source_score`    DECIMAL(10,4)  DEFAULT NULL,
  `passed_filters`  TINYINT(1)     NOT NULL DEFAULT 1,
  `reason_json`     JSON           DEFAULT NULL,
  `updated_at`      DATETIME       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_ranking_daily_date_bucket_pos` (`score_date`, `bucket`, `rank_position`),
  KEY `idx_ranking_daily_score_date` (`score_date`),
  KEY `idx_ranking_daily_symbol` (`symbol`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
