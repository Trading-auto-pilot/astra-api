-- Migration 0004: Add asset_class to universe table
-- Fase 1 separazione ETF: classifica ogni simbolo in STOCK / ETF
-- Valorizzato da universeService.buildUniverseRecord via FMP profile.isEtf / isFund

ALTER TABLE `universe`
  ADD COLUMN IF NOT EXISTS `asset_class` VARCHAR(20) NOT NULL DEFAULT 'STOCK'
  AFTER `symbol`;

-- Backfill dai dati esistenti: se is_etf=1 o is_fund=1 → ETF, altrimenti STOCK
UPDATE `universe`
SET `asset_class` = CASE
  WHEN `is_etf` = 1 OR `is_fund` = 1 THEN 'ETF'
  ELSE 'STOCK'
END;

-- Indice per query di filtro rapido per asset class
CREATE INDEX IF NOT EXISTS `idx_universe_asset_class` ON `universe` (`asset_class`);
