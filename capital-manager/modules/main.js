// modules/main.js
"use strict";

const path = require("path");
const BaseService = require("../../shared/BaseService");
const { publishEventsManifest } = require("../../shared/eventsManifestRegistry");
const { getConfigInt } = require("../../shared/loadSettings");
const { countryToArea } = require("./utils/geoUtils");
const { fetchAccountSummary, fetchOpenOrders, fetchPositions } = require("./adapters/ibkrBridge");
const { fetchLiquidityScore } = require("./adapters/liquidityManager");
const { computeAllocationDecision, computeReservedCashPct, getDefaultConfig } = require("./allocation/decisionEngine");
const { computeOpenOrdersReserved } = require("./allocation/exposureCalculator");
const { computeExposure, applyConcentrationLimits } = require("./allocation/concentrationLimits");
const { getFundamentalsMap, setFundamentalsMap } = require("./store/fundamentalsStore");
const { fetchFundamentalsMap: fetchFundamentalsFromDatahub } = require("./adapters/datahub");
const {
  createReservation,
  releaseReservation,
  listReservations,
} = require("./store/reservationsStore");
const { getExposureSnapshot, setExposureSnapshot } = require("./store/exposureStore");

// Keys managed in Redis settings
const ALLOCATION_CONFIG_KEYS = [
  "CONFIDENCE_THRESHOLD",
  "FALLBACK_RESERVED_CASH_PCT",
  "SCORE_RESERVED_MIN",
  "SCORE_RESERVED_MAX",
  "RISK_OFF_ADD_PCT",
  "VOL_ADD_MAX_PCT",
  "VOL_SCALE",
  "MIN_ORDER_NOTIONAL",
  "RESERVATION_TTL_SEC",
  "MAX_PERC_TICKER",
  "MAX_PERC_SECTOR",
  "MAX_PERC_INDUSTRY",
  "MAX_PERC_AREA",
];

// Derived limit keys (computed dollar amounts — not percentages)
const DERIVED_LIMITS_KEYS = ["MAX_TICKER", "MAX_SECTOR", "MAX_INDUSTRY", "MAX_AREA", "MAX_INVESTMENT"];

class CapitalManager extends BaseService {
  constructor() {
    super({
      microservice: "capital-manager",
      moduleName: "main",
      moduleVersion: "1.0.0",
    });
    // Runtime allocation config — populated in _onInit() from Redis + env defaults
    this._allocationConfig = null;
  }

  async _onInit() {
    this._allocationConfig = await this._loadAllocationConfig();
    this.logger.info(`[_onInit] capital-manager ready — allocationConfig loaded`);
    await publishEventsManifest({
      bus:              this.bus,
      logger:           this.logger,
      microserviceName: "capital-manager",
      serviceRootDir:   path.join(__dirname, ".."),
    }).catch((err) => this.logger.warning(`[_onInit] publishEventsManifest failed: ${err?.message || err}`));
  }

