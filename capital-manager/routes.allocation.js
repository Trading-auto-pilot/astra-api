// routes.allocation.js
"use strict";

const { Router } = require("express");

/**
 * Allocation router factory.
 * @param {{ getService: function, logger: object }} deps
 * @returns {Router}
 */
function buildAllocationRouter({ getService, logger }) {
  const router = Router();

  /**
   * POST /allocation/quote
   * Compute how much capital can be invested for this request.
   */
  router.post("/quote", async (req, res) => {
    const { userId, symbol, market = "US", currency = "USD", side = "BUY", priceHint, strategyType, clientRequestId } = req.body || {};

    if (!userId || !symbol || !clientRequestId) {
      return res.status(400).json({
        ok: false,
        error: { code: "MISSING_PARAMS", message: "userId, symbol, clientRequestId are required" },
      });
    }

    logger.info(`[POST /allocation/quote] userId=${userId} symbol=${symbol} clientRequestId=${clientRequestId}`);

    try {
      const service = getService();
      const decision = await service.computeQuote({ userId, symbol, market, currency, side, priceHint: priceHint ?? null, strategyType, clientRequestId });

      if (!decision.ok) {
        logger.warning(
          `[POST /allocation/quote] REJECTED userId=${userId} symbol=${symbol} clientRequestId=${clientRequestId} | ${JSON.stringify(decision)}`
        );
        return res.status(422).json(decision);
      }

      logger.info(
        `[POST /allocation/quote] APPROVED userId=${userId} symbol=${symbol} maxInvestable=${decision.decision?.maxInvestable} limitedBy=${decision.decision?.limitedBy ?? "none"} clientRequestId=${clientRequestId} | ${JSON.stringify(decision.decision)}`
      );
      return res.json(decision);
    } catch (err) {
      logger.error(`[POST /allocation/quote] ${err?.message || String(err)}`);
      return res.status(500).json({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: err?.message || String(err) },
      });
    }
  });

  /**
   * POST /allocation/reserve
   * Create a reservation for a notional amount (idempotent by userId+clientRequestId).
   */
  router.post("/reserve", async (req, res) => {
    const { userId, symbol, market = "US", currency = "USD", amount, clientRequestId } = req.body || {};

    if (!userId || !symbol || amount == null || !clientRequestId) {
      return res.status(400).json({
        ok: false,
        error: { code: "MISSING_PARAMS", message: "userId, symbol, amount, clientRequestId are required" },
      });
    }

    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_AMOUNT", message: "amount must be a positive number" },
      });
    }

    logger.info(`[POST /allocation/reserve] userId=${userId} symbol=${symbol} amount=${amount} clientRequestId=${clientRequestId}`);

    try {
      const service = getService();
      const result = await service.createReservation({ userId, symbol, market, currency, amount, clientRequestId });

      const body = {
        ok: true,
        reservationId: result.reservationId,
        expiresAt: result.expiresAt,
        amount: result.amount,
        reused: result.reused,
      };
      logger.info(
        `[POST /allocation/reserve] userId=${userId} symbol=${symbol} reservationId=${result.reservationId} amount=${amount} reused=${result.reused} clientRequestId=${clientRequestId} | ${JSON.stringify(body)}`
      );
      return res.status(result.reused ? 200 : 201).json(body);
    } catch (err) {
      logger.error(`[POST /allocation/reserve] ${err?.message || String(err)}`);
      return res.status(500).json({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: err?.message || String(err) },
      });
    }
  });

  /**
   * POST /allocation/release
   * Release a reservation.
   */
  router.post("/release", async (req, res) => {
    const { reservationId, userId, reason } = req.body || {};

    if (!reservationId || !userId) {
      return res.status(400).json({
        ok: false,
        error: { code: "MISSING_PARAMS", message: "reservationId and userId are required" },
      });
    }

    logger.info(`[POST /allocation/release] reservationId=${reservationId} userId=${userId} reason=${reason}`);

    try {
      const service = getService();
      const released = await service.releaseReservation(reservationId, userId, reason);

      if (!released) {
        logger.warning(
          `[POST /allocation/release] NOT FOUND reservationId=${reservationId} userId=${userId} reason=${reason ?? "-"}`
        );
        return res.status(404).json({
          ok: false,
          error: { code: "NOT_FOUND", message: `Reservation ${reservationId} not found or already expired` },
        });
      }
      logger.info(
        `[POST /allocation/release] released reservationId=${reservationId} userId=${userId} reason=${reason ?? "-"} | {"ok":true}`
      );
      return res.json({ ok: true });
    } catch (err) {
      logger.error(`[POST /allocation/release] ${err?.message || String(err)}`);
      return res.status(500).json({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: err?.message || String(err) },
      });
    }
  });

  /**
   * GET /allocation/reservations?userId=1
   * List active reservations for a user.
   */
  router.get("/reservations", async (req, res) => {
    const userId = req.query.userId;

    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: { code: "MISSING_PARAMS", message: "userId query parameter is required" },
      });
    }

    try {
      const service = getService();
      const reservations = await service.listReservations(userId);
      return res.json({ ok: true, data: reservations });
    } catch (err) {
      logger.error(`[GET /allocation/reservations] ${err?.message || String(err)}`);
      return res.status(500).json({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: err?.message || String(err) },
      });
    }
  });

  /**
   * GET /allocation/config
   * Return current runtime allocation configuration.
   */
  router.get("/config", (req, res) => {
    try {
      const service = getService();
      return res.json({ ok: true, config: service.getAllocationConfig() });
    } catch (err) {
      logger.error(`[GET /allocation/config] ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: { code: "INTERNAL_ERROR", message: err?.message || String(err) } });
    }
  });

  /**
   * PUT /allocation/config
   * Update a single allocation config key at runtime (persisted in Redis).
   * Body: { key: string, value: number }
   */
  router.put("/config", async (req, res) => {
    const { key, value } = req.body || {};

    if (!key || value == null) {
      return res.status(400).json({
        ok: false,
        error: { code: "MISSING_PARAMS", message: "key and value are required" },
      });
    }

    if (typeof value !== "number") {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_VALUE", message: "value must be a number" },
      });
    }

    logger.info(`[PUT /allocation/config] key=${key} value=${value}`);

    try {
      const service = getService();
      await service.updateAllocationSetting(key, value);
      return res.json({ ok: true, key, value, config: service.getAllocationConfig() });
    } catch (err) {
      logger.error(`[PUT /allocation/config] ${err?.message || String(err)}`);
      const isValidation = err?.message?.startsWith("Unknown allocation");
      return res.status(isValidation ? 400 : 500).json({
        ok: false,
        error: { code: isValidation ? "INVALID_KEY" : "INTERNAL_ERROR", message: err?.message || String(err) },
      });
    }
  });

  /**
   * GET /allocation/limits
   * Return persisted derived cash limits (MAX_TICKER, MAX_SECTOR, MAX_INDUSTRY, MAX_AREA).
   */
  router.get("/limits", async (req, res) => {
    try {
      const service = getService();
      const data = await service.getDerivedLimits();
      return res.json({ ok: true, data });
    } catch (err) {
      logger.error(`[GET /allocation/limits] ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: { code: "INTERNAL_ERROR", message: err?.message || String(err) } });
    }
  });

  /**
   * PUT /allocation/limits
   * Compute and persist derived cash limits given residualCashToInvest.
   * Body: { residualCashToInvest: number }
   */
  router.put("/limits", async (req, res) => {
    const { residualCashToInvest, maxInvestment = null } = req.body || {};
    if (typeof residualCashToInvest !== "number" && maxInvestment == null) {
      return res.status(400).json({
        ok: false,
        error: { code: "MISSING_PARAMS", message: "residualCashToInvest (number) or maxInvestment (number) is required" },
      });
    }
    try {
      const service = getService();
      const data = await service.saveDerivedLimits(residualCashToInvest ?? 0, maxInvestment);
      return res.json({ ok: true, data });
    } catch (err) {
      logger.error(`[PUT /allocation/limits] ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: { code: "INTERNAL_ERROR", message: err?.message || String(err) } });
    }
  });

  /**
   * PUT /allocation/fundamentals
   * Cache symbol fundamentals (sector/industry/area) in Redis.
   * Body: { map: { [symbol]: { sector, industry, area, country } } }
   */
  router.put("/fundamentals", async (req, res) => {
    const { map } = req.body || {};

    if (!map || typeof map !== "object" || Array.isArray(map)) {
      return res.status(400).json({
        ok: false,
        error: { code: "MISSING_PARAMS", message: "map (object) is required" },
      });
    }

    try {
      const service = getService();
      const result = await service.saveFundamentals(map);
      return res.json({ ok: true, ...result });
    } catch (err) {
      logger.error(`[PUT /allocation/fundamentals] ${err?.message || String(err)}`);
      return res.status(500).json({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: err?.message || String(err) },
      });
    }
  });

  /**
   * GET /allocation/exposure
   * Return the cached exposure snapshot (sector/industry/area/ticker invested amounts).
   * Returns 404 if no snapshot is cached yet.
   */
  router.get("/exposure", async (req, res) => {
    try {
      const service  = getService();
      const snapshot = await service.getCachedExposure();
      if (!snapshot) {
        return res.status(404).json({
          ok: false,
          error: { code: "NOT_FOUND", message: "No exposure snapshot available — call POST /allocation/exposure/refresh first" },
        });
      }
      return res.json({ ok: true, data: snapshot });
    } catch (err) {
      logger.error(`[GET /allocation/exposure] ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: { code: "INTERNAL_ERROR", message: err?.message || String(err) } });
    }
  });

  /**
   * POST /allocation/exposure/refresh
   * Fetch live positions + open orders, compute sector/industry/area/ticker exposure,
   * and cache the result in Redis (TTL ~60s).
   */
  router.post("/exposure/refresh", async (req, res) => {
    try {
      const service  = getService();
      const snapshot = await service.computeAndCacheExposure();
      return res.json({ ok: true, data: snapshot });
    } catch (err) {
      logger.error(`[POST /allocation/exposure/refresh] ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: { code: "INTERNAL_ERROR", message: err?.message || String(err) } });
    }
  });

  return router;
}

module.exports = buildAllocationRouter;
