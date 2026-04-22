// modules/main.js
"use strict";

const axios = require("axios");
const BaseService = require("../../shared/BaseService");
const { getConfigInt, getConfigNumber, getConfigString } = require("../../shared/loadSettings");
const LiquidityScoreEngine = require("./engine/liquidityScoreEngine");
const { createLiquidityScoreRepository } = require("../repositories/liquidityScoreRepository");
const RecomputeTaskManager = require("./tasks/recomputeTaskManager");
const { runBackfill } = require("./backfill/liquidityBackfill");

/**
 * LiquidityManager - liquidity-manager microservice
 *
 * This service extends BaseService which provides:
 * - Redis Bus connection
 * - Logger with DB queuing
 * - Settings management
 * - Standard endpoints
 * - Metrics collection
 * - Graceful shutdown
 */
class LiquidityManager extends BaseService {
  constructor() {
    super({
      microservice: "liquidity-manager",
      moduleName: "main",
      moduleVersion: "1.0.0",
    });

    this.historyDays = getConfigInt("LIQUIDITY_HISTORY_DAYS", 365);
    this.providerMode = getConfigString("LIQUIDITY_PROVIDER_MODE", "live");
    this.redisLiquidityTtlSec = getConfigInt("LIQUIDITY_REDIS_TTL_SEC", 23 * 60 * 60 + 59 * 60);

    // EMA stabilization params
    this.emaAlpha             = getConfigNumber("LIQ_EMA_ALPHA", 0.2);
    this.emaMaxDailyChange    = getConfigNumber("LIQ_MAX_DAILY_SCORE_CHANGE", 8);
    this.emaDecayThreshold    = getConfigNumber("LIQ_DECAY_CONFIDENCE_THRESHOLD", 0.3);
    this.emaDecayRate         = getConfigNumber("LIQ_DECAY_RATE", 0.05);
    // Hysteresis thresholds (score_ema-based regime flip)
    this.hysteresisRiskOffEnter = getConfigNumber("LIQ_HYSTERESIS_RISK_OFF_ENTER", 28);
    this.hysteresisRiskOffExit  = getConfigNumber("LIQ_HYSTERESIS_RISK_OFF_EXIT", 32);
    this.hysteresisRiskOnEnter  = getConfigNumber("LIQ_HYSTERESIS_RISK_ON_ENTER", 62);
    this.hysteresisRiskOnExit   = getConfigNumber("LIQ_HYSTERESIS_RISK_ON_EXIT", 58);

    this.repository = createLiquidityScoreRepository({ logger: this.logger });
    this.engine = new LiquidityScoreEngine({
      logger: this.logger,
      mode: this.providerMode,
    });
    this.taskManager = new RecomputeTaskManager({
      maxTasks: getConfigInt("LIQUIDITY_MAX_TASKS", 500),
    });
  }

  /**
   * Custom initialization hook
   * Called after Redis connection and settings loading
   */
  async _onInit() {
    this.logger.info("[_onInit] Initializing Liquidity Score components...");
    await this.repository.init();
    await this._restoreFromRedis();
    this.logger.info("[_onInit] Internal scheduler disabled: use external scheduler via POST /liquidity-score/recompute");
  }

  async _restoreFromRedis() {
    if (!this.bus || typeof this.bus.get !== "function" || typeof this.bus.key !== "function") {
      return;
    }
    try {
      const latest = await this.repository.getLatest();
      if (latest) {
        this.logger.info("[_restoreFromRedis] local repository already has data, skipping Redis restore");
        return;
      }
      const redisKey = this.bus.key("liquidity-manager", "liquidity-score", "latest");
      const cached = await this.bus.get(redisKey);
      if (cached && cached.timestamp) {
        const { cacheMeta: _, ...snapshot } = cached;
        await this.repository.saveSnapshot(snapshot);
        this.logger.info(
          `[_restoreFromRedis] restored snapshot from Redis key=${redisKey} timestamp=${cached.timestamp} score=${cached.score}`
        );
      } else {
        this.logger.info("[_restoreFromRedis] no valid snapshot in Redis, starting fresh");
      }
    } catch (err) {
      this.logger.warning?.(
        `[_restoreFromRedis] failed: ${err?.message || String(err)}`
      );
    }
  }

