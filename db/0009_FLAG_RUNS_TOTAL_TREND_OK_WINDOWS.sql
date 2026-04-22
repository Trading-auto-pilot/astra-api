-- Migration 0009: Aggiunge total_trend_ok_windows a flag_analysis_runs
-- Conta TUTTI i window dove trend_ok=true, indipendentemente da flag/spike.
-- Serve per calcolare il vero TrendOK→Spike rate senza selection bias:
--   vero_rate = trend_ok_spike / total_trend_ok_windows
-- (anziché trend_ok_spike / trend_ok_count_in_eventi_registrati, che è biased)

ALTER TABLE `flag_analysis_runs`
  ADD COLUMN `total_trend_ok_windows` INT NOT NULL DEFAULT 0 AFTER `total_windows`;
