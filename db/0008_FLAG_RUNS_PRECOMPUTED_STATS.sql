-- Migration 0008: Aggiunge colonne di stats pre-calcolate a flag_analysis_runs
-- Queste vengono popolate al termine di ogni run direttamente dagli eventi in memoria,
-- eliminando la dipendenza dal limite di 1000 record di datahub per i KPI aggregati.

ALTER TABLE `flag_analysis_runs`
  ADD COLUMN `trend_ok_count`    INT NOT NULL DEFAULT 0 AFTER `flag_ok_count`,
  ADD COLUMN `missed_count`      INT NOT NULL DEFAULT 0 AFTER `trend_ok_count`,
  ADD COLUMN `spike_count`       INT NOT NULL DEFAULT 0 AFTER `missed_count`,
  ADD COLUMN `trend_ok_spike`    INT NOT NULL DEFAULT 0 AFTER `spike_count`,
  ADD COLUMN `flag_ok_spike`     INT NOT NULL DEFAULT 0 AFTER `trend_ok_spike`,
  ADD COLUMN `flag_ok_confirmed` INT NOT NULL DEFAULT 0 AFTER `flag_ok_spike`,
  ADD COLUMN `confirmed_count`   INT NOT NULL DEFAULT 0 AFTER `flag_ok_confirmed`,
  ADD COLUMN `fail_reasons_json` JSON DEFAULT NULL       AFTER `confirmed_count`,
  ADD COLUMN `by_symbol_json`    JSON DEFAULT NULL       AFTER `fail_reasons_json`;
