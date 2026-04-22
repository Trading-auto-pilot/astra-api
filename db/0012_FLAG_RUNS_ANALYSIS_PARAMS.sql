-- Migration 0012: Aggiunge parametri di analisi mancanti a flag_analysis_runs
-- impulse_bars: barre dell'impulso precedente al flag (default 80)
-- atr_period:   periodo ATR (default 20)
-- swing_window: finestra swing high/low (default 3)

ALTER TABLE `flag_analysis_runs`
  ADD COLUMN `impulse_bars` SMALLINT     NOT NULL DEFAULT 80  AFTER `spike_pct`,
  ADD COLUMN `atr_period`   SMALLINT     NOT NULL DEFAULT 20  AFTER `impulse_bars`,
  ADD COLUMN `swing_window` SMALLINT     NOT NULL DEFAULT 3   AFTER `atr_period`;
