-- Migration 0003: Cache quality tracking tables
-- cache_quality_runs    → summary di ogni run heal/scan
-- cache_quality_scores  → score aggregato per symbol+tf (compatibilità esistente)
-- cache_quality_file_scores → score atomico per symbol+tf+anno+mese (nuova granularità)

-- -------------------------------------------------------
-- Run summary
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS `cache_quality_runs` (
  `id`                  INT            NOT NULL AUTO_INCREMENT,
  `run_id`              VARCHAR(64)    NOT NULL,
  `mode`                VARCHAR(20)    NOT NULL DEFAULT 'heal',
  `started_at`          DATETIME       DEFAULT NULL,
  `finished_at`         DATETIME       DEFAULT NULL,
  `symbols_checked`     INT            NOT NULL DEFAULT 0,
  `system_score`        DECIMAL(5,2)   DEFAULT NULL,
  `universe_score`      DECIMAL(5,2)   DEFAULT NULL,
  `symbols_below_50`    INT            NOT NULL DEFAULT 0,
  `symbols_below_80`    INT            NOT NULL DEFAULT 0,
  `total_gaps_found`    INT            NOT NULL DEFAULT 0,
  `total_gaps_healed`   INT            NOT NULL DEFAULT 0,
  `total_candles_added` INT            NOT NULL DEFAULT 0,
  `params_json`         JSON           DEFAULT NULL,
  `status`              VARCHAR(20)    NOT NULL DEFAULT 'completed',
  `created_at`          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_run_id` (`run_id`),
  KEY `idx_finished_at` (`finished_at`),
  KEY `idx_mode`        (`mode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------
-- Score aggregato per symbol+tf (granularità precedente — mantenuto per retrocompatibilità)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS `cache_quality_scores` (
  `id`                      INT            NOT NULL AUTO_INCREMENT,
  `run_id`                  VARCHAR(64)    NOT NULL,
  `symbol`                  VARCHAR(20)    NOT NULL,
  `tf`                      VARCHAR(10)    NOT NULL,
  `check_date`              DATE           NOT NULL,
  `range_from`              DATE           DEFAULT NULL,
  `range_to`                DATE           DEFAULT NULL,
  `quality_score`           DECIMAL(5,2)   DEFAULT NULL,
  `quality_score_post_heal` DECIMAL(5,2)   DEFAULT NULL,
  `completeness`            DECIMAL(5,2)   DEFAULT NULL,
  `gap_score`               DECIMAL(5,2)   DEFAULT NULL,
  `validity`                DECIMAL(5,2)   DEFAULT NULL,
  `freshness`               DECIMAL(5,2)   DEFAULT NULL,
  `months_checked`          SMALLINT       NOT NULL DEFAULT 0,
  `months_ok`               SMALLINT       NOT NULL DEFAULT 0,
  `months_empty`            SMALLINT       NOT NULL DEFAULT 0,
  `months_missing`          SMALLINT       NOT NULL DEFAULT 0,
  `trading_days_expected`   INT            NOT NULL DEFAULT 0,
  `trading_days_present`    INT            NOT NULL DEFAULT 0,
  `gaps_found`              INT            NOT NULL DEFAULT 0,
  `gaps_healed`             INT            NOT NULL DEFAULT 0,
  `gaps_unhealed`           INT            NOT NULL DEFAULT 0,
  `invalid_candles`         INT            NOT NULL DEFAULT 0,
  `candles_added`           INT            NOT NULL DEFAULT 0,
  `healed`                  TINYINT(1)     NOT NULL DEFAULT 0,
  `details_json`            JSON           DEFAULT NULL,
  `created_at`              TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_symbol_tf`   (`symbol`, `tf`),
  KEY `idx_check_date`  (`check_date`),
  KEY `idx_run_id`      (`run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------
-- Score atomico per file: symbol + tf + anno + mese
-- Questo è il dato di base da cui vengono derivate tutte le aggregazioni.
-- Ogni run heal/scan scrive/sovrascrive una riga per ogni file analizzato.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS `cache_quality_file_scores` (
  `id`             INT            NOT NULL AUTO_INCREMENT,
  `run_id`         VARCHAR(64)    NOT NULL,
  `symbol`         VARCHAR(20)    NOT NULL,
  `tf`             VARCHAR(10)    NOT NULL,
  `year`           SMALLINT       NOT NULL,
  `month`          TINYINT        NOT NULL,
  `expected_count` SMALLINT       NOT NULL DEFAULT 0,
  `actual_count`   SMALLINT       NOT NULL DEFAULT 0,
  `missing_count`  SMALLINT       NOT NULL DEFAULT 0,
  `missing_dates`  JSON           DEFAULT NULL,
  `quality_score`  DECIMAL(5,2)   NOT NULL DEFAULT 100.00,
  `healed_at`      DATETIME       NOT NULL,
  `created_at`     TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_symbol`          (`symbol`),
  KEY `idx_symbol_tf`       (`symbol`, `tf`),
  KEY `idx_symbol_tf_ym`    (`symbol`, `tf`, `year`, `month`),
  KEY `idx_healed_at`       (`healed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