  /**
   * Custom cleanup hook
   * Called during graceful shutdown, before Redis is closed
   */
  async _onShutdown() {
    this.logger.info("[_onShutdown] Liquidity manager shutdown complete.");
  }

  // =====================================================
  // SERVICE-SPECIFIC METHODS
  // =====================================================

  async getLiquidityScore() {
    const latest = await this.repository.getLatest();
    if (latest) {
      await this._cacheLiquiditySnapshot(latest, { source: "getLatest" });
    }
    return latest;
  }

  async recomputeLiquidityScore({ reason = "manual", onProgress, source = "scheduler" } = {}) {
    this.logger.info(`[recomputeLiquidityScore] start reason=${reason}`);
    const snapshot = await this.engine.computeScore({ onProgress });

    // Fetch previous snapshot for EMA seed before overwriting it
    const prev = await this.repository.getLatest();
    this._applyEmaStabilization(snapshot, prev);

    await this.repository.saveSnapshot(snapshot);
    await this.repository.prune({ historyDays: this.historyDays });
    await this._cacheLiquiditySnapshot(snapshot, { source: "recompute", reason });
    await this._persistDailyScore(snapshot, { source });
    this.logger.info(
      `[recomputeLiquidityScore] reason=${reason} score=${snapshot.score} score_ema=${snapshot.score_ema} ` +
      `riskRegime=${snapshot.riskRegime} riskRegimeSmoothed=${snapshot.riskRegimeSmoothed} confidence=${snapshot.confidence}`
    );
    return snapshot;
  }

  /**
   * Apply EMA smoothing, confidence-scaled alpha, decay toward neutral,
   * rate-limiting, and hysteresis regime resolution.
   * Mutates snapshot in-place, adding score_ema and riskRegimeSmoothed.
   */
  _applyEmaStabilization(snapshot, prev) {
    // Explicit null check: Number(null)=0 would be a valid finite number, so check first
    const prevEmaRaw = prev?.score_ema;
    const prevScoreRaw = prev?.score;
    const prevEma =
      prevEmaRaw != null && Number.isFinite(Number(prevEmaRaw)) ? Number(prevEmaRaw) :
      prevScoreRaw != null && Number.isFinite(Number(prevScoreRaw)) ? Number(prevScoreRaw) :
      null;
    const prevRegime = prev?.riskRegimeSmoothed ?? prev?.riskRegime ?? "NEUTRAL";
    const rawScore = snapshot.score;
    const confidence = snapshot.confidence ?? 0;

    // Seed on first run: no previous EMA available
    if (prevEma == null || rawScore == null) {
      snapshot.score_ema = rawScore;
      snapshot.riskRegimeSmoothed = snapshot.riskRegime;
      snapshot._ema = { alphaEffective: null, decayApplied: false, prevRegime, rateLimited: false };
      return;
    }

    let scoreEma;
    let alphaEffective = null;
    let decayApplied = false;

    if (confidence < this.emaDecayThreshold) {
      decayApplied = true;
      scoreEma = prevEma + this.emaDecayRate * (50 - prevEma);
      snapshot.notes = [
        ...(snapshot.notes || []),
        `ema decayed toward 50: confidence=${confidence} < threshold=${this.emaDecayThreshold}`,
      ];
    } else {
      alphaEffective = Math.min(1, this.emaAlpha * confidence);
      scoreEma = alphaEffective * rawScore + (1 - alphaEffective) * prevEma;
    }

    // Rate limiting: cap daily change
    let rateLIMITED = false;
    const delta = scoreEma - prevEma;
    if (Math.abs(delta) > this.emaMaxDailyChange) {
      rateLIMITED = true;
      scoreEma = prevEma + Math.sign(delta) * this.emaMaxDailyChange;
      snapshot.notes = [
        ...(snapshot.notes || []),
        `ema rate-limited: delta=${Math.round(delta * 100) / 100} capped to ±${this.emaMaxDailyChange}`,
      ];
    }

    snapshot.score_ema = Math.round(scoreEma * 100) / 100;
    if (rateLIMITED) snapshot.score_rate_limited = Math.round(scoreEma * 100) / 100;
    snapshot.riskRegimeSmoothed = this._resolveRiskRegimeHysteresis(snapshot.score_ema, prevRegime, confidence);
    snapshot._ema = { alphaEffective, decayApplied, prevRegime, rateLIMITED };
  }

