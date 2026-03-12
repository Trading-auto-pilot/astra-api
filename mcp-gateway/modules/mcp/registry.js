// modules/mcp/registry.js
"use strict";

const DEFAULT_TOOLS = [
  require("./tools/ping"),
  require("./tools/strategies_list"),
  require("./tools/read_logs"),
  require("./tools/alerts_list"),
  require("./tools/ibkr_keepalive_status"),
  require("./tools/broker_ibkr_snapshot"),
  require("./tools/liquidity_snapshot"),
  require("./tools/scheduler_list_jobs"),
  require("./tools/scheduler_run_job"),
  require("./tools/documentazione"),
];

class McpRegistry {
  constructor({ allowlist = [], logger } = {}) {
    this._logger = logger;
    this._allowlist = allowlist.length > 0 ? new Set(allowlist) : null;
    this._tools = new Map();

    for (const tool of DEFAULT_TOOLS) {
      this.register(tool);
    }
  }

  register(tool) {
    if (!tool?.name || typeof tool.handler !== "function") {
      this._logger?.warning?.(`[mcp/registry] Invalid tool skipped: ${tool?.name ?? "(unnamed)"}`);
      return;
    }
    if (this._allowlist && !this._allowlist.has(tool.name)) {
      this._logger?.info?.(`[mcp/registry] Tool "${tool.name}" not in allowlist — skipped`);
      return;
    }
    this._tools.set(tool.name, tool);
    this._logger?.info?.(`[mcp/registry] Registered tool: ${tool.name}`);
  }

  listTools() {
    return Array.from(this._tools.values()).map(({ name, description, inputSchema }) => ({
      name,
      description: description ?? "",
      inputSchema: inputSchema ?? {},
    }));
  }

  async callTool(name, input, ctx) {
    const tool = this._tools.get(name);
    if (!tool) {
      return {
        ok: false,
        error: { code: "TOOL_NOT_FOUND", message: `Unknown tool: "${name}"` },
      };
    }

    if (typeof tool.validate === "function") {
      const validationError = tool.validate(input);
      if (validationError) {
        return {
          ok: false,
          error: { code: "VALIDATION_ERROR", message: validationError },
        };
      }
    }

    try {
      const result = await tool.handler(ctx, input ?? {});
      return result;
    } catch (err) {
      this._logger?.error?.(
        `[mcp/registry] callTool "${name}" threw: ${err?.message || String(err)}`
      );
      return {
        ok: false,
        error: { code: "TOOL_ERROR", message: err?.message || String(err) },
      };
    }
  }
}

module.exports = McpRegistry;
