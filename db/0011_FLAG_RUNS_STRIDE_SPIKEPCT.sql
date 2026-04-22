-- Migration 0011: Aggiunge stride e spike_pct a flag_analysis_runs
-- stride:    passo tra finestre rolling (1=overlap totale, flagBars=finestre indipendenti)
-- spike_pct: soglia minima movimento % per considerare uno spike (es. 0.005 = 0.5%)

ALTER TABLE `flag_analysis_runs`
  ADD COLUMN `stride`    SMALLINT     NOT NULL DEFAULT 1     AFTER `lookahead_bars`,
  ADD COLUMN `spike_pct` DECIMAL(8,5) NOT NULL DEFAULT 0.005 AFTER `stride`;
