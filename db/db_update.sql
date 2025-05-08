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
-- Table structure for table `Bots`
--

DROP TABLE IF EXISTS `Bots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Bots` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(20) NOT NULL,
  `ver` varchar(5) DEFAULT NULL,
  `status` varchar(20) DEFAULT NULL COMMENT 'active or inactive',
  `date_release` datetime DEFAULT NULL,
  `totalProfitLoss` decimal(10,0) DEFAULT NULL,
  `containerName` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Bots`
--

LOCK TABLES `Bots` WRITE;
/*!40000 ALTER TABLE `Bots` DISABLE KEYS */;
INSERT INTO `Bots` VALUES (1,'SMA','1.0','active','2025-05-08 15:06:00',0,'localhost');
/*!40000 ALTER TABLE `Bots` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `OrdersSimulated`
--

DROP TABLE IF EXISTS `OrdersSimulated`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `OrdersSimulated` (
  `id` char(36) NOT NULL,
  `client_order_id` char(36) DEFAULT NULL,
  `created_at` datetime(6) DEFAULT NULL,
  `updated_at` datetime(6) DEFAULT NULL,
  `submitted_at` datetime(6) DEFAULT NULL,
  `filled_at` datetime(6) DEFAULT NULL,
  `expired_at` datetime(6) DEFAULT NULL,
  `canceled_at` datetime(6) DEFAULT NULL,
  `failed_at` datetime(6) DEFAULT NULL,
  `replaced_at` datetime(6) DEFAULT NULL,
  `replaced_by` char(36) DEFAULT NULL,
  `replaces` char(36) DEFAULT NULL,
  `asset_id` char(36) DEFAULT NULL,
  `symbol` varchar(10) DEFAULT NULL,
  `asset_class` varchar(20) DEFAULT NULL,
  `notional` decimal(20,6) DEFAULT NULL,
  `qty` decimal(20,6) DEFAULT NULL,
  `filled_qty` decimal(20,6) DEFAULT NULL,
  `filled_avg_price` decimal(20,6) DEFAULT NULL,
  `order_class` varchar(20) DEFAULT NULL,
  `order_type` varchar(20) DEFAULT NULL,
  `type` varchar(20) DEFAULT NULL,
  `side` enum('buy','sell') DEFAULT NULL,
  `time_in_force` varchar(10) DEFAULT NULL,
  `limit_price` decimal(20,6) DEFAULT NULL,
  `stop_price` decimal(20,6) DEFAULT NULL,
  `status` varchar(20) DEFAULT NULL,
  `extended_hours` tinyint(1) DEFAULT NULL,
  `legs` json DEFAULT NULL,
  `trail_percent` decimal(10,6) DEFAULT NULL,
  `trail_price` decimal(20,6) DEFAULT NULL,
  `hwm` varchar(50) DEFAULT NULL,
  `subtag` varchar(50) DEFAULT NULL,
  `source` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `OrdersSimulated`
--

LOCK TABLES `OrdersSimulated` WRITE;
/*!40000 ALTER TABLE `OrdersSimulated` DISABLE KEYS */;
INSERT INTO `OrdersSimulated` VALUES ('25d9cc47-4ade-4b3c-aaeb-1d6d9dae5834','f1e4f381-0396-4b30-a5e2-9beb1ef595ef','2025-05-07 17:24:38.000000','2025-05-07 17:24:38.000000','2025-05-07 17:24:38.000000','2025-05-07 17:24:38.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000',NULL,NULL,'beaeb0a3-2bbc-4f73-a8f4-b4c0ddc2c76d','MSFT','crypto',NULL,NULL,NULL,0.500000,'','limit','limit','buy','day',0.500000,NULL,'filled',0,NULL,NULL,NULL,NULL,NULL,NULL),('27adc9b2-e1f5-4018-9596-50eaaf2267ce','76e345ee-c72d-46b7-a5e6-eb8fcc3757df','2025-05-07 17:26:32.000000','2025-05-07 17:26:32.000000','2025-05-07 17:26:32.000000','2025-05-07 17:26:32.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000',NULL,NULL,'86b8a56c-8ac8-4524-bb27-a4e29ad5245f','MSFT','crypto',NULL,NULL,NULL,0.500000,'','limit','limit','buy','day',0.500000,NULL,'filled',0,NULL,NULL,NULL,NULL,NULL,NULL),('3a8d3409-736e-4fb5-9692-2ce675648860','9baa9f9a-8690-44cb-82b6-0d5fc8a4ab40','2025-05-07 17:35:35.000000','2025-05-07 17:35:35.000000','2025-05-07 17:35:35.000000','2025-05-07 17:35:35.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000',NULL,NULL,'26da39a6-8281-4536-b3c1-e8406ba0ec03','MSFT','crypto',NULL,127.000000,127.000000,0.500000,'','limit','limit','buy','day',0.500000,NULL,'filled',0,NULL,NULL,NULL,NULL,NULL,NULL),('41eaa691-45ff-4518-b15a-6b6f74d285a7','339f4fec-45a3-4e0e-a915-677d8cb90fcd','2025-05-06 18:19:13.000000','2025-05-06 18:19:13.000000','2025-05-06 18:19:13.000000','2025-05-06 18:19:13.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000',NULL,NULL,'e1cf390a-7184-409a-8d92-8bc0aad3c6df','MFST','crypto',NULL,20.000000,20.000000,100.000000,'','limit','limit','buy','day',NULL,NULL,'filled',0,NULL,NULL,NULL,NULL,NULL,NULL),('5f731271-75d2-4970-9bc2-dfd0fa97a05a','a84c0c47-c1fc-4b96-8a50-703240b91fc9','2025-05-07 17:28:59.000000','2025-05-07 17:28:59.000000','2025-05-07 17:28:59.000000','2025-05-07 17:28:59.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000',NULL,NULL,'75f00002-3e32-46e5-85d3-7815b3ca484d','MSFT','crypto',NULL,NULL,NULL,0.500000,'','limit','limit','buy','day',0.500000,NULL,'filled',0,NULL,NULL,NULL,NULL,NULL,NULL),('7a22b1ec-cc48-473d-8801-ece6fb9ae1b9','d06b9790-dcdb-4685-84f3-9b6e81db9c94','2025-05-07 17:30:58.000000','2025-05-07 17:30:58.000000','2025-05-07 17:30:58.000000','2025-05-07 17:30:58.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000',NULL,NULL,'4c7f10b9-6aa2-4fe5-a9de-13a1c6d472d0','MSFT','crypto',NULL,NULL,NULL,0.500000,'','limit','limit','buy','day',0.500000,NULL,'filled',0,NULL,NULL,NULL,NULL,NULL,NULL),('b4ccdf7e-3b95-45e4-a553-76934e4ecd4d','f49e6cd1-098f-43ae-bc65-1fdee38d5a92','2025-05-07 17:42:57.000000','2025-05-07 17:42:57.000000','2025-05-07 17:42:57.000000','2025-05-07 17:42:57.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000',NULL,NULL,'d38184ef-bd6c-4829-b633-5b0b2acd979c','MSFT','crypto',NULL,127.000000,127.000000,0.500000,'','limit','limit','buy','day',0.500000,NULL,'filled',0,NULL,NULL,NULL,NULL,NULL,NULL),('b58a6328-f1e3-40b6-9f6b-35bf3497be92','b12e8844-2672-47a5-887c-fe8ee5a8786e','2025-05-07 17:39:14.000000','2025-05-07 17:39:14.000000','2025-05-07 17:39:14.000000','2025-05-07 17:39:14.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000',NULL,NULL,'05c74e3e-47d6-4c6c-8a89-d934a384c362','MSFT','crypto',NULL,127.000000,127.000000,0.500000,'','limit','limit','buy','day',0.500000,NULL,'filled',0,NULL,NULL,NULL,NULL,NULL,NULL),('bd59fa4e-cbed-410a-afac-f19c98bce62a','57a44b06-9622-4b2d-b433-76553fd40018','2025-05-06 18:19:31.000000','2025-05-06 18:19:31.000000','2025-05-06 18:19:31.000000','2025-05-06 18:19:31.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000',NULL,NULL,'a1ebe9c5-4923-4d68-9e96-961eb32d8c0e','MSFT','crypto',NULL,137.000000,137.000000,0.500000,'','limit','limit','buy','day',0.500000,NULL,'filled',0,NULL,NULL,NULL,NULL,NULL,NULL),('ca75fb94-64b6-4dc7-8011-6e76c5bed3c8','9d098589-393b-43d7-89aa-5d194256c744','2025-05-08 09:43:39.000000','2025-05-08 09:43:39.000000','2025-05-08 09:43:39.000000','2025-05-08 09:43:39.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000',NULL,NULL,'db445e81-25fb-46d4-8167-e6ca377f1d6c','MSFT','crypto',NULL,133.000000,133.000000,0.500000,'','limit','limit','buy','day',0.500000,NULL,'filled',0,NULL,NULL,NULL,NULL,NULL,NULL),('cd6afceb-dc4d-4689-813d-dab80409603b','fa10cbc1-a672-43b1-9921-c752d63bba42','2025-05-07 17:52:57.000000','2025-05-07 17:52:57.000000','2025-05-07 17:52:57.000000','2025-05-07 17:52:57.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000',NULL,NULL,'f21900c1-e0bb-4c0a-a6f0-d1bec07c5821','MSFT','crypto',NULL,127.000000,127.000000,0.500000,'','limit','limit','buy','day',0.500000,NULL,'filled',0,NULL,NULL,NULL,NULL,NULL,NULL),('e0dca6fe-c8fe-4fbf-8d60-d65d52881762','a7f485a3-e5d7-442a-a140-2dc0263c2542','2025-05-07 17:33:16.000000','2025-05-07 17:33:16.000000','2025-05-07 17:33:16.000000','2025-05-07 17:33:16.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000',NULL,NULL,'4a7410be-947f-44d8-a71d-233c002a9829','MSFT','crypto',NULL,127.000000,127.000000,0.500000,'','limit','limit','buy','day',0.500000,NULL,'filled',0,NULL,NULL,NULL,NULL,NULL,NULL),('e449008b-3a09-46d1-ace6-be18bed8abc1','5f5533c0-3c72-4695-9ec0-0304f546a2e2','2025-05-07 17:45:59.000000','2025-05-07 17:45:59.000000','2025-05-07 17:45:59.000000','2025-05-07 17:45:59.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000','1970-01-01 00:00:00.000000',NULL,NULL,'9e0a56f9-ae0b-4d74-a08d-8176a099ade5','MSFT','crypto',NULL,127.000000,127.000000,0.500000,'','limit','limit','buy','day',0.500000,NULL,'filled',0,NULL,NULL,NULL,NULL,NULL,NULL);
/*!40000 ALTER TABLE `OrdersSimulated` ENABLE KEYS */;
UNLOCK TABLES;

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
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `Symbols`
--

LOCK TABLES `Symbols` WRITE;
/*!40000 ALTER TABLE `Symbols` DISABLE KEYS */;
INSERT INTO `Symbols` VALUES (1,'MSFT'),(2,'AAPL'),(3,'GOLD'),(4,'META'),(5,'AMZN'),(6,'OIL'),(7,'GOOG');
/*!40000 ALTER TABLE `Symbols` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `orders`
--

DROP TABLE IF EXISTS `orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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

