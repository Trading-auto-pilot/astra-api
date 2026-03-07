"use strict";

const MomentumCalculator = require("./momentumCalculator");

// ---------------------------------------------------------------------------
// Shared test instance — no network calls needed for computeTechnicals
// ---------------------------------------------------------------------------
const logger = { trace: () => {}, log: () => {}, info: () => {}, warning: () => {}, error: () => {} };
const mc = new MomentumCalculator({ logger, cachemanagerUrl: "http://localhost:3001" });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate N synthetic daily candles sorted ascending.
 * Price oscillates slightly around a base so RSI/ATR/gaps are non-trivial.
 */
function makeCandles(n, { startClose = 100, volumeNull = false, hlNull = false, openNull = false } = {}) {
  const candles = [];
  let price = startClose;
  for (let i = 0; i < n; i++) {
    price = Math.max(1, price + Math.sin(i * 0.3) * 1.5 + 0.1);
    const high  = hlNull   ? null : price * 1.01;
    const low   = hlNull   ? null : price * 0.99;
    const open  = openNull ? null : price * (1 + Math.sin(i) * 0.003);
    const vol   = volumeNull ? null : 1_000_000 + i * 100;
    // Use a deterministic date offset from 2023-01-01
    const d = new Date(Date.UTC(2023, 0, 1 + i));
    candles.push({ t: d.toISOString(), o: open, h: high, l: low, c: price, v: vol });
  }
  return candles;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MomentumCalculator.computeTechnicals", () => {

  // ---- empty / no input ----

  test("returns all null when candles is empty array", () => {
    const r = mc.computeTechnicals([]);
    expect(r.ret_1d).toBeNull();
    expect(r.sma_200).toBeNull();
    expect(r.atr_14).toBeNull();
    expect(r.dollar_vol_20d).toBeNull();
  });

  test("returns all null when candles is not an array", () => {
    const r = mc.computeTechnicals(null);
    expect(r.ret_1d).toBeNull();
    expect(r.rsi_14).toBeNull();
  });

  // ---- 260+ bars: all indicators non-null ----

  test("260 bars → all indicators non-null", () => {
    const candles = makeCandles(260);
    const r = mc.computeTechnicals(candles, { symbol: "TEST" });

    expect(r.ret_1d).not.toBeNull();
    expect(r.ret_5d).not.toBeNull();
    expect(r.ret_20d).not.toBeNull();
    expect(r.ret_60d).not.toBeNull();
    expect(r.sma_10).not.toBeNull();
    expect(r.sma_20).not.toBeNull();
    expect(r.sma_50).not.toBeNull();
    expect(r.sma_200).not.toBeNull();
    expect(r.sma_20_slope).not.toBeNull();
    expect(r.sma_50_slope).not.toBeNull();
    expect(r.atr_14).not.toBeNull();
    expect(r.atr_14_pct).not.toBeNull();
    expect(r.rsi_14).not.toBeNull();
    expect(r.avg_gap_20).not.toBeNull();
    expect(r.max_dd_60).not.toBeNull();
    expect(r.dollar_vol_20d).not.toBeNull();
  });

  // ---- 30 bars: long-history indicators null, short ones ok ----

  test("30 bars → ret_60d and sma_200 null, atr_14 and rsi_14 non-null", () => {
    const candles = makeCandles(30);
    const r = mc.computeTechnicals(candles);

    expect(r.ret_60d).toBeNull();   // needs 61 bars
    expect(r.sma_200).toBeNull();   // needs 200 bars
    expect(r.sma_50).toBeNull();    // needs 50 bars (30 < 50)
    expect(r.atr_14).not.toBeNull();  // needs 15 bars — ok
    expect(r.rsi_14).not.toBeNull();  // needs 15 bars — ok
    expect(r.sma_20).not.toBeNull();  // needs 20 bars — ok
    expect(r.ret_20d).not.toBeNull(); // needs 21 bars — ok
  });

  // ---- volume null → dollar_vol_20d null ----

  test("missing volume → dollar_vol_20d null, other indicators unaffected", () => {
    const candles = makeCandles(30, { volumeNull: true });
    const r = mc.computeTechnicals(candles);

    expect(r.dollar_vol_20d).toBeNull();
    expect(r.sma_20).not.toBeNull();
    expect(r.rsi_14).not.toBeNull();
  });

  // ---- h/l null → atr_14 null, avg_gap_20 unaffected (uses o, c not h/l) ----

  test("missing high/low → atr_14 null, rsi_14 and sma still computed", () => {
    const candles = makeCandles(30, { hlNull: true });
    const r = mc.computeTechnicals(candles);

    expect(r.atr_14).toBeNull();
    expect(r.atr_14_pct).toBeNull();
    expect(r.rsi_14).not.toBeNull();
    expect(r.sma_20).not.toBeNull();
    expect(r.avg_gap_20).not.toBeNull(); // _avgGap uses open/close, not high/low
  });

  // ---- open null → avg_gap_20 null, ATR and RSI unaffected ----

  test("missing open → avg_gap_20 null, atr_14 and rsi_14 still computed", () => {
    const candles = makeCandles(30, { openNull: true });
    const r = mc.computeTechnicals(candles);

    expect(r.avg_gap_20).toBeNull();
    expect(r.atr_14).not.toBeNull();
    expect(r.rsi_14).not.toBeNull();
  });

  // ---- atr_14_pct = atr_14 / lastClose ----

  test("atr_14_pct equals atr_14 / lastClose", () => {
    const candles = makeCandles(30);
    const r = mc.computeTechnicals(candles);

    if (r.atr_14 != null && r.atr_14_pct != null) {
      const lastClose = candles[candles.length - 1].c;
      expect(r.atr_14_pct).toBeCloseTo(r.atr_14 / lastClose, 10);
    }
  });

  // ---- ret_1d correctness on known data ----

  test("ret_1d is correct percentage change between last two closes", () => {
    // Build simple candles with known closes: 100, 110
    const candles = [
      { t: "2024-01-01T00:00:00Z", o: 99, h: 101, l: 99, c: 100, v: 1000 },
      { t: "2024-01-02T00:00:00Z", o: 101, h: 112, l: 101, c: 110, v: 1000 },
    ];
    const r = mc.computeTechnicals(candles);
    // ret_1d = (110 - 100) / 100 = 0.1
    expect(r.ret_1d).toBeCloseTo(0.1, 8);
  });

  // ---- dollar_vol_20d correctness on known data ----

  test("dollar_vol_20d is the mean of close * volume over last 20 bars", () => {
    const candles = makeCandles(25); // 25 bars, all with volume
    const r = mc.computeTechnicals(candles);
    // Manual computation
    const sorted = [...candles].sort((a, b) => new Date(a.t) - new Date(b.t));
    const last20 = sorted.slice(-20);
    const dvSum = last20.reduce((s, c) => s + c.c * c.v, 0);
    const expected = dvSum / 20;
    expect(r.dollar_vol_20d).toBeCloseTo(expected, 4);
  });

  // ---- sma values are averages of last N closes ----

  test("sma_10 matches manual average of last 10 closes", () => {
    const candles = makeCandles(30);
    const sorted = [...candles].sort((a, b) => new Date(a.t) - new Date(b.t));
    const closes = sorted.map(c => c.c);
    const manualSma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;

    const r = mc.computeTechnicals(candles);
    expect(r.sma_10).toBeCloseTo(manualSma10, 8);
  });
});
