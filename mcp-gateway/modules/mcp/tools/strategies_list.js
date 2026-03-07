// modules/mcp/tools/strategies_list.js
"use strict";

const { traefikFetch } = require("./_http");

module.exports = {
  name: "strategies_list",
  description: "Lists active trading strategies (pipes) available for the authenticated user.",
  inputSchema: {
    pipeId: { type: "number", description: "Optional pipe ID to fetch a specific pipe", required: false },
  },
  async handler(ctx, input) {
    const { logger } = ctx;
    const path = input?.pipeId != null
      ? `/tickerscanner/fundamentals/users/pipes/${encodeURIComponent(input.pipeId)}`
      : "/tickerscanner/fundamentals/users/pipes";

    try {
      const body = await traefikFetch(path);
      const pipes = Array.isArray(body?.data) ? body.data
        : Array.isArray(body) ? body
        : body?.data ?? body ?? [];

      logger?.info?.(`[mcp/strategies_list] fetched ${Array.isArray(pipes) ? pipes.length : 1} pipe(s)`);
      return { ok: true, data: { pipes } };
    } catch (err) {
      logger?.warning?.(`[mcp/strategies_list] fetch failed: ${err?.message || String(err)}`);
      return {
        ok: false,
        error: { code: "FETCH_ERROR", message: err?.message || String(err) },
      };
    }
  },
};
