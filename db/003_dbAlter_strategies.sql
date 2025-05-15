-- Aggiungi 'share' se non esiste
DO
BEGIN
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
                 WHERE TABLE_NAME = 'strategies' AND COLUMN_NAME = 'share') THEN
    ALTER TABLE strategies ADD COLUMN `share` DOUBLE DEFAULT NULL;
  END IF;
END;

-- Aggiungi 'CapitaleInvestito' se non esiste
DO
BEGIN
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
                 WHERE TABLE_NAME = 'strategies' AND COLUMN_NAME = 'CapitaleInvestito') THEN
    ALTER TABLE strategies ADD COLUMN `CapitaleInvestito` DOUBLE DEFAULT NULL;
  END IF;
END;

-- Aggiungi 'OpenOrders' se non esiste
DO
BEGIN
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
                 WHERE TABLE_NAME = 'strategies' AND COLUMN_NAME = 'OpenOrders') THEN
    ALTER TABLE strategies ADD COLUMN `OpenOrders` DOUBLE DEFAULT NULL;
  END IF;
END;

ALTER TABLE strategies MODIFY COLUMN params VARCHAR(500) DEFAULT NULL;

UPDATE strategies SET share = 0.35, CapitaleInvestito = 0, OpenOrders = 0 WHERE id = 2;


ALTER TABLE Trading.strategies ADD NumeroOperazioni INTEGER NULL;
ALTER TABLE Trading.strategies ADD NumeroOperazioniVincenti INTEGER NULL;
ALTER TABLE Trading.strategies ADD AvgBuy DOUBLE NULL;
ALTER TABLE Trading.strategies ADD AvgSell DOUBLE NULL;
ALTER TABLE Trading.strategies ADD PLAzion DOUBLE NULL;
ALTER TABLE Trading.strategies ADD PLCapitale DOUBLE NULL;
ALTER TABLE Trading.strategies ADD PLPerc DECIMAL(4,2) NULL;
ALTER TABLE Trading.strategies ADD CAGR DOUBLE NULL COMMENT 'ProfitLoss Annualizzato';
ALTER TABLE Trading.strategies ADD Drawdown_PeakMax DOUBLE NULL;
ALTER TABLE Trading.strategies ADD Drawdown_PeakMin DOUBLE NULL;
ALTER TABLE Trading.strategies ADD MaxDrawdown DOUBLE NULL;
ALTER TABLE Trading.strategies ADD Mean DOUBLE NULL;
ALTER TABLE Trading.strategies ADD M2 DOUBLE NULL;
ALTER TABLE Trading.strategies ADD Count INTEGER NULL;
ALTER TABLE Trading.strategies ADD Varianza DOUBLE NULL;
ALTER TABLE Trading.strategies ADD ScartoQuadratico DOUBLE NULL;
ALTER TABLE Trading.strategies ADD ggCapitaleInvestito DOUBLE NULL;
ALTER TABLE Trading.strategies ADD MaxDay DOUBLE NULL;
ALTER TABLE Trading.strategies ADD MinDay DOUBLE NULL;