--
-- Dumping data for table `orders`
--

LOCK TABLES `orders` WRITE;
/*!40000 ALTER TABLE `orders` DISABLE KEYS */;
INSERT INTO `orders` VALUES ('04fe4c28-2528-4e28-9cca-1440cf922d32','9baa9f9a-8690-44cb-82b6-0d5fc8a4ab40','2025-05-07 17:35:35.912000','2025-05-07 17:35:35.912000','2025-05-07 17:35:35.912000','2025-05-07 17:35:35.912000',NULL,NULL,NULL,NULL,NULL,NULL,'26da39a6-8281-4536-b3c1-e8406ba0ec03','MSFT','crypto',NULL,127.0000,127.0000,0.5000,'','limit','limit','buy',NULL,'day',0.5000,NULL,'filled',0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),('120bfd12-f5dc-47da-ba44-a4d8e64959b5','126d0493-1874-4a62-9b0d-fa06f28721d7','2025-05-06 16:38:45.456000','2025-05-06 16:38:45.456000','2025-05-06 16:38:45.456000','2025-05-06 16:38:45.456000',NULL,NULL,NULL,NULL,NULL,NULL,'3141a11c-a1c2-4581-be60-b39cde57d82a','AAPL','crypto',NULL,7.0000,7.0000,100.0000,'','limit','limit','buy',NULL,'gtc',NULL,NULL,'filled',0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),('35f42e84-1ebe-4c7c-85f2-7d3fcac4d3d6','57a44b06-9622-4b2d-b433-76553fd40018','2025-05-06 18:19:31.419000','2025-05-06 18:19:31.419000','2025-05-06 18:19:31.419000','2025-05-06 18:19:31.419000',NULL,NULL,NULL,NULL,NULL,NULL,'a1ebe9c5-4923-4d68-9e96-961eb32d8c0e','MSFT','crypto',NULL,137.0000,137.0000,0.5000,'','limit','limit','buy',NULL,'day',0.5000,NULL,'filled',0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),('a683d816-a8b7-484e-826e-1e2295545883','5f5533c0-3c72-4695-9ec0-0304f546a2e2','2025-05-07 17:45:59.192000','2025-05-07 17:45:59.192000','2025-05-07 17:45:59.192000','2025-05-07 17:45:59.192000',NULL,NULL,NULL,NULL,NULL,NULL,'9e0a56f9-ae0b-4d74-a08d-8176a099ade5','MSFT','crypto',NULL,127.0000,127.0000,0.5000,'','limit','limit','buy',NULL,'day',0.5000,NULL,'filled',0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),('aadaade9-4007-409c-b2ca-dd922afd0d82','f49e6cd1-098f-43ae-bc65-1fdee38d5a92','2025-05-07 17:42:57.158000','2025-05-07 17:42:57.158000','2025-05-07 17:42:57.158000','2025-05-07 17:42:57.158000',NULL,NULL,NULL,NULL,NULL,NULL,'d38184ef-bd6c-4829-b633-5b0b2acd979c','MSFT','crypto',NULL,127.0000,127.0000,0.5000,'','limit','limit','buy',NULL,'day',0.5000,NULL,'filled',0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),('d7f103f5-4642-4b3d-875a-8a0e1d907656','b12e8844-2672-47a5-887c-fe8ee5a8786e','2025-05-07 17:39:14.492000','2025-05-07 17:39:14.492000','2025-05-07 17:39:14.492000','2025-05-07 17:39:14.492000',NULL,NULL,NULL,NULL,NULL,NULL,'05c74e3e-47d6-4c6c-8a89-d934a384c362','MSFT','crypto',NULL,127.0000,127.0000,0.5000,'','limit','limit','buy',NULL,'day',0.5000,NULL,'filled',0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),('f495e77e-421e-4433-8647-4b4f9f2b3b11','fa10cbc1-a672-43b1-9921-c752d63bba42','2025-05-07 17:52:57.716000','2025-05-07 17:52:57.716000','2025-05-07 17:52:57.716000','2025-05-07 17:52:57.716000',NULL,NULL,NULL,NULL,NULL,NULL,'f21900c1-e0bb-4c0a-a6f0-d1bec07c5821','MSFT','crypto',NULL,127.0000,127.0000,0.5000,'','limit','limit','buy',NULL,'day',0.5000,NULL,'filled',0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),('f5f91846-5650-4eaf-b324-7fb8c03bb2fb','9d098589-393b-43d7-89aa-5d194256c744','2025-05-08 09:43:39.123000','2025-05-08 09:43:39.123000','2025-05-08 09:43:39.123000','2025-05-08 09:43:39.123000',NULL,NULL,NULL,NULL,NULL,NULL,'db445e81-25fb-46d4-8167-e6ca377f1d6c','MSFT','crypto',NULL,133.0000,133.0000,0.5000,'','limit','limit','buy',NULL,'day',0.5000,NULL,'filled',0,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
/*!40000 ALTER TABLE `orders` ENABLE KEYS */;
UNLOCK TABLES;

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
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `settings`
--

LOCK TABLES `settings` WRITE;
/*!40000 ALTER TABLE `settings` DISABLE KEYS */;
INSERT INTO `settings` VALUES (11,'ALPACA-MARKET-HOST','data.alpaca.markets',1),(12,'APCA-API-KEY-ID','PKNS94MR3ZI0U7AFMEBS',1),(13,'APCA-API-SECRET-KEY','Sm2wcfjDQZo0aNGoofSWFSDESWgdVhPD6QczFx0R',1),(14,'ALPACA-WSS-IEX','iex',1),(15,'ALPACA-WSS-SIP','sip',1),(16,'ALPACA-WSS-TEST','test',1),(17,'ALPACA-LIVE-MARKET','wss://stream.data.alpaca.markets/v2',1),(18,'ALPACA-SANDBOX-MARKET','wss://stream.data.sandbox.alpaca.markets/v2',1),(19,'ALPACA-LIVE-TRADING','wss://data.alpaca.markets/stream',1),(20,'ALPACA-PAPER-TRADING','wss://paper.api.alpaca.markets/stream',1),(21,'ALPACA-API-TIMEOUT','3000',1),(22,'TF-DEFAULT','15Min',1),(23,'ALPACA-HISTORICAL-FEED','sip',1),(24,'ALPACA-MARKET-DATA-BASE','data.alpaca.markets',1),(25,'SMTP_HOST','smtp.mail.me.com',1),(26,'SMTP_PORT','587',1),(27,'SMTP_USER','expovin@icloud.com',1),(28,'SMTP_PASSWORD','brcl-szle-lanq-bfug',1),(29,'SMTP_FROM','expovin@icloud.com',1),(30,'ALPACA-PAPER-BASE','https://paper-api.alpaca.markets',1),(31,'ALPACA-LIVE-BASE','https://data.alpaca.markets',1),(32,'STREAM-SIMULATION-DELAY','5',1),(33,'LOCAL-WS-STREAM-BASE','ws://marketsimulator:3003/',1),(34,'ALPACA-LOCAL-MARKET','ws://marketsimulator:3003/v2',1),(35,'ALPACA-LOCAL-TRADING','ws://ordersimulator:3004',1),(36,'ALPACA-LOCAL-BASE','http://ordersimulator:3004',1);
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
  `idBot` int NOT NULL,
  `idSymbol` int NOT NULL,
  `status` varchar(20) DEFAULT NULL COMMENT 'running, stop, inactive',
  `params` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `share` double DEFAULT NULL,
  `CapitaleInvestito` double DEFAULT NULL,
  `OpenOrders` double DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `strategies`
--

LOCK TABLES `strategies` WRITE;
/*!40000 ALTER TABLE `strategies` DISABLE KEYS */;
INSERT INTO `strategies` VALUES (2,1,1,'active','{\"MA\":25, \"SL\":0.05, \"TP\":0.1, \"TF\":\"15Min\", \"buy\": {\"type\" : \"limit\", \"time_in_force\":\"day\",\"limit_price\":\"0.5\",\"stop_price\":null,\"trail_price\":null,\"extended_hours\":false}, \"sell\" : {\"type\":\"trailing_stop\",\"time_in_force\":\"day\",\"limit_price\":null, \"stop_price\":null,\"trail_price\":\"0.03\",\"extended_hours\":false}}',0.35,20000,50021.3),(8,1,4,'active','{\"MA\":45, \"SL\":0.03, \"TP\":0.12, \"TF\":\"15Min\"}',0.5,20000,10000),(9,1,2,'active','{\"MA\":25, \"SL\":0.05, \"TP\":0.1, \"TF\":\"15Min\"}',0.95,400,17300.600000000002);
/*!40000 ALTER TABLE `strategies` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `strategy_runs`
--

DROP TABLE IF EXISTS `strategy_runs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `strategy_runs`
--

LOCK TABLES `strategy_runs` WRITE;
/*!40000 ALTER TABLE `strategy_runs` DISABLE KEYS */;
/*!40000 ALTER TABLE `strategy_runs` ENABLE KEYS */;
UNLOCK TABLES;

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
  PRIMARY KEY (`id`),
  KEY `ScenarioID` (`ScenarioID`),
  KEY `operationDate` (`operationDate`)
) ENGINE=InnoDB AUTO_INCREMENT=846 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `transazioni`
--

