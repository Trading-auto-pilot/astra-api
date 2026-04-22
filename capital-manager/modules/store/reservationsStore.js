// modules/store/reservationsStore.js
"use strict";

const { generateReservationId } = require("../utils/hash");
const simClock = require("../../../shared/simClock");
const { getConfigInt } = require("../../../shared/loadSettings");

const DEFAULT_RESERVATION_TTL_SEC = getConfigInt("RESERVATION_TTL_SEC", 180);

// Redis key helpers
const keyReservation = (userId, reservationId) =>
  `capital:reservations:${userId}:${reservationId}`;

const keyIndex = (userId, clientRequestId) =>
  `capital:reservationIndex:${userId}:${clientRequestId}`;

/**
 * Create or retrieve an existing reservation (idempotent by userId + clientRequestId).
 *
 * @param {object} params - { userId, symbol, market, currency, amount, clientRequestId }
 * @param {object} bus    - RedisBus instance from BaseService (this.bus)
 * @returns {Promise<{reservationId, amount, symbol, market, expiresAt, reused}>}
 */
async function createReservation({ userId, symbol, market, currency, amount, clientRequestId, ttlSec }, bus) {
  const RESERVATION_TTL_SEC = ttlSec != null ? ttlSec : DEFAULT_RESERVATION_TTL_SEC;
  const indexKey = keyIndex(userId, clientRequestId);

  // Check for existing reservation (idempotency)
  const existingId = await bus.get(indexKey);
  if (existingId) {
    const raw = await bus.get(keyReservation(userId, existingId));
    if (raw) {
      const existing = typeof raw === "string" ? JSON.parse(raw) : raw;
      return { ...existing, reservationId: existingId, reused: true };
    }
    // Index points to expired reservation — fall through to create new
  }

  const reservationId = generateReservationId();
  const expiresAt = new Date(simClock.now() + RESERVATION_TTL_SEC * 1000).toISOString();
  const reservation = {
    reservationId, userId, symbol, market, currency,
    amount, clientRequestId, expiresAt,
  };

  const serialized = JSON.stringify(reservation);
  const resKey = keyReservation(userId, reservationId);

  // Atomic idempotency gate: first writer for (userId, clientRequestId) wins.
  const redisClient = bus?.pub;
  if (redisClient?.isOpen) {
    const acquired = await redisClient.set(indexKey, reservationId, { NX: true, EX: RESERVATION_TTL_SEC });

    if (!acquired) {
      const winnerId = await bus.get(indexKey);
      if (winnerId) {
        const winnerRaw = await bus.get(keyReservation(userId, winnerId));
        if (winnerRaw) {
          const existing = typeof winnerRaw === "string" ? JSON.parse(winnerRaw) : winnerRaw;
          return { ...existing, reservationId: winnerId, reused: true };
        }

        // Stale index (winner crashed before persisting reservation): clear and continue.
        await bus.del(indexKey);
      }

      // Final fallback check to preserve idempotency under races.
      const retryId = await bus.get(indexKey);
      if (retryId) {
        const retryRaw = await bus.get(keyReservation(userId, retryId));
        if (retryRaw) {
          const existing = typeof retryRaw === "string" ? JSON.parse(retryRaw) : retryRaw;
          return { ...existing, reservationId: retryId, reused: true };
        }
      }
    }
  }

  await bus.set(resKey, serialized, { EX: RESERVATION_TTL_SEC });
  await bus.set(indexKey, reservationId, { EX: RESERVATION_TTL_SEC });

  return { ...reservation, reused: false };
}

/**
 * Release (delete) a reservation by ID.
 * @param {string} reservationId
 * @param {string|number} userId
 * @param {object} bus - RedisBus instance
 * @returns {Promise<boolean>} true if found and deleted
 */
async function releaseReservation(reservationId, userId, bus) {
  const resKey = keyReservation(userId, reservationId);
  const raw = await bus.get(resKey);
  if (!raw) return false;

  const reservation = typeof raw === "string" ? JSON.parse(raw) : raw;
  await bus.del(resKey);

  if (reservation.clientRequestId) {
    await bus.del(keyIndex(userId, reservation.clientRequestId));
  }
  return true;
}

/**
 * Get all active reservations for a user.
 * Uses node-redis v4 scanIterator via bus.pub.
 * @param {string|number} userId
 * @param {object} bus - RedisBus instance
 * @returns {Promise<Array>}
 */
async function listReservations(userId, bus) {
  const pattern = `capital:reservations:${userId}:*`;
  const keys = await scanKeys(bus, pattern);
  if (!keys.length) return [];

  const results = await Promise.all(keys.map((k) => bus.get(k)));
  return results
    .filter(Boolean)
    .map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw));
}

/**
 * Get sum of reserved amounts for a user (active reservations).
 * @param {string|number} userId
 * @param {object} bus - RedisBus instance
 * @returns {Promise<number>}
 */
async function getTotalReservedAmount(userId, bus) {
  const reservations = await listReservations(userId, bus);
  return reservations.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
}

/**
 * Scan Redis for keys matching a pattern.
 * Uses node-redis v4 scanIterator (bus.pub) when available,
 * falls back to manual cursor scan otherwise.
 * @param {object} bus - RedisBus instance
 * @param {string} pattern
 * @returns {Promise<string[]>}
 */
async function scanKeys(bus, pattern) {
  const redisClient = bus?.pub;
  if (!redisClient) return [];

  const keys = [];

  // node-redis v4 supports scanIterator
  if (typeof redisClient.scanIterator === "function") {
    for await (const key of redisClient.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      keys.push(key);
    }
    return keys;
  }

  // Fallback: manual cursor-based scan
  let cursor = "0";
  do {
    const result = await redisClient.scan(cursor, { MATCH: pattern, COUNT: 100 });
    cursor = String(result.cursor);
    keys.push(...result.keys);
  } while (cursor !== "0");

  return keys;
}

module.exports = {
  createReservation,
  releaseReservation,
  listReservations,
  getTotalReservedAmount,
};
