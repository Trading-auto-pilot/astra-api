// modules/store/exposureStore.js
"use strict";

const { getConfigInt } = require("../../../shared/loadSettings");

const EXPOSURE_KEY = "cm:exposure:snapshot";
const TTL_SEC      = getConfigInt("EXPOSURE_SNAPSHOT_TTL_SEC", 60);

/**
 * Get the cached exposure snapshot from Redis.
 * @param {object} bus - RedisBus instance
 * @returns {Promise<{ticker:object, sector:object, industry:object, area:object, computedAt:string, positionCount:number, orderCount:number}|null>}
 */
async function getExposureSnapshot(bus) {
  const raw = await bus.get(EXPOSURE_KEY);
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
}

/**
 * Save the exposure snapshot to Redis with a short TTL.
 * @param {{ ticker:object, sector:object, industry:object, area:object }} snapshot
 * @param {object} bus
 */
async function setExposureSnapshot(snapshot, bus) {
  await bus.set(EXPOSURE_KEY, JSON.stringify(snapshot), { EX: TTL_SEC });
}

/**
 * Invalidate the cached exposure snapshot (call on order events).
 * @param {object} bus
 */
async function invalidateExposureSnapshot(bus) {
  await bus.del(EXPOSURE_KEY);
}

module.exports = { getExposureSnapshot, setExposureSnapshot, invalidateExposureSnapshot };