  /**
   * Resolve regime with hysteresis band to prevent flip-flopping.
   * Uses score_ema + current regime to determine stickiness.
   */
  _resolveRiskRegimeHysteresis(scoreEma, prevRegime, confidence) {
    if (!Number.isFinite(scoreEma) || confidence < this.engine.minConfidenceForRegime) return "UNKNOWN";

    if (prevRegime === "RISK_OFF") {
      if (scoreEma > this.hysteresisRiskOffExit) {
        return scoreEma > this.hysteresisRiskOnEnter ? "RISK_ON" : "NEUTRAL";
      }
      return "RISK_OFF";
    }

    if (prevRegime === "RISK_ON") {
      if (scoreEma < this.hysteresisRiskOnExit) {
        return scoreEma < this.hysteresisRiskOffEnter ? "RISK_OFF" : "NEUTRAL";
      }
      return "RISK_ON";
    }

    // NEUTRAL or UNKNOWN — use enter thresholds
    if (scoreEma < this.hysteresisRiskOffEnter) return "RISK_OFF";
    if (scoreEma > this.hysteresisRiskOnEnter)  return "RISK_ON";
    return "NEUTRAL";
  }

  async _cacheLiquiditySnapshot(snapshot, meta = {}) {
    if (!snapshot || !this.bus || typeof this.bus.set !== "function" || typeof this.bus.key !== "function") {
      return;
    }

    const ttlSec = Math.max(60, Number(this.redisLiquidityTtlSec) || 60);
    const redisKey = this.bus.key("liquidity-manager", "liquidity-score", "latest");
    const payload = {
      ...snapshot,
      cacheMeta: {
        ttlSec,
        cachedAt: new Date().toISOString(),
        ...meta,
      },
    };

    try {
      await this.bus.set(redisKey, payload, { EX: ttlSec });
      this.logger.debug?.(
        `[_cacheLiquiditySnapshot] cached key=${redisKey} ttlSec=${ttlSec}`
      );
    } catch (err) {
      this.logger.warning?.(
        `[_cacheLiquiditySnapshot] redis set failed key=${redisKey}: ${err?.message || String(err)}`
      );
    }
  }

