"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const LiquidityScoreEngine = require("../modules/engine/liquidityScoreEngine");

function makeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function makeEngine(providers) {
  return new LiquidityScoreEngine({
    mode: "mock",
    minConfidenceForRegime: 0.6,
    providers,
    normalizers: {
      vix: () => ({ normalized: 40 }),
      spyTrend: () => ({ normalized: 81 }),
      dxy: () => ({ normalized: 55 }),
      credit: () => ({ normalized: 35 }),
    },
  });
}

test("only spy available -> score equals spy normalized and confidence is 0.35", async () => {
  const engine = makeEngine({
    vix: { getLatest: async () => { throw makeError("NO_DATA", "vix missing"); } },
    spyTrend: {
      getHistory: async () => [{ timestamp: "2026-02-01T00:00:00.000Z", value: 1, source: "test:spy" }],
      getLatest: async () => ({ timestamp: "2026-02-01T00:00:00.000Z", value: 1, source: "test:spy" }),
    },
    dxy: { getHistory: async () => { throw makeError("NO_DATA", "dxy missing"); }, getLatest: async () => { throw makeError("NO_DATA", "dxy missing"); } },
    credit: { getLatest: async () => { throw makeError("CONFIG_MISSING", "credit key missing"); } },
  });

  const snapshot = await engine.computeScore();
  assert.equal(snapshot.score, 81);
  assert.equal(snapshot.confidence, 0.35);
  assert.equal(snapshot.riskRegime, "UNKNOWN");
});

test("spy + vix available -> score computed on available weights only", async () => {
  const engine = makeEngine({
    vix: { getLatest: async () => ({ timestamp: "2026-02-01T00:00:00.000Z", value: 20, source: "test:vix" }) },
    spyTrend: {
      getHistory: async () => [{ timestamp: "2026-02-01T00:00:00.000Z", value: 1, source: "test:spy" }],
      getLatest: async () => ({ timestamp: "2026-02-01T00:00:00.000Z", value: 1, source: "test:spy" }),
    },
    dxy: { getHistory: async () => { throw makeError("NO_DATA", "dxy missing"); }, getLatest: async () => { throw makeError("NO_DATA", "dxy missing"); } },
    credit: { getLatest: async () => { throw makeError("NO_DATA", "credit missing"); } },
  });

  const snapshot = await engine.computeScore();
  assert.equal(snapshot.confidence, 0.7);
  assert.equal(snapshot.score, 60.5);
  assert.equal(snapshot.riskRegime, "RISK_ON");
});

test("none available -> score null confidence 0 regime UNKNOWN", async () => {
  const engine = makeEngine({
    vix: { getLatest: async () => { throw makeError("NO_DATA", "missing"); } },
    spyTrend: { getHistory: async () => { throw makeError("NO_DATA", "missing"); }, getLatest: async () => { throw makeError("NO_DATA", "missing"); } },
    dxy: { getHistory: async () => { throw makeError("NO_DATA", "missing"); }, getLatest: async () => { throw makeError("NO_DATA", "missing"); } },
    credit: { getLatest: async () => { throw makeError("NO_DATA", "missing"); } },
  });

  const snapshot = await engine.computeScore();
  assert.equal(snapshot.score, null);
  assert.equal(snapshot.confidence, 0);
  assert.equal(snapshot.riskRegime, "UNKNOWN");
});
