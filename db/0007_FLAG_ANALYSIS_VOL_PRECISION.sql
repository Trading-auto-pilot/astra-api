-- Migration 0007: Allarga avg_vol_flag e avg_vol_impulse in flag_analysis_events
-- da DECIMAL(14,2) a DECIMAL(20,2) per gestire ticker ad alto volume
-- (es. ETF, futures su indici, crypto) dove il volume medio per candela 1h
-- può superare 999 miliardi e causare "Out of range value" al momento dell'insert.

ALTER TABLE `flag_analysis_events`
  MODIFY COLUMN `avg_vol_flag`    DECIMAL(20,2) DEFAULT NULL,
  MODIFY COLUMN `avg_vol_impulse` DECIMAL(20,2) DEFAULT NULL;
