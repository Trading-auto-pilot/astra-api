
ALTER TABLE Trading.strategies ADD numAzioniBuy INTEGER DEFAULT 0 NULL;
ALTER TABLE Trading.strategies ADD numAzioniSell INTEGER DEFAULT 0 NULL;
ALTER TABLE Trading.strategies ADD COLUMN AvgBuy double DEFAULT 0 NULL;
ALTER TABLE Trading.strategies ADD COLUMN AvgSell double DEFAULT 0 NULL;
ALTER TABLE Trading.strategies ADD COLUMN NumeroOperazioni int DEFAULT 0 NULL;
ALTER TABLE Trading.strategies ADD COLUMN NumeroOperazioniVincenti int DEFAULT 0 NULL;
ALTER TABLE Trading.strategies ADD posizioneMercato varchar(5) DEFAULT "OFF" NULL;
ALTER TABLE Trading.strategies ADD  PLAzione double NULL;
ALTER TABLE Trading.strategies ADD COLUMN PLCapitale double DEFAULT 0 NULL;
ALTER TABLE Trading.strategies ADD COLUMN PLAzione double DEFAULT 0 NULL;
ALTER TABLE Trading.strategies ADD COLUMN PLPerc decimal(4,2) DEFAULT 0 NULL;
ALTER TABLE Trading.strategies ADD COLUMN CAGR double DEFAULT 0 NULL COMMENT 'ProfitLoss Annualizzato';
ALTER TABLE Trading.strategies ADD COLUMN Drawdown_PeakMax double DEFAULT -999999 NULL;
ALTER TABLE Trading.strategies ADD COLUMN Drawdown_PeakMin double DEFAULT 999999 NULL;
ALTER TABLE Trading.strategies ADD COLUMN MaxDrawdown double DEFAULT 0 NULL;
ALTER TABLE Trading.strategies ADD COLUMN Mean double DEFAULT 0 NULL;
ALTER TABLE Trading.strategies ADD COLUMN M2 double DEFAULT 0 NULL;
ALTER TABLE Trading.strategies ADD COLUMN Count int DEFAULT 0 NULL;
ALTER TABLE Trading.strategies ADD COLUMN Varianza double DEFAULT 0 NULL;
ALTER TABLE Trading.strategies ADD COLUMN ScartoQuadratico double DEFAULT 0 NULL;
ALTER TABLE Trading.strategies ADD COLUMN ggCapitaleInvestito double DEFAULT 0 NULL;
ALTER TABLE Trading.strategies ADD COLUMN MaxDay double DEFAULT 0 NULL;
ALTER TABLE Trading.strategies ADD COLUMN MinDay double DEFAULT 0 NULL;
ALTER TABLE Trading.strategies ADD CapitaleResiduo DOUBLE DEFAULT 0 NULL;


ALTER TABLE Trading.transazioni ADD PLAzione DOUBLE DEFAULT 0 NULL;
ALTER TABLE Trading.transazioni ADD PLOperazione DOUBLE DEFAULT 0 NULL;
ALTER TABLE Trading.transazioni ADD PLPerc DECIMAL(4,2) DEFAULT 0 NULL;
ALTER TABLE Trading.transazioni ADD idOperazione varchar(100) NULL;
ALTER TABLE Trading.transazioni ADD PLOperazionePerc DECIMAL(4,2) DEFAULT 0 NULL;




CREATE OR REPLACE
ALGORITHM = UNDEFINED VIEW `vstrategies` AS
select
    `S`.`id` AS `id`,
    `B`.`name` AS `bot`,
    `C`.`name` AS `symbol`,
    `S`.`params` AS `params`,
    `S`.`status` AS `status`,
    `S`.`share` AS `share`,
    `S`.`CapitaleInvestito` AS `CapitaleInvestito`,
    `S`.`OpenOrders` AS `OpenOrders`,
  `S`.`NumeroOperazioni` AS `NumeroOperazioni`,
  `S`.`NumeroOperazioniVincenti` AS `NumeroOperazioniVincenti`,
  `S`.`AvgBuy` AS `AvgBuy`,
  `S`.`AvgSell` AS `AvgSell`,
  `S`.`PLAzione` AS `PLAzion`,
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
  `S`.`posizioneMercato` AS `posizioneMercato`
  
from
    ((`strategies` `S`
join `bots` `B`)
join `Symbols` `C`)
where
    ((`S`.`idBot` = `B`.`id`)
        and (`S`.`idSymbol` = `C`.`id`));

