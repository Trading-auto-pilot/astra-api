-- MySQL dump 10.13  Distrib 9.3.0, for macos14.7 (arm64)
--
-- Host: 127.0.0.1    Database: Trading
-- ------------------------------------------------------
-- Server version	8.0.42

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `Symbols`
--

DROP TABLE IF EXISTS `Symbols`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Symbols` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(20) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Symbols`
--

LOCK TABLES `Symbols` WRITE;
/*!40000 ALTER TABLE `Symbols` DISABLE KEYS */;
INSERT INTO `Symbols` VALUES (1,'MSFT'),(2,'AAPL'),(3,'GLD'),(4,'SPY'),(5,'AMZN'),(6,'SIL'),(7,'GOOG'),(15,'TSLA'),(16,'META'),(17,'XLF');
/*!40000 ALTER TABLE `Symbols` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `bots`
--

DROP TABLE IF EXISTS `bots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bots` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(20) NOT NULL,
  `ver` varchar(5) DEFAULT NULL,
  `status` varchar(20) DEFAULT NULL COMMENT 'active or inactive',
  `date_release` datetime DEFAULT NULL,
  `totalProfitLoss` decimal(10,0) DEFAULT NULL,
  `containerName` varchar(100) DEFAULT NULL,
  `url` varchar(200) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bots`
--

LOCK TABLES `bots` WRITE;
/*!40000 ALTER TABLE `bots` DISABLE KEYS */;
INSERT INTO `bots` VALUES (2,'SMA','1.1','active','2025-07-01 18:19:04',0,NULL,'http://sma:3010'),(3,'SLTP','1.0','active','2025-07-01 18:19:03',0,NULL,'http://sltp:3011');
/*!40000 ALTER TABLE `bots` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `fees`
--

DROP TABLE IF EXISTS `fees`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fees` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(50) DEFAULT NULL,
  `FeePerShare` decimal(8,6) DEFAULT NULL,
  `FeePerDollar` decimal(8,6) DEFAULT NULL,
  `Cap` decimal(6,4) DEFAULT NULL,
  `side` varchar(10) DEFAULT NULL,
  `Description` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `fees`
--

LOCK TABLES `fees` WRITE;
/*!40000 ALTER TABLE `fees` DISABLE KEYS */;
INSERT INTO `fees` VALUES (1,'TAF',0.000145,NULL,7.2700,'sell','FINRA TAF (Trading Activity Fee)'),(2,'SEC',NULL,0.000022,NULL,'sell','SEC Fee (also called SEC Regulatory Fee)');
/*!40000 ALTER TABLE `fees` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `logs`
--

DROP TABLE IF EXISTS `logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `timestamp` datetime(3) DEFAULT NULL,
  `level` varchar(10) NOT NULL,
  `functionName` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `message` text NOT NULL,
  `jsonDetails` json DEFAULT NULL,
  `microservice` varchar(100) DEFAULT NULL,
  `moduleName` varchar(100) DEFAULT NULL,
  `moduleVersion` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_timestamp` (`timestamp`),
  KEY `idx_level` (`level`)
) ENGINE=InnoDB AUTO_INCREMENT=473563 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;


--
-- Table structure for table `orders`
--

DROP TABLE IF EXISTS `orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `orders` (
  `id` char(36) NOT NULL,
  `client_order_id` char(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `submitted_at` datetime(6) NOT NULL,
  `filled_at` datetime(6) DEFAULT NULL,
  `expired_at` datetime(6) DEFAULT NULL,
  `canceled_at` datetime(6) DEFAULT NULL,
  `cancel_requested_at` datetime DEFAULT NULL,
  `failed_at` datetime(6) DEFAULT NULL,
  `replaced_at` datetime(6) DEFAULT NULL,
  `replaced_by` char(36) DEFAULT NULL,
  `replaces` char(36) DEFAULT NULL,
  `asset_id` char(36) NOT NULL,
  `symbol` varchar(10) NOT NULL,
  `asset_class` varchar(20) NOT NULL,
  `notional` decimal(18,4) DEFAULT NULL,
  `qty` decimal(18,4) DEFAULT NULL,
  `filled_qty` decimal(18,4) DEFAULT NULL,
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
/*!40101 SET character_set_client = @saved_cs_client */;


