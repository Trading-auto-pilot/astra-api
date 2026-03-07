"use strict";

const { traefikFetch } = require("./_http");

module.exports = {
  name: "liquidity_snapshot",
  description:
    "Reads liquidity-manager status snapshot: latest liquidity score, providers health, running tasks, and optional history window.",

  inputSchema: {
    include_history_days: {
      type: "number",
      description: "Optional history days to include (1-365, e.g. 30).",
      required: false,
    },
    include_tasks: {
      type: "boolean",
      description: "If true, includes current liquidity recompute tasks (default: true).",
      required: false,
    },
    providers_timeout_ms: {
      type: "number",
      description: "Optional timeout override for providers status endpoint.",
      required: false,
    },
  },

  validate(input) {
    if (
      input?.include_history_days != null &&
      (typeof input.include_history_days !== "number" ||
        input.include_history_days < 1 ||
        input.include_history_days > 365)
    ) {
      return "include_history_days must be a number between 1 and 365";
    }
    if (
      input?.providers_timeout_ms != null &&
      (typeof input.providers_timeout_ms !== "number" || input.providers_timeout_ms < 100)
    ) {
      return "providers_timeout_ms must be a number >= 100";
    }
    return null;
  },

  async handler(ctx, input) {
    const { logger } = ctx;
    const includeTasks = input?.include_tasks !== false;
    const includeHistoryDays =
      input?.include_history_days != null ? Math.floor(Number(input.include_history_days)) : null;
    const providersTimeoutMs =
      input?.providers_timeout_ms != null ? Math.floor(Number(input.providers_timeout_ms)) : null;

    try {
      const providersPath = providersTimeoutMs
        ? `/liquidity-manager/liquidity-score/providers/status?timeoutMs=${encodeURIComponent(
            String(providersTimeoutMs)
          )}`
        : "/liquidity-manager/liquidity-score/providers/status";

      const requests = [
        traefikFetch("/liquidity-manager/liquidity-score")
          .then((data) => ({ ok: true, data }))
          .catch((err) => ({ ok: false, error: err?.message || String(err) })),
        traefikFetch(providersPath),
      ];

      if (includeTasks) {
        requests.push(traefikFetch("/liquidity-manager/liquidity-score/tasks?status=RUNNING&limit=50"));
      }
      if (includeHistoryDays != null) {
        requests.push(
          traefikFetch(`/liquidity-manager/liquidity-score/history?days=${encodeURIComponent(String(includeHistoryDays))}`)
        );
      }

      const [latestWrap, providersBody, tasksBody, historyBody] = await Promise.all(requests);

      const latest = latestWrap?.ok ? latestWrap.data : null;
      const providers = providersBody?.providers || {};
      const runningTasks = includeTasks
        ? Array.isArray(tasksBody?.items)
          ? tasksBody.items
          : []
        : [];
      const historyItems =
        includeHistoryDays != null
          ? Array.isArray(historyBody?.items)
            ? historyBody.items
            : []
          : [];

      const providerSummary = Object.entries(providers).map(([name, p]) => ({
        name,
        status: p?.status || "UNKNOWN",
        lastSuccessTimestamp: p?.lastSuccessTimestamp || null,
        error: p?.error?.message || p?.lastError?.message || null,
      }));

      const summary = {
        score: latest?.score ?? null,
        riskRegime: latest?.riskRegime ?? null,
        volatilityRegime: latest?.volatilityRegime ?? null,
        confidence: latest?.confidence ?? null,
        timestamp: latest?.timestamp ?? null,
        providersOk: providerSummary.filter((p) => p.status === "OK").length,
        providersTotal: providerSummary.length,
        runningTasks: runningTasks.length,
        historyCount: historyItems.length,
      };

      logger?.info?.(
        `[mcp/liquidity_snapshot] score=${summary.score} risk=${summary.riskRegime} providersOk=${summary.providersOk}/${summary.providersTotal} runningTasks=${summary.runningTasks}`
      );

      return {
        ok: true,
        data: {
          summary,
          latest,
          providers: providerSummary,
          ...(includeTasks ? { tasks: runningTasks } : {}),
          ...(includeHistoryDays != null
            ? { history: { days: includeHistoryDays, items: historyItems } }
            : {}),
          ...(latestWrap?.ok ? {} : { latestError: latestWrap?.error || "latest score unavailable" }),
        },
      };
    } catch (err) {
      logger?.warning?.(`[mcp/liquidity_snapshot] fetch failed: ${err?.message || String(err)}`);
      return {
        ok: false,
        error: { code: "FETCH_ERROR", message: err?.message || String(err) },
      };
    }
  },
};

