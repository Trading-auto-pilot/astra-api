

-- Trading.bots definition

CREATE TABLE `bots` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(20) NOT NULL,
  `ver` varchar(5) DEFAULT NULL,
  `status` varchar(20) DEFAULT NULL COMMENT 'active or inactive',
  `date_release` datetime DEFAULT NULL,
  `totalProfitLoss` decimal(10,0) DEFAULT NULL,
  `containerName` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;



-- Trading.orders definition

CREATE TABLE `orders` (
  `id` char(36) NOT NULL,
  `client_order_id` char(36) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `submitted_at` datetime(6) NOT NULL,
  `filled_at` datetime(6) DEFAULT NULL,
  `expired_at` datetime(6) DEFAULT NULL,
  `canceled_at` datetime(6) DEFAULT NULL,
  `failed_at` datetime(6) DEFAULT NULL,
  `replaced_at` datetime(6) DEFAULT NULL,
  `replaced_by` char(36) DEFAULT NULL,
  `replaces` char(36) DEFAULT NULL,
  `asset_id` char(36) NOT NULL,
  `symbol` varchar(10) NOT NULL,
  `asset_class` varchar(20) NOT NULL,
  `notional` decimal(18,4) DEFAULT NULL,
  `qty` decimal(18,4) DEFAULT NULL,
  `filled_qty` decimal(18,4) NOT NULL,
  `filled_avg_price` decimal(18,4) DEFAULT NULL,
  `order_class` varchar(20) DEFAULT NULL,
  `order_type` varchar(20) NOT NULL,
  `type` varchar(20) NOT NULL,
  `side` varchar(10) NOT NULL,
  `position_intent` varchar(20) DEFAULT NULL,
  `time_in_force` varchar(10) NOT NULL,
  `limit_price` decimal(18,4) DEFAULT NULL,
  `stop_price` decimal(18,4) DEFAULT NULL,
  `status` varchar(20) NOT NULL,
  `extended_hours` tinyint(1) NOT NULL DEFAULT '0',
  `legs` json DEFAULT NULL,
  `trail_percent` decimal(5,2) DEFAULT NULL,
  `trail_price` decimal(18,4) DEFAULT NULL,
  `hwm` decimal(18,4) DEFAULT NULL,
  `subtag` varchar(50) DEFAULT NULL,
  `source` varchar(50) DEFAULT NULL,
  `expires_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- Trading.settings definition

CREATE TABLE `settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `param_key` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `param_value` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Trading.strategies definition

CREATE TABLE `strategies` (
  `id` int NOT NULL AUTO_INCREMENT,
  `idBot` int NOT NULL,
  `idSymbol` int NOT NULL,
  `status` varchar(20) DEFAULT NULL COMMENT 'running, stop, inactive',
  `params` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- Trading.strategy_runs definition

CREATE TABLE `strategy_runs` (
  `id` varchar(64) NOT NULL,
  `strategy` varchar(64) NOT NULL,
  `symbol` varchar(16) NOT NULL,
  `mode` enum('backtest','live') NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `capital` decimal(12,4) NOT NULL,
  `status` enum('running','done','failed') NOT NULL,
  `params_json` json DEFAULT NULL,
  `started_at` datetime NOT NULL,
  `completed_at` datetime DEFAULT NULL,
  `profit` decimal(8,5) DEFAULT NULL,
  `efficienza` decimal(8,5) DEFAULT NULL,
  `profittoAnnuo` double DEFAULT NULL,
  `dayMin` int DEFAULT NULL,
  `dayMax` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `strategy` (`strategy`),
  KEY `symbol` (`symbol`),
  KEY `status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Trading.Symbols definition

CREATE TABLE `Symbols` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(20) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Trading.transazioni definition

CREATE TABLE `transazioni` (
  `id` int NOT NULL AUTO_INCREMENT,
  `ScenarioID` varchar(64) NOT NULL,
  `operationDate` datetime NOT NULL,
  `operation` varchar(15) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `Price` decimal(12,4) NOT NULL,
  `capitale` decimal(12,4) NOT NULL,
  `profitLoss` decimal(8,5) DEFAULT NULL,
  `exit_reason` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `days` decimal(8,3) DEFAULT NULL,
  `MA` decimal(12,4) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ScenarioID` (`ScenarioID`),
  KEY `operationDate` (`operationDate`)
) ENGINE=InnoDB AUTO_INCREMENT=834 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Trading.vstrategies source

CREATE OR REPLACE
ALGORITHM = UNDEFINED VIEW `vstrategies` AS
select
    `S`.`id` AS `id`,
    `B`.`name` AS `bot`,
    `C`.`name` AS `symbol`,
    `S`.`params` AS `params`,
    `S`.`status` AS `status`,
    `B`.`containerName` AS `containerName`
from
    ((`strategies` `S`
join `bots` `B`)
join `Symbols` `C`)
where
    ((`S`.`idBot` = `B`.`id`)
        and (`S`.`idSymbol` = `C`.`id`));

--- Insert 
INSERT INTO Trading.bots (name,ver,status,date_release,totalProfitLoss,containerName) VALUES
	 ('SMA','1.0','active',NULL,0,'localhost');


INSERT INTO Trading.strategies (idBot,idSymbol,status,params) VALUES
	 (1,1,'active','{"MA":25, "SL":0.05, "TP":0.1, "TF":"15Min"}');

INSERT INTO Trading.settings (param_key,param_value,active) VALUES
	 ('ALPACA-MARKET-HOST','data.alpaca.markets',1),
	 ('APCA-API-KEY-ID','PKNS94MR3ZI0U7AFMEBS',1),
	 ('APCA-API-SECRET-KEY','Sm2wcfjDQZo0aNGoofSWFSDESWgdVhPD6QczFx0R',1),
	 ('ALPACA-WSS-IEX','iex',1),
	 ('ALPACA-WSS-SIP','sip',1),
	 ('ALPACA-WSS-TEST','test',1),
	 ('ALPACA-WSS-MARKET-STREAM-BASE','wss://stream.data.alpaca.markets/v2/',1),
	 ('ALPACA-WSS-MARKET-SANDBOX-BASE','wss://stream.data.sandbox.alpaca.markets/v2/',1),
	 ('ALPACA-WSS-STREAM-BASE','wss://api.alpaca.markets/stream',1),
	 ('ALPACA-WSS-PAPER-STREAM-BASE','wss://paper-api.alpaca.markets/stream',1);

INSERT INTO Trading.Symbols (name) VALUES
	 ('MSFT'),
	 ('AAPL'),
	 ('GOLD'),
	 ('META'),
	 ('AMZN'),
	 ('OIL'),
	 ('GOOG');
