-- Migration 0010: Aggiunge metriche di copertura a flag_analysis_runs
-- tickers_with_data:    ticker con abbastanza candele da analizzare (>= 60)
-- tickers_with_spikes:  ticker che hanno prodotto almeno 1 spike
-- actual_date_from/to:  periodo effettivo coperto dai dati reali del cachemanager
--                       (può essere molto più corto del dateFrom/dateTo richiesto)

ALTER TABLE `flag_analysis_runs`
  ADD COLUMN `tickers_with_data`   INT NOT NULL DEFAULT 0 AFTER `total_trend_ok_windows`,
  ADD COLUMN `tickers_with_spikes` INT NOT NULL DEFAULT 0 AFTER `tickers_with_data`,
  ADD COLUMN `actual_date_from`    DATE DEFAULT NULL       AFTER `tickers_with_spikes`,
  ADD COLUMN `actual_date_to`      DATE DEFAULT NULL       AFTER `actual_date_from`;
