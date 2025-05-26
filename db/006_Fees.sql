CREATE TABLE Trading.fees (
	id INT NOT NULL,
	name VARCHAR(50) NULL,
	FeePerShare DECIMAL(8,6) NULL,
	FeePerDollar DECIMAL(8,6) NULL,
	Cap DECIMAL(6,4) NULL,
	side varchar(10) NULL,
	Description varchar(100) NULL,
	CONSTRAINT fees_pk PRIMARY KEY (id)
)
ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE Trading.fees MODIFY COLUMN id int auto_increment NOT NULL;

INSERT INTO Trading.fees (name,FeePerShare,FeePerDollar,Cap,side,Description) VALUES
	 ('TAF',0.000145,NULL,7.2700,'sell','FINRA TAF (Trading Activity Fee)'),
	 ('SEC',NULL,0.000022,NULL,'sell','SEC Fee (also called SEC Regulatory Fee)');


ALTER TABLE Trading.orders ADD cancel_requested_at DATETIME NULL;
ALTER TABLE Trading.orders CHANGE cancel_requested_at cancel_requested_at DATETIME NULL AFTER canceled_at;