  /**
   * Publish a hook message to `${env}.hooks` channel (fail-soft).
   * @param {string} event   - e.g. "CAPITAL.ALLOCATED"
   * @param {object} payload - additional fields merged into the envelope
   */
  async _publishHook(event, payload) {
    try {
      const channel = `${this.env}.hooks`;
      await this.bus.publish(channel, {
        event,
        source: "capital-manager",
        ...payload,
        ts: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.warning(`[_publishHook] ${event}: ${err?.message || err}`);
    }
  }

  async _onShutdown() {
    this.logger.info("[_onShutdown] Shutting down capital-manager");
  }

  // ===========================================================
  // ALLOCATION CONFIG — Redis-backed runtime settings
  // ===========================================================

  /**
   * Load allocation config from Redis settings, falling back to env var defaults.
   * Numeric values stored in Redis are strings — we parse them here.
   */
  async _loadAllocationConfig() {
    const defaults = {
      ...getDefaultConfig(),
      RESERVATION_TTL_SEC: getConfigInt("RESERVATION_TTL_SEC", 180),
    };

    const config = { ...defaults };

    // Keys that must be in [0, 1] decimal range (not percentages).
    // If Redis returns a value > 1 for these, normalize by dividing by 100.
    const PCT_KEYS = new Set([
      "FALLBACK_RESERVED_CASH_PCT", "SCORE_RESERVED_MIN", "SCORE_RESERVED_MAX",
      "RISK_OFF_ADD_PCT", "VOL_ADD_MAX_PCT",
      "MAX_PERC_TICKER", "MAX_PERC_SECTOR", "MAX_PERC_INDUSTRY", "MAX_PERC_AREA",
    ]);

    try {
      const stored = await this.getAllSettings();
      for (const key of ALLOCATION_CONFIG_KEYS) {
        if (stored[key] != null && stored[key] !== "") {
          let v = parseFloat(stored[key]);
          if (PCT_KEYS.has(key) && v > 1) {
            this.logger.warning(`[_loadAllocationConfig] ${key}=${v} from Redis looks like a percentage — normalizing to ${v / 100}`);
            v = v / 100;
          }
          config[key] = v;
        }
      }
    } catch (err) {
      this.logger.warning(`[_loadAllocationConfig] Could not load settings from Redis: ${err?.message || err} — using defaults`);
    }

    return config;
  }

  /**
   * Return the current runtime allocation config (Redis overrides + env defaults).
   */
  getAllocationConfig() {
    return { ...this._allocationConfig };
  }

  /**
   * Update a single allocation config key at runtime.
   * Saves to Redis settings and updates in-memory config immediately.
   * @param {string} key
   * @param {number} value
   */
  async updateAllocationSetting(key, value) {
    if (!ALLOCATION_CONFIG_KEYS.includes(key)) {
      throw new Error(`Unknown allocation config key: ${key}. Allowed: ${ALLOCATION_CONFIG_KEYS.join(", ")}`);
    }
    if (typeof value !== "number" || !isFinite(value)) {
      throw new Error(`Value for ${key} must be a finite number`);
    }
    await this.persistSetting(key, String(value));
    this._allocationConfig[key] = value;
    this.logger.info(`[updateAllocationSetting] ${key}=${value} persisted to DB`);
  }

  // ===========================================================
  // PUBLIC METHODS (called by routes)
  // ===========================================================

  /**
   * Compute an allocation quote for a given request.
   * @returns {Promise<{ok:boolean, decision:object, error:object|null}>}
   */
  async computeQuote({ userId, symbol, market = "US", currency = "USD", side, priceHint, strategyType, clientRequestId }) {
    this.logger.info(`[computeQuote] userId=${userId} symbol=${symbol} market=${market} clientRequestId=${clientRequestId}`);

    // 1) Fetch account data and liquidity in parallel (fail-soft)
    const [accountResult, liquidityResult, openOrdersResult] = await Promise.allSettled([
      fetchAccountSummary(),
      fetchLiquidityScore(market),
      fetchOpenOrders(),
    ]);

    // 2) Resolve account summary — fail-soft with conservative fallback
    let cashAvailable = 0;
    if (accountResult.status === "fulfilled") {
      cashAvailable = accountResult.value.cashAvailable || 0;
    } else {
      this.logger.warning(`[computeQuote] ibkr-bridge unavailable: ${accountResult.reason?.message || accountResult.reason} — cashAvailable=0`);
    }

    // 3) Resolve liquidity score — fail-soft: use low-confidence fallback
    let liquidity = { score: 50, riskRegime: "NEUTRAL", volatility: 0, confidence: 0 };
    if (liquidityResult.status === "fulfilled") {
      liquidity = liquidityResult.value;
    } else {
      this.logger.warning(`[computeQuote] liquidity-manager unavailable: ${liquidityResult.reason?.message || liquidityResult.reason} — using fallback confidence=0`);
    }

    // 4) Compute open orders reserved notional
    let openOrdersReserved = 0;
    if (openOrdersResult.status === "fulfilled") {
      openOrdersReserved = computeOpenOrdersReserved(openOrdersResult.value, priceHint);
    } else {
      this.logger.warning(`[computeQuote] Could not fetch open orders: ${openOrdersResult.reason?.message || openOrdersResult.reason}`);
    }

    // 5) Sum active reservations for this user (cash deduction) + fetch full list for concentration
    let reservationsReserved = 0;
    let activeReservations = [];
    try {
      activeReservations = await listReservations(userId, this.bus);
      reservationsReserved = activeReservations.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    } catch (err) {
      this.logger.warning(`[computeQuote] Could not compute reservations: ${err?.message || err}`);
    }

    // 6) Fetch current positions for concentration checks (fail-soft)
    let positions = [];
    try {
      positions = await fetchPositions();
    } catch (err) {
      this.logger.warning(`[computeQuote] Could not fetch positions: ${err?.message || err}`);
    }

    // 7) Load derived dollar limits and fundamentals map from Redis
    const derivedLimits = await this.getDerivedLimits().catch(() => ({}));

    const positionSymbols = positions
      .map((p) => String(p.symbol ?? p.ticker ?? p.contractDesc ?? p.localSymbol ?? "").toUpperCase())
      .filter(Boolean);
    const reservationSymbols = activeReservations.map((r) => String(r.symbol ?? "").toUpperCase()).filter(Boolean);
    const allSymbols = [...new Set([symbol.toUpperCase(), ...positionSymbols, ...reservationSymbols])];
    const fundamentalsMap = await getFundamentalsMap(allSymbols, this.bus).catch(() => ({}));

    // 7b) Fetch from datahub any symbols not found in Redis, then cache them
    const missingSymbols = allSymbols.filter((s) => !fundamentalsMap[s]);
    if (missingSymbols.length > 0) {
      try {
        const fetched = await fetchFundamentalsFromDatahub(missingSymbols);
        if (Object.keys(fetched).length > 0) {
          // Cache in Redis for next time
          await setFundamentalsMap(fetched, this.bus).catch(() => {});
          // Merge into local map
          for (const [sym, data] of Object.entries(fetched)) {
            fundamentalsMap[sym] = data;
          }
          this.logger.info(`[computeQuote] Fetched fundamentals from datahub for: ${Object.keys(fetched).join(", ")}`);
        }
        const stillMissing = missingSymbols.filter((s) => !fundamentalsMap[s]);
        if (stillMissing.length > 0) {
          this.logger.warning(`[computeQuote] No fundamentals found for: ${stillMissing.join(", ")} — concentration checks skipped for those symbols`);
        }
      } catch (err) {
        this.logger.warning(`[computeQuote] Could not fetch fundamentals from datahub: ${err?.message || err}`);
      }
    }

    // 8) Load exposure snapshot from Redis (same data served by GET /allocation/exposure).
    //    On cache miss, run computeAndCacheExposure() so the snapshot is built with the
    //    same logic used by POST /allocation/exposure/refresh (correct IBKR field names,
    //    datahub fallback, consistent area keys).
    let exposure;
    const cachedExposure = await getExposureSnapshot(this.bus).catch(() => null);
    if (cachedExposure) {
      exposure = cachedExposure;
      this.logger.info(`[computeQuote] Using cached exposure snapshot (computedAt=${cachedExposure.computedAt})`);
    } else {
      this.logger.info(`[computeQuote] No cached exposure — computing fresh snapshot`);
      exposure = await this.computeAndCacheExposure().catch((err) => {
        this.logger.warning(`[computeQuote] computeAndCacheExposure failed: ${err?.message || err} — exposure will be empty`);
        return { ticker: {}, sector: {}, industry: {}, area: {} };
      });
    }

    // 8b) Overlay active reservations onto exposure so concentration limits see reserved amounts.
    //     A reservation for IBIT $2450 counts as $2450 already "invested" in IBIT/sector/industry/area.
    if (activeReservations.length > 0) {
      // Work on a shallow copy of each bucket so we don't mutate the cached snapshot
      exposure = {
        ...exposure,
        ticker:   { ...exposure.ticker },
        sector:   { ...exposure.sector },
        industry: { ...exposure.industry },
        area:     { ...exposure.area },
      };
      for (const res of activeReservations) {
        const sym = String(res.symbol ?? "").toUpperCase();
        if (!sym) continue;
        const amt = Number(res.amount) || 0;
        if (amt <= 0) continue;

        exposure.ticker[sym] = (exposure.ticker[sym] ?? 0) + amt;

        const fund = fundamentalsMap[sym] ?? {};
        const sec = String(fund.sector   ?? "").trim();
        const ind = String(fund.industry ?? "").trim();
        const ar  = String(fund.area || (fund.country ? countryToArea(fund.country) : null) || "").trim();

        if (sec) exposure.sector[sec]     = (exposure.sector[sec]   ?? 0) + amt;
        if (ind) exposure.industry[ind]   = (exposure.industry[ind] ?? 0) + amt;
        if (ar)  exposure.area[ar]        = (exposure.area[ar]      ?? 0) + amt;
      }
      this.logger.info(`[computeQuote] Reservation overlay applied for ${activeReservations.length} active reservation(s)`);
    }

    // 9) Compute cash-based allocation decision
    const allocationResult = computeAllocationDecision({
      cashAvailable,
      openOrdersReserved,
      reservationsReserved,
      liquidity,
      symbol,
      market,
      config: this._allocationConfig,
      logger: this.logger,
    });

    if (!allocationResult.ok) {
      await this._publishHook("CAPITAL.QUOTE_REJECTED", {
        userId, symbol, market, clientRequestId,
        reason:  allocationResult.error?.code,
        message: allocationResult.error?.message,
      });
      return allocationResult;
    }

    // 10) Apply concentration limits
    const symbolFundamentals = fundamentalsMap[symbol.toUpperCase()] ?? null;
    const { maxInvestable, concentrationReasons, limitedBy } = applyConcentrationLimits({
      maxInvestable: allocationResult.decision.maxInvestable,
      symbol,
      fundamentals: symbolFundamentals,
      exposure,
      limits: derivedLimits,
    });

    allocationResult.decision.maxInvestable        = maxInvestable;
    allocationResult.decision.concentrationReasons = concentrationReasons;
    allocationResult.decision.limitedBy            = limitedBy;

    // 11) Attach ticker classification + concentration detail (limits, invested, residual)
    const sym  = symbol.toUpperCase();
    const fund = symbolFundamentals ?? {};
    const sec  = String(fund.sector   ?? "").trim();
    const ind  = String(fund.industry ?? "").trim();
    const ar   = String(fund.area || (fund.country ? countryToArea(fund.country) : null) || "").trim();

    allocationResult.decision.tickerInfo = {
      sector:   sec  || null,
      industry: ind  || null,
      area:     ar   || null,
    };

    allocationResult.decision.concentrationDetail = {
      ticker: {
        limit:    derivedLimits.MAX_TICKER ?? null,
        invested: exposure.ticker[sym] ?? 0,
        residual: derivedLimits.MAX_TICKER != null
          ? Math.max(0, derivedLimits.MAX_TICKER - (exposure.ticker[sym] ?? 0))
          : null,
      },
      sector: {
        name:     sec  || null,
        limit:    derivedLimits.MAX_SECTOR ?? null,
        invested: sec ? (exposure.sector[sec]   ?? 0) : 0,
        residual: derivedLimits.MAX_SECTOR != null && sec
          ? Math.max(0, derivedLimits.MAX_SECTOR - (exposure.sector[sec] ?? 0))
          : null,
      },
      industry: {
        name:     ind  || null,
        limit:    derivedLimits.MAX_INDUSTRY ?? null,
        invested: ind ? (exposure.industry[ind] ?? 0) : 0,
        residual: derivedLimits.MAX_INDUSTRY != null && ind
          ? Math.max(0, derivedLimits.MAX_INDUSTRY - (exposure.industry[ind] ?? 0))
          : null,
      },
      area: {
        name:     ar   || null,
        limit:    derivedLimits.MAX_AREA ?? null,
        invested: ar  ? (exposure.area[ar]       ?? 0) : 0,
        residual: derivedLimits.MAX_AREA != null && ar
          ? Math.max(0, derivedLimits.MAX_AREA - (exposure.area[ar] ?? 0))
          : null,
      },
    };

    // Build unified reasoning: cash constraints first, then concentration checks
    const d = allocationResult.decision;
    allocationResult.decision.reasoning = [
      // Cash reservation
      ...d.reasons,
      // Cash availability breakdown
      `cashAvailable=${d.constraints.cashAvailable.toFixed(2)} reservedCash=${d.reservedCash.toFixed(2)} openOrders=${d.constraints.openOrdersReserved.toFixed(2)} reservations=${d.constraints.reservationsReserved.toFixed(2)} → cashMaxInvestable=${(d.constraints.cashAvailable - d.reservedCash - d.constraints.openOrdersReserved - d.constraints.reservationsReserved).toFixed(2)}`,
      // Concentration checks
      ...concentrationReasons,
      // Final result
      `→ maxInvestable=${maxInvestable.toFixed(2)}${limitedBy ? ` (limited by ${limitedBy})` : ""}`,
    ];

    const MIN_ORDER_NOTIONAL = this._allocationConfig?.MIN_ORDER_NOTIONAL ?? 50;
    if (maxInvestable < MIN_ORDER_NOTIONAL) {
      await this._publishHook("CAPITAL.QUOTE_REJECTED", {
        userId, symbol, market, clientRequestId,
        reason:  "CONCENTRATION_LIMIT",
        message: `maxInvestable ${maxInvestable} limited by ${limitedBy || "concentration"} (below MIN_ORDER_NOTIONAL ${MIN_ORDER_NOTIONAL})`,
      });
      return {
        ok: false,
        decision: allocationResult.decision,
        error: {
          code:    "CONCENTRATION_LIMIT",
          message: `maxInvestable ${maxInvestable} limited by ${limitedBy || "concentration"} (below MIN_ORDER_NOTIONAL ${MIN_ORDER_NOTIONAL})`,
          details: { maxInvestable, limitedBy, minOrderNotional: MIN_ORDER_NOTIONAL },
        },
      };
    }

    await this._publishHook("CAPITAL.ALLOCATED", {
      userId, symbol, market, clientRequestId,
      maxInvestable,
      limitedBy: limitedBy ?? null,
    });
    return allocationResult;
  }

  /**
   * Compute exposure across ticker/sector/industry/area from live positions + open BUY orders,
   * then cache the snapshot in Redis (TTL controlled by EXPOSURE_SNAPSHOT_TTL_SEC env var, default 60s).
   * @returns {Promise<object>} The saved snapshot
   */
  async computeAndCacheExposure() {
    const [positionsResult, openOrdersResult] = await Promise.allSettled([
      fetchPositions(),
      fetchOpenOrders(),
    ]);

    const positions  = positionsResult.status  === "fulfilled" ? positionsResult.value  : [];
    const openOrders = openOrdersResult.status === "fulfilled" ? openOrdersResult.value : [];

    if (positionsResult.status === "rejected") {
      this.logger.warning(`[computeAndCacheExposure] Could not fetch positions: ${positionsResult.reason?.message || positionsResult.reason}`);
    }
    if (openOrdersResult.status === "rejected") {
      this.logger.warning(`[computeAndCacheExposure] Could not fetch open orders: ${openOrdersResult.reason?.message || openOrdersResult.reason}`);
    }

    // Collect all symbols from positions + active BUY orders.
    // Use multi-field fallback to handle both normalized and raw IBKR data.
    const posSymbols = positions
      .map((p) => String(p.symbol ?? p.ticker ?? p.contractDesc ?? p.localSymbol ?? "").toUpperCase())
      .filter(Boolean);
    const ordSymbols = openOrders
      .filter((o) => String(o?.action ?? o?.side ?? "").toUpperCase() === "BUY")
      .map((o) => String(o.symbol ?? o.ticker ?? "").toUpperCase())
      .filter(Boolean);
    const allSymbols = [...new Set([...posSymbols, ...ordSymbols])];

    // Load fundamentals from Redis
    const fundamentalsMap = await getFundamentalsMap(allSymbols, this.bus).catch(() => ({}));

    // Datahub fallback for missing symbols
    const missingSymbols = allSymbols.filter((s) => !fundamentalsMap[s]);
    if (missingSymbols.length > 0) {
      try {
        const fetched = await fetchFundamentalsFromDatahub(missingSymbols);
        if (Object.keys(fetched).length > 0) {
          await setFundamentalsMap(fetched, this.bus).catch(() => {});
          for (const [sym, data] of Object.entries(fetched)) {
            fundamentalsMap[sym] = data;
          }
        }
      } catch (err) {
        this.logger.warning(`[computeAndCacheExposure] Could not fetch fundamentals from datahub: ${err?.message || err}`);
      }
    }

    const exposure = computeExposure(positions, fundamentalsMap, openOrders);
    const snapshot = {
      ...exposure,
      computedAt:    new Date().toISOString(),
      positionCount: positions.length,
      orderCount:    openOrders.length,
    };

    await setExposureSnapshot(snapshot, this.bus);
    this.logger.info(
      `[computeAndCacheExposure] Snapshot saved — positions=${positions.length} orders=${openOrders.length} sectors=${Object.keys(exposure.sector).length}`
    );
    return snapshot;
  }

  /**
   * Return the cached exposure snapshot from Redis, or null if expired/missing.
   * @returns {Promise<object|null>}
   */
  async getCachedExposure() {
    return getExposureSnapshot(this.bus);
  }

  /**
   * Cache symbol fundamentals (sector/industry/area) in Redis.
   * Called by frontend after loading position/order data.
   * @param {Record<string, {sector?:string, industry?:string, area?:string, country?:string}>} map
   * @returns {Promise<{saved:number}>}
   */
  async saveFundamentals(map) {
    const entries = Object.entries(map || {}).filter(([sym, data]) => sym && data);
    if (!entries.length) return { saved: 0 };
    await setFundamentalsMap(Object.fromEntries(entries), this.bus);
    this.logger.info(`[saveFundamentals] Cached ${entries.length} symbol fundamentals in Redis`);
    return { saved: entries.length };
  }

  /**
   * Create or retrieve an existing reservation (idempotent).
   */
  async createReservation({ userId, symbol, market, currency, amount, clientRequestId }) {
    return createReservation(
      { userId, symbol, market, currency, amount, clientRequestId, ttlSec: this._allocationConfig?.RESERVATION_TTL_SEC },
      this.bus
    );
  }

  /**
   * Release a reservation.
   * @returns {Promise<boolean>}
   */
  async releaseReservation(reservationId, userId, reason) {
    this.logger.info(`[releaseReservation] reservationId=${reservationId} userId=${userId} reason=${reason || "-"}`);
    return releaseReservation(reservationId, userId, this.bus);
  }

  /**
   * List active reservations for a user.
   */
  async listReservations(userId) {
    return listReservations(userId, this.bus);
  }

  /**
   * Compute and persist derived cash limits to Redis.
   * MAX_TICKER = MAX_PERC_TICKER * residualCashToInvest, etc.
   * @param {number} residualCashToInvest
   * @returns {Promise<{MAX_TICKER:number, MAX_SECTOR:number, MAX_INDUSTRY:number, MAX_AREA:number}>}
   */
  async saveDerivedLimits(residualCashToInvest, maxInvestment = null) {
    const config = this._allocationConfig || {};
    // Concentration limits are percentages of MAX_INVESTMENT (total portfolio size);
    // fall back to residualCashToInvest only if maxInvestment is not available.
    const base = (maxInvestment != null && Number.isFinite(maxInvestment) && maxInvestment > 0)
      ? maxInvestment
      : Math.max(0, Number(residualCashToInvest) || 0);
    const limits = {
      MAX_TICKER:   Math.round((config.MAX_PERC_TICKER   ?? 0) * base * 100) / 100,
      MAX_SECTOR:   Math.round((config.MAX_PERC_SECTOR   ?? 0) * base * 100) / 100,
      MAX_INDUSTRY: Math.round((config.MAX_PERC_INDUSTRY ?? 0) * base * 100) / 100,
      MAX_AREA:     Math.round((config.MAX_PERC_AREA     ?? 0) * base * 100) / 100,
    };
    for (const [key, value] of Object.entries(limits)) {
      await this.persistSetting(key, String(value));
    }
    if (maxInvestment != null && Number.isFinite(maxInvestment) && maxInvestment > 0) {
      await this.persistSetting("MAX_INVESTMENT", String(maxInvestment));
      limits.MAX_INVESTMENT = maxInvestment;
    }
    this.logger.info(`[saveDerivedLimits] residual=${residualCashToInvest} maxInv=${maxInvestment} → ${JSON.stringify(limits)}`);
    return limits;
  }

  /**
   * Return persisted derived cash limits, augmented with a dynamically computed cashToSave.
   * cashToSave = MAX_INVESTMENT * reservedCashPct(latestLiquidityScore)
   * — no Redis write required; computed on every GET from live data.
   * @returns {Promise<{MAX_TICKER:number|null, MAX_SECTOR:number|null, MAX_INDUSTRY:number|null, MAX_AREA:number|null, MAX_INVESTMENT:number|null, maxInvestment:number|null, cashToSave:number|null}>}
   */
  async getDerivedLimits() {
    const stored = await this.getAllSettings();
    const result = {};
    for (const key of DERIVED_LIMITS_KEYS) {
      const v = parseFloat(stored[key]);
      result[key] = Number.isFinite(v) ? v : null;
    }
    // camelCase aliases for frontend compatibility
    result.maxInvestment = result.MAX_INVESTMENT;

    // Compute cashToSave dynamically from live liquidity score — no frontend write needed.
    const maxInv = result.MAX_INVESTMENT;
    if (Number.isFinite(maxInv) && maxInv > 0) {
      try {
        const liquidity = await fetchLiquidityScore("US");
        const config = this._allocationConfig || {};
        const { reservedCashPct } = computeReservedCashPct(liquidity, config);
        result.cashToSave = Math.round(maxInv * reservedCashPct * 100) / 100;
      } catch (err) {
        this.logger.warning(`[getDerivedLimits] could not fetch liquidity score for cashToSave: ${err?.message || err}`);
        result.cashToSave = null;
      }
    } else {
      result.cashToSave = null;
    }

    return result;
  }
}

module.exports = CapitalManager;
