// modules/main.js
"use strict";

const BaseService = require("../../shared/BaseService");
const LiquidityScoreEngine = require("./engine/liquidityScoreEngine");
const { createLiquidityScoreRepository } = require("../repositories/liquidityScoreRepository");
const RecomputeTaskManager = require("./tasks/recomputeTaskManager");

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

    this.historyDays = Number(process.env.LIQUIDITY_HISTORY_DAYS) || 365;
    this.providerMode = process.env.LIQUIDITY_PROVIDER_MODE || "live";
    this.redisLiquidityTtlSec = Number(process.env.LIQUIDITY_REDIS_TTL_SEC) || (23 * 60 * 60 + 59 * 60);

    this.repository = createLiquidityScoreRepository({ logger: this.logger });
    this.engine = new LiquidityScoreEngine({
      logger: this.logger,
      mode: this.providerMode,
    });
    this.taskManager = new RecomputeTaskManager({
      maxTasks: Number(process.env.LIQUIDITY_MAX_TASKS) || 500,
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

  async recomputeLiquidityScore({ reason = "manual", onProgress } = {}) {
    this.logger.info(`[recomputeLiquidityScore] start reason=${reason}`);
    const snapshot = await this.engine.computeScore({ onProgress });
    await this.repository.saveSnapshot(snapshot);
    await this.repository.prune({ historyDays: this.historyDays });
    await this._cacheLiquiditySnapshot(snapshot, { source: "recompute", reason });
    this.logger.info(
      `[recomputeLiquidityScore] reason=${reason} score=${snapshot.score} riskRegime=${snapshot.riskRegime} confidence=${snapshot.confidence}`
    );
    return snapshot;
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
        const snapshot = await this.recomputeLiquidityScore({
          reason,
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
}

module.exports = LiquidityManager;
