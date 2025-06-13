CREATE TABLE Trading.logs (
  id INT NOT NULL AUTO_INCREMENT,
  timestamp DATETIME NOT NULL,
  level VARCHAR(10) NOT NULL,
  functionName VARCHAR(100) NOT NULL,
  message TEXT NOT NULL,
  jsonDetails JSON DEFAULT NULL,
  microservice VARCHAR(100) DEFAULT NULL,
  moduleName VARCHAR(100) DEFAULT NULL,
  moduleVersion VARCHAR(20) DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_timestamp (timestamp),
  KEY idx_level (level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;