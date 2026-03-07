// routes.mcpDebug.js
// Debug/introspection endpoints for the MCP subsystem.
// Mounted at /mcp with protected=true (requireReady enforced by serverFactory).
"use strict";

const { Router } = require("express");

/**
 * Factory called by serverFactory with { logger, getService }.
 * @returns {Router}
 */
function createMcpDebugRouter({ logger, getService }) {
  const router = Router();

  // GET /mcp/health — liveness check
  router.get("/health", (_req, res) => {
    res.json({ ok: true, service: "mcp-gateway", version: "1.0.0" });
  });

  // GET /mcp/tools — list registered MCP tools
  router.get("/tools", (req, res) => {
    try {
      const service = getService();
      const tools = service.getMcpRegistry().listTools();
      return res.json({ ok: true, count: tools.length, tools });
    } catch (err) {
      logger?.error?.(`[mcp/debug] GET /tools error: ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: err?.message || "Internal error" });
    }
  });

  return router;
}

module.exports = createMcpDebugRouter;
module.exports.createMcpDebugRouter = createMcpDebugRouter;
