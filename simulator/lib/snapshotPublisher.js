"use strict";

// ---------------------------------------------------------------------------
// snapshotPublisher — publish candle data as snapshot to the Redis data channel
//
// Decision-engine's createMarketDataHandler reads from the same envelope published
// by market-data-service:
//   { type: "marketData", ts, ticker, conid?, payload: {31,84,86,7762,87}, dataMode: "snapshot" }
//
// Field keys (IBKR field IDs):
//   31   = last price
//   84   = bid
//   86   = ask
//   7762 = volume (primary)
//   87   = volume (fallback)
// ---------------------------------------------------------------------------

const SPREAD_FACTOR = 0.0005; // 0.05% synthetic bid/ask spread

function candleToPayload(candle) {
  const close = candle.c ?? candle.close ?? null;
  if (close === null || !Number.isFinite(Number(close))) return null;
  const price = Number(close);
  const volume = Number(candle.v ?? candle.volume ?? 0);
  const spread = price * SPREAD_FACTOR;

  return {
    "31": price,
    "84": parseFloat((price - spread).toFixed(4)),
    "86": parseFloat((price + spread).toFixed(4)),
    "7762": volume,
    "87": volume,
  };
}

async function publishSnapshot(bus, channel, ticker, candle) {
  const payload = candleToPayload(candle);
  if (!payload) return false;

  const candleTs = candle?.t ? new Date(candle.t).getTime() : null;
  const message = {
    type: "marketData",
    ts: Date.now(),
    candleTs: Number.isFinite(candleTs) ? candleTs : undefined,
    dataMode: "snapshot",
    ticker: String(ticker).toUpperCase(),
    payload,
  };
  if (candle?.conid != null) {
    message.conid = candle.conid;
  }

  await bus.publish(channel, message);
  return true;
}

module.exports = { publishSnapshot, candleToPayload };