DROP TABLE IF EXISTS `posizioni`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `posizioni` (
  `id` bigint DEFAULT NULL,
  `strategy_id` varchar(64) NOT NULL,
  `asset_id` varchar(64) DEFAULT NULL,
  `symbol` varchar(16) NOT NULL,
  `asset_class` varchar(32) DEFAULT NULL,
  `side` enum('long','short','buy','sell') DEFAULT NULL,
  `qty` decimal(18,6) DEFAULT NULL,
  `filled_avg_price` decimal(18,6) DEFAULT NULL,
  `avg_entry_price` decimal(18,6) DEFAULT NULL,
  `market_value` decimal(18,6) DEFAULT NULL,
  `cost_basis` decimal(18,6) DEFAULT NULL,
  `unrealized_pl` decimal(18,6) DEFAULT NULL,
  `unrealized_plpc` decimal(8,6) DEFAULT NULL,
  `current_price` decimal(18,6) DEFAULT NULL,
  `lastday_price` decimal(18,6) DEFAULT NULL,
  `change_today` decimal(8,6) DEFAULT NULL,
  `order_id` varchar(64) DEFAULT NULL,
  `client_order_id` varchar(64) DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `filled_at` datetime DEFAULT NULL,
  `note` text,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `realized_pl` decimal(18,6) DEFAULT NULL,
  `cumulative_equity` decimal(18,6) DEFAULT NULL,
  `equity_after_trade` decimal(18,6) DEFAULT NULL,
  `pnl_snapshot` json DEFAULT NULL,
  PRIMARY KEY (`symbol`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `schema_version`
--

DROP TABLE IF EXISTS `schema_version`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `schema_version` (
  `id` int NOT NULL AUTO_INCREMENT,
  `script_name` varchar(255) DEFAULT NULL,
  `applied_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `script_name` (`script_name`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `settings`
--

DROP TABLE IF EXISTS `settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `param_key` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `param_value` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=43 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `settings`
--

LOCK TABLES `settings` WRITE;
/*!40000 ALTER TABLE `settings` DISABLE KEYS */;
INSERT INTO `settings` VALUES (11,'ALPACA-MARKET-HOST','data.alpaca.markets',1),(12,'APCA-API-KEY-ID','PKNS94MR3ZI0U7AFMEBS',1),(13,'APCA-API-SECRET-KEY','Sm2wcfjDQZo0aNGoofSWFSDESWgdVhPD6QczFx0R',1),(14,'ALPACA-WSS-IEX','iex',1),(15,'ALPACA-WSS-SIP','sip',1),(16,'ALPACA-WSS-TEST','test',1),(17,'ALPACA-LIVE-MARKET','wss://stream.data.alpaca.markets/v2',1),(18,'ALPACA-SANDBOX-MARKET','wss://stream.data.sandbox.alpaca.markets/v2',1),(19,'ALPACA-LIVE-TRADING','wss://data.alpaca.markets/stream',1),(20,'ALPACA-PAPER-TRADING','wss://paper.api.alpaca.markets/stream',1),(21,'ALPACA-API-TIMEOUT','3000',1),(22,'TF-DEFAULT','6H',1),(23,'ALPACA-HISTORICAL-FEED','sip',1),(24,'ALPACA-MARKET-DATA-BASE','data.alpaca.markets',1),(25,'SMTP_HOST','smtp.mail.me.com',1),(26,'SMTP_PORT','587',1),(27,'SMTP_USER','expovin@icloud.com',1),(28,'SMTP_PASSWORD','brcl-szle-lanq-bfug',1),(29,'SMTP_FROM','expovin@icloud.com',1),(30,'ALPACA-PAPER-BASE','https://paper-api.alpaca.markets',1),(31,'ALPACA-LIVE-BASE','https://data.alpaca.markets',1),(32,'STREAM-SIMULATION-DELAY','10000',1),(33,'LOCAL-WS-STREAM-BASE','ws://marketsimulator:3003/',1),(34,'ALPACA-LOCAL-MARKET','ws://marketsimulator:3003/v2',1),(35,'ALPACA-LOCAL-TRADING','ws://ordersimulator:3004',1),(36,'ALPACA-LOCAL-BASE','http://ordersimulator:3004',1),(37,'ALPACA-DEV-MARKET','ws://localhost:3003/v2',1),(38,'ALPACA-DEV-TRADING','ws://localhost:3004',1),(39,'ALPACA-DEV-BASE','http://localhost:3004',1),(40,'REDIS_CACHE_TTL','150',1),(42,'PROCESS_DELAY_BETWEEN_MESSAGES','1000',1);
/*!40000 ALTER TABLE `settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `strategies`
--

DROP TABLE IF EXISTS `strategies`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `strategies` (
  `id` int NOT NULL AUTO_INCREMENT,
  `idBotIn` int NOT NULL,
  `idBotOut` int NOT NULL,
  `idSymbol` int NOT NULL,
  `status` varchar(20) DEFAULT NULL COMMENT 'running, stop, inactive',
  `params` varchar(1500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `share` double DEFAULT NULL,
  `CapitaleInvestito` double DEFAULT NULL,
  `OpenOrders` double DEFAULT NULL,
  `NumeroOperazioni` int DEFAULT '0',
  `NumeroOperazioniVincenti` int DEFAULT '0',
  `ggCapitaleInvestito` double DEFAULT '0',
  `MaxDay` double DEFAULT '0',
  `MinDay` double DEFAULT '0',
  `posizioneMercato` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT '"OFF"',
  `CapitaleResiduo` double DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=22 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `strategies`
--

LOCK TABLES `strategies` WRITE;
/*!40000 ALTER TABLE `strategies` DISABLE KEYS */;
INSERT INTO `strategies` VALUES (10,2,3,1,'active','{\"TP\":0.1,\"SL\":-0.02,\"TF\":\"15Min\",\"MA\":20,\"buy\":{\"type\":\"limit\",\"limit_price\":0.005,\"time_in_force\":\"day\",\"stop_price\":null,\"trail_price\":null,\"extended_hours\":false},\"sell\":{\"exitMode\":\"close\",\"type\":\"limit\",\"time_in_force\":\"gtc\",\"limit_price\":0.005,\"stop_price\":0.004,\"trail_price\":null,\"extended_hours\":null}}',0.1,27113.63,0,2,1,0,0,0,'a32b2ebe-a587-428e-a579-9b8e10350b99',175550.05),(13,2,3,2,'active','{\"TP\":0.1,\"SL\":-0.02,\"TF\":\"15Min\",\"MA\":20,\"buy\":{\"type\":\"limit\",\"limit_price\":0.005,\"time_in_force\":\"day\",\"stop_price\":null,\"trail_price\":null,\"extended_hours\":false},\"sell\":{\"exitMode\":\"close\",\"type\":\"limit\",\"time_in_force\":\"gtc\",\"limit_price\":0.005,\"stop_price\":0.004,\"trail_price\":null,\"extended_hours\":null}}',0.1,24375.28,8096,1,1,0,0,0,'e8ca27e6-9d3e-47b0-9a1d-4495dfd081fa',142226.06),(14,2,3,3,'active','{\"TP\":0.1,\"SL\":-0.02,\"TF\":\"15Min\",\"MA\":20,\"buy\":{\"type\":\"limit\",\"limit_price\":0.005,\"time_in_force\":\"day\",\"stop_price\":null,\"trail_price\":null,\"extended_hours\":false},\"sell\":{\"exitMode\":\"close\",\"type\":\"limit\",\"time_in_force\":\"gtc\",\"limit_price\":0.005,\"stop_price\":0.004,\"trail_price\":null,\"extended_hours\":null}}',0.1,15934.43,2112,1,1,0,0,0,'e6ada7ac-4a00-4669-abd7-3cd16c254ad4',115683.7),(15,2,3,4,'active','{\"TP\":0.1,\"SL\":-0.02,\"TF\":\"15Min\",\"MA\":20,\"buy\":{\"type\":\"limit\",\"limit_price\":0.005,\"time_in_force\":\"day\",\"stop_price\":null,\"trail_price\":null,\"extended_hours\":false},\"sell\":{\"exitMode\":\"close\",\"type\":\"limit\",\"time_in_force\":\"gtc\",\"limit_price\":0.005,\"stop_price\":0.004,\"trail_price\":null,\"extended_hours\":null}}',0.1,0,32528,1,0,0,0,0,'4c077890-57e2-4aa9-9a3b-405931a6690d',81292.45),(16,2,3,5,'active','{\"TP\":0.1,\"SL\":-0.02,\"TF\":\"15Min\",\"MA\":20,\"buy\":{\"type\":\"limit\",\"limit_price\":0.005,\"time_in_force\":\"day\",\"stop_price\":null,\"trail_price\":null,\"extended_hours\":false},\"sell\":{\"exitMode\":\"close\",\"type\":\"limit\",\"time_in_force\":\"gtc\",\"limit_price\":0.005,\"stop_price\":0.004,\"trail_price\":null,\"extended_hours\":null}}',0.1,22275.460000000003,4810,3,2,0,0,0,'4dd18a41-b880-4290-a169-15e4762e95aa',116315.38),(17,2,3,6,'active','{\"TP\":0.1,\"SL\":-0.02,\"TF\":\"15Min\",\"MA\":20,\"buy\":{\"type\":\"limit\",\"limit_price\":0.005,\"time_in_force\":\"day\",\"stop_price\":null,\"trail_price\":null,\"extended_hours\":false},\"sell\":{\"exitMode\":\"close\",\"type\":\"limit\",\"time_in_force\":\"gtc\",\"limit_price\":0.005,\"stop_price\":0.004,\"trail_price\":null,\"extended_hours\":null}}',0.1,32513.10000000001,1600,1,0,0,0,0,'62ea047c-fdf5-4b16-9147-f5e128f88caa',194633.12),(18,2,3,7,'active','{\"TP\":0.1,\"SL\":-0.02,\"TF\":\"15Min\",\"MA\":20,\"buy\":{\"type\":\"limit\",\"limit_price\":0.005,\"time_in_force\":\"day\",\"stop_price\":null,\"trail_price\":null,\"extended_hours\":false},\"sell\":{\"exitMode\":\"close\",\"type\":\"limit\",\"time_in_force\":\"gtc\",\"limit_price\":0.005,\"stop_price\":0.004,\"trail_price\":null,\"extended_hours\":null}}',0.1,34371.18,0,0,0,0,0,0,'fdd7b75a-2618-4d8e-8785-00e42c72abf4',251782.91000000003),(19,2,3,15,'active','{\"TP\":0.1,\"SL\":-0.02,\"TF\":\"15Min\",\"MA\":20,\"buy\":{\"type\":\"limit\",\"limit_price\":0.005,\"time_in_force\":\"day\",\"stop_price\":null,\"trail_price\":null,\"extended_hours\":false},\"sell\":{\"exitMode\":\"close\",\"type\":\"limit\",\"time_in_force\":\"gtc\",\"limit_price\":0.005,\"stop_price\":0.004,\"trail_price\":null,\"extended_hours\":null}}',0.1,33991.66,0,1,0,0,0,0,'59366805-dee0-45bc-8466-e085ce1ad989',198512.13999999998),(20,2,3,16,'active','{\"TP\":0.1,\"SL\":-0.02,\"TF\":\"15Min\",\"MA\":20,\"buy\":{\"type\":\"limit\",\"limit_price\":0.005,\"time_in_force\":\"day\",\"stop_price\":null,\"trail_price\":null,\"extended_hours\":false},\"sell\":{\"exitMode\":\"close\",\"type\":\"limit\",\"time_in_force\":\"gtc\",\"limit_price\":0.005,\"stop_price\":0.004,\"trail_price\":null,\"extended_hours\":null}}',0.1,0,0,7,6,0,0,0,'OFF',200364.03999999998),(21,2,3,17,'active','{\"TP\":0.1,\"SL\":-0.02,\"TF\":\"15Min\",\"MA\":20,\"buy\":{\"type\":\"limit\",\"limit_price\":0.005,\"time_in_force\":\"day\",\"stop_price\":null,\"trail_price\":null,\"extended_hours\":false},\"sell\":{\"exitMode\":\"close\",\"type\":\"limit\",\"time_in_force\":\"gtc\",\"limit_price\":0.005,\"stop_price\":0.004,\"trail_price\":null,\"extended_hours\":null}}',0.1,37167.32,0,4,2,0,0,0,'276b6d14-b8ad-4a0d-8655-a0ba804f3519',181188.05);
/*!40000 ALTER TABLE `strategies` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `strategy_runs`
--

DROP TABLE IF EXISTS `strategy_runs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `strategy_runs` (
  `strategy_runs_id` varchar(50) NOT NULL,
  `strategy_id` varchar(64) NOT NULL,
  `open_date` datetime DEFAULT NULL,
  `close_date` datetime DEFAULT NULL,
  `update_date` datetime DEFAULT NULL,
  `CapitaleInvestito` decimal(18,6) DEFAULT NULL,
  `AvgBuy` decimal(18,6) DEFAULT '0.000000',
  `AvgSell` decimal(18,6) DEFAULT '0.000000',
  `numAzioniBuy` int DEFAULT '0',
  `numAzioniSell` int DEFAULT '0',
  `PLAzione` decimal(18,6) DEFAULT '0.000000',
  `PLCapitale` decimal(18,6) DEFAULT '0.000000',
  `PLPerc` decimal(6,2) DEFAULT '0.00',
  `CAGR` decimal(8,4) DEFAULT '0.0000',
  `Drawdown_PeakMax` decimal(18,6) DEFAULT NULL,
  `Drawdown_PeakMin` decimal(18,6) DEFAULT '999999.000000',
  `MaxDrawdown` decimal(18,6) DEFAULT NULL,
  `Mean` decimal(18,6) DEFAULT '0.000000',
  `M2` decimal(18,6) DEFAULT '0.000000',
  `Count` int DEFAULT '0',
  `Varianza` decimal(18,6) DEFAULT '0.000000',
  `ScartoQuadratico` decimal(18,6) DEFAULT '0.000000',
  `ggCapitaleInvestito` int DEFAULT '0',
  `CapitaleResiduo` decimal(18,6) DEFAULT NULL,
  PRIMARY KEY (`strategy_runs_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `transazioni`
--

DROP TABLE IF EXISTS `transazioni`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
  `orderId` varchar(100) DEFAULT NULL,
  `NumAzioni` int DEFAULT NULL,
  `PLAzione` double DEFAULT '0',
  `PLOperazione` double DEFAULT '0',
  `PLPerc` decimal(4,2) DEFAULT '0.00',
  `idOperazione` varchar(100) DEFAULT NULL,
  `PLOperazionePerc` decimal(4,2) DEFAULT '0.00',
  PRIMARY KEY (`id`),
  KEY `ScenarioID` (`ScenarioID`),
  KEY `operationDate` (`operationDate`)
) ENGINE=InnoDB AUTO_INCREMENT=2820 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Temporary view structure for view `vBuySellDurations`
--

DROP TABLE IF EXISTS `vBuySellDurations`;
/*!50001 DROP VIEW IF EXISTS `vBuySellDurations`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `vBuySellDurations` AS SELECT 
 1 AS `strategy_id`,
 1 AS `symbol`,
 1 AS `days_in_position`*/;
SET character_set_client = @saved_cs_client;

--
-- Temporary view structure for view `vKPI`
--

DROP TABLE IF EXISTS `vKPI`;
/*!50001 DROP VIEW IF EXISTS `vKPI`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `vKPI` AS SELECT 
 1 AS `strategy_id`,
 1 AS `total_trades`,
 1 AS `closed_trades`,
 1 AS `avg_invested`,
 1 AS `total_profit`,
 1 AS `avg_profit_per_trade`,
 1 AS `avg_profit_pct`,
 1 AS `win_rate`,
 1 AS `avg_duration_sec`,
 1 AS `avg_days_in_position`*/;
SET character_set_client = @saved_cs_client;

--
-- Temporary view structure for view `v_strategy_metrics`
--

DROP TABLE IF EXISTS `v_strategy_metrics`;
/*!50001 DROP VIEW IF EXISTS `v_strategy_metrics`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_strategy_metrics` AS SELECT 
 1 AS `strategy_id`,
 1 AS `trades`,
 1 AS `total_profit`,
 1 AS `avg_profit`,
 1 AS `variance_profit`,
 1 AS `stddev_profit`,
 1 AS `max_profit`,
 1 AS `max_loss`,
 1 AS `winning_trades`,
 1 AS `losing_trades`,
 1 AS `win_rate`,
 1 AS `sharpe_like_ratio`,
 1 AS `total_days_in_position`,
 1 AS `max_days_in_position`,
 1 AS `annualized_return_abs`,
 1 AS `annualized_return_pct`*/;
SET character_set_client = @saved_cs_client;

--
-- Temporary view structure for view `vstrategies`
--

DROP TABLE IF EXISTS `vstrategies`;
/*!50001 DROP VIEW IF EXISTS `vstrategies`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `vstrategies` AS SELECT 
 1 AS `id`,
 1 AS `idBotIn`,
 1 AS `idBotOut`,
 1 AS `idSymbol`,
 1 AS `params`,
 1 AS `status`,
 1 AS `share`,
 1 AS `CapitaleInvestito`,
 1 AS `OpenOrders`,
 1 AS `NumeroOperazioni`,
 1 AS `NumeroOperazioniVincenti`,
 1 AS `ggCapitaleInvestito`,
 1 AS `MaxDay`,
 1 AS `MinDay`,
 1 AS `posizioneMercato`,
 1 AS `CapitaleResiduo`*/;
SET character_set_client = @saved_cs_client;

--
-- Dumping events for database 'Trading'
--

--
-- Final view structure for view `vBuySellDurations`
--

/*!50001 DROP VIEW IF EXISTS `vBuySellDurations`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`trading_user`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `vBuySellDurations` AS select `b`.`strategy_id` AS `strategy_id`,`b`.`symbol` AS `symbol`,(to_days(`s`.`filled_at`) - to_days(`b`.`filled_at`)) AS `days_in_position` from (`posizioni` `b` join `posizioni` `s` on(((`b`.`strategy_id` = `s`.`strategy_id`) and (`b`.`symbol` = `s`.`symbol`) and (`b`.`side` = 'buy') and (`s`.`side` = 'sell') and (`s`.`filled_at` > `b`.`filled_at`)))) where exists(select 1 from `posizioni` `x` where ((`x`.`strategy_id` = `b`.`strategy_id`) and (`x`.`symbol` = `b`.`symbol`) and (`x`.`side` = 'sell') and (`x`.`filled_at` > `b`.`filled_at`) and (`x`.`filled_at` < `s`.`filled_at`))) is false */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `vKPI`
--

/*!50001 DROP VIEW IF EXISTS `vKPI`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`trading_user`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `vKPI` AS select `p`.`strategy_id` AS `strategy_id`,count(0) AS `total_trades`,sum((case when (`p`.`side` = 'sell') then 1 else 0 end)) AS `closed_trades`,round(avg((case when (`p`.`side` = 'buy') then (`p`.`qty` * `p`.`filled_avg_price`) else NULL end)),2) AS `avg_invested`,round(sum((case when (`p`.`side` = 'sell') then `p`.`unrealized_pl` else 0 end)),2) AS `total_profit`,round(avg((case when (`p`.`side` = 'sell') then `p`.`unrealized_pl` else NULL end)),2) AS `avg_profit_per_trade`,round(avg((case when (`p`.`side` = 'sell') then `p`.`unrealized_plpc` else NULL end)),4) AS `avg_profit_pct`,round((sum((case when ((`p`.`side` = 'sell') and (`p`.`unrealized_pl` > 0)) then 1 else 0 end)) / nullif(sum((case when (`p`.`side` = 'sell') then 1 else 0 end)),0)),4) AS `win_rate`,round(avg(timestampdiff(SECOND,`p`.`created_at`,`p`.`filled_at`)),2) AS `avg_duration_sec`,(select round(avg(`d`.`days_in_position`),2) from `vBuySellDurations` `d` where (`d`.`strategy_id` = `p`.`strategy_id`)) AS `avg_days_in_position` from `posizioni` `p` group by `p`.`strategy_id` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_strategy_metrics`
--

/*!50001 DROP VIEW IF EXISTS `v_strategy_metrics`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`trading_user`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_strategy_metrics` AS select `strategy_runs`.`strategy_id` AS `strategy_id`,count(0) AS `trades`,sum(`strategy_runs`.`PLCapitale`) AS `total_profit`,avg(`strategy_runs`.`PLCapitale`) AS `avg_profit`,var_samp(`strategy_runs`.`PLCapitale`) AS `variance_profit`,stddev_samp(`strategy_runs`.`PLCapitale`) AS `stddev_profit`,max(`strategy_runs`.`PLCapitale`) AS `max_profit`,min(`strategy_runs`.`PLCapitale`) AS `max_loss`,sum((case when (`strategy_runs`.`PLCapitale` > 0) then 1 else 0 end)) AS `winning_trades`,sum((case when (`strategy_runs`.`PLCapitale` <= 0) then 1 else 0 end)) AS `losing_trades`,round(((sum((case when (`strategy_runs`.`PLCapitale` > 0) then 1 else 0 end)) * 1.0) / count(0)),4) AS `win_rate`,(case when (stddev_samp(`strategy_runs`.`PLCapitale`) = 0) then NULL else round((avg(`strategy_runs`.`PLCapitale`) / stddev_samp(`strategy_runs`.`PLCapitale`)),4) end) AS `sharpe_like_ratio`,sum(timestampdiff(DAY,`strategy_runs`.`open_date`,`strategy_runs`.`close_date`)) AS `total_days_in_position`,max(timestampdiff(DAY,`strategy_runs`.`open_date`,`strategy_runs`.`close_date`)) AS `max_days_in_position`,round(((sum(`strategy_runs`.`PLCapitale`) * 365.0) / nullif(sum(timestampdiff(DAY,`strategy_runs`.`open_date`,`strategy_runs`.`close_date`)),0)),2) AS `annualized_return_abs`,round(((sum(`strategy_runs`.`PLPerc`) * 365.0) / nullif(sum(timestampdiff(DAY,`strategy_runs`.`open_date`,`strategy_runs`.`close_date`)),0)),4) AS `annualized_return_pct` from `strategy_runs` where (`strategy_runs`.`close_date` is not null) group by `strategy_runs`.`strategy_id` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `vstrategies`
--

/*!50001 DROP VIEW IF EXISTS `vstrategies`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`trading_user`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `vstrategies` AS select `S`.`id` AS `id`,`BIN`.`name` AS `idBotIn`,`BOUT`.`name` AS `idBotOut`,`C`.`name` AS `idSymbol`,`S`.`params` AS `params`,`S`.`status` AS `status`,`S`.`share` AS `share`,`S`.`CapitaleInvestito` AS `CapitaleInvestito`,`S`.`OpenOrders` AS `OpenOrders`,`S`.`NumeroOperazioni` AS `NumeroOperazioni`,`S`.`NumeroOperazioniVincenti` AS `NumeroOperazioniVincenti`,`S`.`ggCapitaleInvestito` AS `ggCapitaleInvestito`,`S`.`MaxDay` AS `MaxDay`,`S`.`MinDay` AS `MinDay`,`S`.`posizioneMercato` AS `posizioneMercato`,`S`.`CapitaleResiduo` AS `CapitaleResiduo` from (((`strategies` `S` join `bots` `BIN`) join `bots` `BOUT`) join `Symbols` `C`) where ((`S`.`idBotIn` = `BIN`.`id`) and (`S`.`idBotOut` = `BOUT`.`id`) and (`S`.`idSymbol` = `C`.`id`)) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-07-02 22:51:32
