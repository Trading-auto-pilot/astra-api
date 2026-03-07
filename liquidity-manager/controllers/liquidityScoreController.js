"use strict";

function toDays(raw, fallback = 30) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), 3650);
}

function createLiquidityScoreController({ getService, logger }) {
  return {
    getLatestScore: async (_req, res) => {
      try {
        const service = getService();
        const latest = await service.getLiquidityScore();
        if (!latest) {
          return res.status(404).json({
            ok: false,
            error: "No liquidity score available yet",
          });
        }
        return res.json(latest);
      } catch (err) {
        logger?.error?.(`[GET /liquidity-score] ${err?.message || String(err)}`);
        return res.status(500).json({ ok: false, error: "Unable to read liquidity score" });
      }
    },

    recomputeScore: async (_req, res) => {
      try {
        const service = getService();
        const result = service.startRecomputeLiquidityTask({ reason: "manual", trigger: "api" });
        return res.status(202).json(result);
      } catch (err) {
        logger?.error?.(`[POST /liquidity-score/recompute] ${err?.message || String(err)}`);
        return res.status(500).json({ ok: false, error: "Unable to recompute liquidity score" });
      }
    },

    getScoreHistory: async (req, res) => {
      try {
        const service = getService();
        const days = toDays(req.query?.days, 30);
        const items = await service.getLiquidityScoreHistory({ days });
        return res.json({
          ok: true,
          days,
          count: items.length,
          items,
        });
      } catch (err) {
        logger?.error?.(`[GET /liquidity-score/history] ${err?.message || String(err)}`);
        return res.status(500).json({ ok: false, error: "Unable to read liquidity score history" });
      }
    },

    getTasks: async (req, res) => {
      try {
        const service = getService();
        const status = typeof req.query?.status === "string" ? req.query.status : undefined;
        const limit = req.query?.limit;
        const out = service.getLiquidityTasks({ status, limit });
        return res.json(out);
      } catch (err) {
        logger?.error?.(`[GET /liquidity-score/tasks] ${err?.message || String(err)}`);
        return res.status(500).json({ ok: false, error: "Unable to read liquidity tasks" });
      }
    },

    getTaskById: async (req, res) => {
      try {
        const service = getService();
        const taskId = String(req.params?.taskId || "");
        const out = service.getLiquidityTaskById(taskId);
        if (!out) {
          return res.status(404).json({ ok: false, error: "Task not found" });
        }
        return res.json(out);
      } catch (err) {
        logger?.error?.(`[GET /liquidity-score/tasks/:taskId] ${err?.message || String(err)}`);
        return res.status(500).json({ ok: false, error: "Unable to read liquidity task detail" });
      }
    },

    getProvidersStatus: async (req, res) => {
      try {
        const service = getService();
        const timeoutMs = req.query?.timeoutMs;
        const out = await service.getLiquidityProvidersStatus({ timeoutMs });
        return res.json(out);
      } catch (err) {
        logger?.error?.(`[GET /liquidity-score/providers/status] ${err?.message || String(err)}`);
        return res.status(500).json({ ok: false, error: "Unable to read providers status" });
      }
    },
  };
}

module.exports = {
  createLiquidityScoreController,
};

