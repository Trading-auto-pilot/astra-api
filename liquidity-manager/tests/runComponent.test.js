"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runComponent } = require("../modules/components/runComponent");

test("runComponent returns OK on valid normalized value", async () => {
  const out = await runComponent({
    name: "spyTrend",
    weight: 0.35,
    fetchFn: async () => ({ value: 123 }),
    normalizeFn: async () => ({ raw: 123, normalized: 77, timestamp: "2026-01-01T00:00:00.000Z", source: "test" }),
    logger: console,
    timeoutMs: 1000,
  });

  assert.equal(out.status, "OK");
  assert.equal(out.normalized, 77);
  assert.equal(out.weight, 0.35);
  assert.equal(out.error, null);
});

test("runComponent wraps CONFIG_MISSING as MISSING", async () => {
  const err = new Error("missing key");
  err.code = "CONFIG_MISSING";

  const out = await runComponent({
    name: "credit",
    weight: 0.15,
    fetchFn: async () => {
      throw err;
    },
    normalizeFn: async () => ({ normalized: null }),
    logger: console,
    timeoutMs: 1000,
  });

  assert.equal(out.status, "MISSING");
  assert.equal(out.error.code, "CONFIG_MISSING");
});

test("runComponent wraps generic error as ERROR", async () => {
  const out = await runComponent({
    name: "dxy",
    weight: 0.15,
    fetchFn: async () => {
      throw new Error("boom");
    },
    normalizeFn: async () => ({ normalized: null }),
    logger: console,
    timeoutMs: 1000,
  });

  assert.equal(out.status, "ERROR");
  assert.equal(out.error.message, "boom");
});