  /**
   * Persist the daily snapshot row to liquidity_daily_scores via datahub.
   * If the row already exists for today+source (duplicate key), logs a warning and skips.
   */
  async _persistDailyScore(snapshot, { source = "scheduler" } = {}) {
    const datahubUrl = getConfigString(["DATAHUB_URL", "DBMANAGER_URL"], "http://datahub:3000").replace(/\/+$/, "");
    const c = snapshot.components || {};
    const ema = snapshot._ema || {};

    const componentsBitmask =
      (c.vix?.status      === "OK" ? 1 : 0) |
      (c.spyTrend?.status === "OK" ? 2 : 0) |
      (c.dxy?.status      === "OK" ? 4 : 0) |
      (c.credit?.status   === "OK" ? 8 : 0);

    const now = new Date();
    const scoreDate = snapshot.timestamp
      ? new Date(snapshot.timestamp).toISOString().slice(0, 10)
      : now.toISOString().slice(0, 10);
    const calculatedAt = snapshot.timestamp || now.toISOString();

    const scoreEma = snapshot.score_ema ?? snapshot.score;
    const prevRegime = ema.prevRegime ?? null;
    const currentRegime = snapshot.riskRegimeSmoothed ?? snapshot.riskRegime ?? null;
    const regimeChanged = prevRegime != null && currentRegime != null && prevRegime !== currentRegime ? 1 : 0;

    const body = {
      score_date:           scoreDate,
      calculated_at:        calculatedAt,
      source,
      score_raw:            snapshot.score,
      score_ema:            scoreEma,
      score_rate_limited:   snapshot.score_rate_limited   ?? null,
      confidence:           snapshot.confidence,
      alpha_effective:      ema.alphaEffective             ?? null,
      decay_applied:        ema.decayApplied               ? 1 : 0,
      ema_staleness_days:   0,
      components_available: componentsBitmask,
      vix_value:            c.vix?.raw                    ?? null,
      vix_score:            c.vix?.normalized             ?? null,
      vix_weight_used:      c.vix?.weight                 ?? null,
      spy_return_1d:        c.spyTrend?.raw               ?? null,
      spy_sma50:            c.spyTrend?.details?.sma50    ?? null,
      spy_sma200:           c.spyTrend?.details?.sma200   ?? null,
      spy_score:            c.spyTrend?.normalized        ?? null,
      spy_weight_used:      c.spyTrend?.weight            ?? null,
      dxy_value:            c.dxy?.raw                    ?? null,
      dxy_score:            c.dxy?.normalized             ?? null,
      dxy_weight_used:      c.dxy?.weight                 ?? null,
      credit_spread_value:  c.credit?.raw                 ?? null,
      credit_score:         c.credit?.normalized          ?? null,
      credit_weight_used:   c.credit?.weight              ?? null,
      risk_regime:          currentRegime,
      previous_risk_regime: prevRegime,
      regime_changed:       regimeChanged,
      volatility_regime:    snapshot.volatilityRegime     ?? null,
      notes: Array.isArray(snapshot.notes) ? snapshot.notes.join("; ") : null,
    };

    try {
      await axios.post(`${datahubUrl}/api/table/liquidity_daily_scores`, body, { timeout: 8000 });
      this.logger.info(
        `[_persistDailyScore] saved score_date=${scoreDate} source=${source} score_raw=${snapshot.score} score_ema=${scoreEma}`
      );
    } catch (err) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.message || err?.response?.data?.error || err?.message || String(err);
      if (status === 409 || (status >= 400 && String(msg).toLowerCase().includes("duplicate"))) {
        this.logger.info(
          `[_persistDailyScore] duplicate row skipped score_date=${scoreDate} source=${source}`
        );
      } else {
        this.logger.info(
          `[_persistDailyScore] failed score_date=${scoreDate} status=${status ?? "?"}: ${msg}`
        );
      }
    }
  }

  async getLiquidityScoreHistory({ days = 30 } = {}) {
    return this.repository.getHistory({ days });
  }

  async getLiquidityProvidersStatus({ timeoutMs } = {}) {
    return this.engine.getProvidersStatus({ timeoutMs });
  }

  _buildTaskMessage(task, meta = {}) {
    return {
      type: "liquidityTaskUpdate",
      microservice: this._microservice,
      env: this.env,
      ts: new Date().toISOString(),
      task,
      ...meta,
    };
  }

  _publishTaskMessage(task, meta = {}) {
    if (!task) return;
    this.bus
      .publish(this.redisDataChannel, this._buildTaskMessage(task, meta))
      .catch((err) => {
        this.logger.warn(
          `[recomputeLiquidityTask] publish update failed taskId=${task?.taskId || "-"} err=${err?.message || String(err)}`
        );
      });
  }

  startRecomputeLiquidityTask({ reason = "manual", trigger = "api" } = {}) {
    const created = this.taskManager.createTask({ reason, trigger });
    if (!created.started) {
      this._publishTaskMessage(created.task, {
        event: "task.alreadyRunning",
        reason: "recompute already running",
      });
      return {
        ok: false,
        started: false,
        taskId: created.task?.taskId || null,
        status: created.task?.status || "RUNNING",
        message: "Recompute already running",
      };
    }

    const { task } = created;
    this.logger.info(
      `[recomputeLiquidityTask] started taskId=${task.taskId} reason=${reason} trigger=${trigger}`
    );
    this._publishTaskMessage(task, { event: "task.started" });

    setImmediate(async () => {
      try {
        const runningTask = this.taskManager.updateStep(task.taskId, "TASK.RUNNING", "Recompute started");
        this._publishTaskMessage(runningTask, { event: "task.progress" });
        const source = trigger === "scheduler" ? "scheduler" : trigger === "simulation" ? "simulation" : "manual";
        const snapshot = await this.recomputeLiquidityScore({
          reason,
          source,
          onProgress: (step, detail) => {
            const updated = this.taskManager.updateStep(task.taskId, step, detail);
            this._publishTaskMessage(updated, { event: "task.progress" });
          },
        });
        const completedTask = this.taskManager.completeTask(task.taskId, {
          timestamp: snapshot?.timestamp || null,
          score: snapshot?.score ?? null,
          riskRegime: snapshot?.riskRegime || null,
          volatilityRegime: snapshot?.volatilityRegime || null,
          confidence: snapshot?.confidence ?? null,
        });
        this._publishTaskMessage(completedTask, { event: "task.completed" });
        this.logger.info(`[recomputeLiquidityTask] completed taskId=${task.taskId}`);
      } catch (err) {
        const failedTask = this.taskManager.failTask(task.taskId, err);
        this._publishTaskMessage(failedTask, { event: "task.failed" });
        this.logger.error(
          `[recomputeLiquidityTask] failed taskId=${task.taskId} err=${err?.message || String(err)}`
        );
      }
    });

    return {
      ok: true,
      started: true,
      taskId: task.taskId,
      status: task.status,
      message: "Recompute started",
    };
  }

  getLiquidityTasks({ status, limit } = {}) {
    const running = this.taskManager.getRunningTasks();
    const items = this.taskManager.listTasks({ status, limit });
    return {
      ok: true,
      runningCount: running.length,
      runningTaskIds: running.map((task) => task.taskId),
      count: items.length,
      items,
    };
  }

  getLiquidityTaskById(taskId) {
    const task = this.taskManager.getTask(taskId);
    if (!task) return null;
    return { ok: true, task };
  }

  /**
   * Backfill liquidity scores for a historical date range.
   * Uses WARMUP_DAYS=250 prepended before fromDate so SMA(200) is stable.
   * Rows with source="backfill" are inserted; existing live/scheduler rows
   * (409 duplicate key) are skipped.
   *
   * @param {string} fromDate - ISO date "YYYY-MM-DD" (inclusive)
   * @param {string} toDate   - ISO date "YYYY-MM-DD" (inclusive)
   * @returns {Promise<{processed, inserted, skipped, errors, days}>}
   */
  async runBackfill({ fromDate, toDate }) {
    const datahubUrl = getConfigString(["DATAHUB_URL", "DBMANAGER_URL"], "http://datahub:3000").replace(/\/+$/, "");

    const config = {
      emaAlpha:               this.emaAlpha,
      emaMaxDailyChange:      this.emaMaxDailyChange,
      emaDecayThreshold:      this.emaDecayThreshold,
      emaDecayRate:           this.emaDecayRate,
      hysteresisRiskOffEnter: this.hysteresisRiskOffEnter,
      hysteresisRiskOffExit:  this.hysteresisRiskOffExit,
      hysteresisRiskOnEnter:  this.hysteresisRiskOnEnter,
      hysteresisRiskOnExit:   this.hysteresisRiskOnExit,
      minConfidenceForRegime: this.engine.minConfidenceForRegime,
    };

    this.logger.info(`[runBackfill] from=${fromDate} to=${toDate} datahubUrl=${datahubUrl}`);

    const result = await runBackfill({
      fromDate,
      toDate,
      config,
      logger: this.logger,
      onProgress: (day, stats) => {
        this.logger.trace(`[runBackfill] day=${day} inserted=${stats.inserted} skipped=${stats.skipped}`);
      },
    });

    this.logger.info(
      `[runBackfill] done from=${fromDate} to=${toDate} processed=${result.processed} ` +
      `inserted=${result.inserted} skipped=${result.skipped} errors=${result.errors}`
    );
    return result;
  }
}

module.exports = LiquidityManager;
