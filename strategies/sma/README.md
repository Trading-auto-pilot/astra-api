# SMA Strategy Microservice

This microservice implements the **Simple Moving Average (SMA)** trading strategy. It exposes a REST API for receiving candlestick data and returning trading signals (`BUY`, `SELL`, `HOLD`) based on dynamic parameters.

## 🧠 Overview

The strategy compares the current price to the moving average over a configurable period. It supports:

- RESTful API for candle evaluation
- External integration with:
  - StrategyUtils (for moving average calculation)
  - DBManager (for last trade retrieval and bot registration)

## ⚙️ Features

- Signal decision: `BUY`, `SELL`, or `HOLD`
- SL (Stop Loss) and TP (Take Profit) enforcement
- Bot self-registration with DBManager
- Last transaction memory loading
- Modular & dockerized design

## 🔧 Environment Variables

The following variables must be set (typically via `.env` or Docker):

| Variable               | Description                          |
|------------------------|--------------------------------------|
| `DBMANAGER_URL`        | URL of the DBManager service         |
| `STRATEGYUTILS_URL`    | URL of the StrategyUtils service     |
| `PORT`                 | (optional) Port to expose (default: 3008) |

## 📤 REST Endpoints

### `POST /processCandle`

Evaluate a single candlestick for a signal.

#### Request Body

```json
{
  "scenarioId": "string",
  "candle": {
    "t": "2025-04-30T14:30:00Z",
    "o": 390.10,
    "h": 391.00,
    "l": 389.50,
    "c": 390.85,
    "v": 50000
  }
}
```

#### Response

```json
{
  "action": "BUY",
  "prezzo": 390.85,
  "MA": 389.42
}
```

### `GET /health`

Returns service status.

```json
{
  "status": "OK",
  "module": "SMA",
  "uptime": 123.45
}
```

### `GET /info`

Returns metadata about the strategy module.

```json
{
  "module": "SMA",
  "version": "1.0",
  "status": "OK"
}
```

## 🚀 Run with Docker

```bash
docker build -t sma-strategy .
docker run -p 3008:3008 --env-file .env sma-strategy
```

## 🧱 Part of Modular Architecture

This service is part of a larger distributed trading system, designed for containerized strategy execution and real-time evaluation.

---

### 🛠 Developed with ❤️ by [YourName]