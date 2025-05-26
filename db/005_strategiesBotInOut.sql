-- Backup delle tabelle
DROP TABLE IF EXISTS Trading.strategies_backup;
CREATE TABLE Trading.strategies_backup AS SELECT * FROM Trading.strategies;

ALTER TABLE Trading.strategies CHANGE idBot idBotIn int NOT NULL;
ALTER TABLE Trading.strategies ADD idBotOut INT NOT NULL;
ALTER TABLE Trading.strategies CHANGE idBotOut idBotOut INT NOT NULL AFTER idBotIn;

-- Backup delle tabelle
DROP TABLE IF EXISTS Trading.bots;
CREATE TABLE Trading.bots AS SELECT * FROM Trading.bots;
ALTER TABLE Trading.bots ADD url varchar(200) NULL;

-- Trading.vstrategies source

CREATE OR REPLACE
ALGORITHM = UNDEFINED VIEW `vstrategies` AS
select
    `S`.`id` AS `id`,
    `BIN`.`name` AS `idBotIn`,
    `BOUT`.`name` AS `idBotOut`,
    `C`.`name` AS `idSymbol`,
    `S`.`params` AS `params`,
    `S`.`status` AS `status`,
    `S`.`share` AS `share`,
    `S`.`CapitaleInvestito` AS `CapitaleInvestito`,
    `S`.`OpenOrders` AS `OpenOrders`,
    `S`.`NumeroOperazioni` AS `NumeroOperazioni`,
    `S`.`NumeroOperazioniVincenti` AS `NumeroOperazioniVincenti`,
    `S`.`AvgBuy` AS `AvgBuy`,
    `S`.`AvgSell` AS `AvgSell`,
    `S`.`PLAzione` AS `PLAzione`,
    `S`.`PLCapitale` AS `PLCapitale`,
    `S`.`PLPerc` AS `PLPerc`,
    `S`.`CAGR` AS `CAGR`,
    `S`.`Drawdown_PeakMax` AS `Drawdown_PeakMax`,
    `S`.`Drawdown_PeakMin` AS `Drawdown_PeakMin`,
    `S`.`MaxDrawdown` AS `MaxDrawdown`,
    `S`.`Mean` AS `Mean`,
    `S`.`M2` AS `M2`,
    `S`.`Count` AS `Count`,
    `S`.`Varianza` AS `Varianza`,
    `S`.`ScartoQuadratico` AS `ScartoQuadratico`,
    `S`.`ggCapitaleInvestito` AS `ggCapitaleInvestito`,
    `S`.`MaxDay` AS `MaxDay`,
    `S`.`MinDay` AS `MinDay`,
    `S`.`numAzioniBuy` AS `numAzioniBuy`,
    `S`.`numAzioniSell` AS `numAzioniSell`,
    `S`.`posizioneMercato` AS `posizioneMercato`,
    `S`.`CapitaleResiduo ` AS `CapitaleResiduo`
from
    `strategies` `S`
join `bots` `BIN`
join `bots` `BOUT`
join `Symbols` `C`
where
   	 ((`S`.`idBotIn` = `BIN`.`id`)
 and (`S`.`idBotOut` = `BOUT`.`id`)
 and  (`S`.`idSymbol` = `C`.`id`));