LOCK TABLES `transazioni` WRITE;
/*!40000 ALTER TABLE `transazioni` DISABLE KEYS */;
INSERT INTO `transazioni` VALUES (842,'9','2023-12-12 14:30:00','BUY ORDER',376.1000,2632.7000,NULL,NULL,NULL,25.0000,'24ed988b-820a-448c-a965-daebf24b5c59',2633),(843,'2','2023-12-12 14:30:00','BUY ORDER',376.1000,51525.7000,NULL,NULL,NULL,25.0000,'bd59fa4e-cbed-410a-afac-f19c98bce62a',137),(844,'2','2023-12-12 14:30:00','BUY ORDER',376.1000,47764.7000,NULL,NULL,NULL,25.0000,'cd6afceb-dc4d-4689-813d-dab80409603b',127),(845,'2','2023-12-12 14:30:00','BUY ORDER',376.1000,50021.3000,NULL,NULL,NULL,25.0000,'ca75fb94-64b6-4dc7-8011-6e76c5bed3c8',133);
/*!40000 ALTER TABLE `transazioni` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Temporary view structure for view `vstrategies`
--

DROP TABLE IF EXISTS `vstrategies`;
/*!50001 DROP VIEW IF EXISTS `vstrategies`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `vstrategies` AS SELECT 
 1 AS `id`,
 1 AS `bot`,
 1 AS `symbol`,
 1 AS `params`,
 1 AS `status`,
 1 AS `share`,
 1 AS `CapitaleInvestito`,
 1 AS `OpenOrders`*/;
SET character_set_client = @saved_cs_client;

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
/*!50001 VIEW `vstrategies` AS select `S`.`id` AS `id`,`B`.`name` AS `bot`,`C`.`name` AS `symbol`,`S`.`params` AS `params`,`S`.`status` AS `status`,`S`.`share` AS `share`,`S`.`CapitaleInvestito` AS `CapitaleInvestito`,`S`.`OpenOrders` AS `OpenOrders` from ((`strategies` `S` join `Bots` `B`) join `Symbols` `C`) where ((`S`.`idBot` = `B`.`id`) and (`S`.`idSymbol` = `C`.`id`)) */;
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

-- Dump completed on 2025-05-08 21:07:02
