// routes.mcpHttp.js
// MCP HTTP transport endpoints: tool listing and tool invocation.
// Mounted only when MCP_TRANSPORT=http. Token-protected if INTERNAL_TOKEN is set.
"use strict";

const { Router } = require("express");

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || null;

function requireToken(req, res, next) {
  if (!INTERNAL_TOKEN) return next();
  const provided = req.headers["x-internal-token"];
  if (provided !== INTERNAL_TOKEN) {
    return res.status(401).json({
      ok: false,
      error: { code: "UNAUTHORIZED", message: "Invalid or missing X-Internal-Token" },
    });
  }
  next();
}

/**
 * Factory called by serverFactory with { logger, getService }.
 * @returns {Router}
 */
function createMcpHttpRouter({ logger, getService }) {
  const router = Router();

  // GET /tools — list available tools (optionally protected by INTERNAL_TOKEN)
  router.get("/tools", requireToken, (_req, res) => {
    try {
      const service = getService();
      const tools = service.getMcpRegistry().listTools();
      return res.json({ ok: true, count: tools.length, tools });
    } catch (err) {
      logger?.error?.(`[mcp/http] GET /tools error: ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: err?.message || "Internal error" });
    }
  });

  // POST /call — invoke a tool by name
  router.post("/call", requireToken, async (req, res) => {
    const { tool, input } = req.body || {};

    if (!tool || typeof tool !== "string") {
      return res.status(400).json({
        ok: false,
        error: { code: "BAD_REQUEST", message: "Missing or invalid 'tool' field" },
      });
    }

    try {
      const service = getService();
      const ctx = { service, logger };
      const result = await service.getMcpRegistry().callTool(tool, input ?? {}, ctx);
      return res.json(result);
    } catch (err) {
      logger?.error?.(`[mcp/http] POST /call "${tool}" error: ${err?.message || String(err)}`);
      return res.status(500).json({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: err?.message || "Internal error" },
      });
    }
  });

  return router;
}

module.exports = createMcpHttpRouter;
module.exports.createMcpHttpRouter = createMcpHttpRouter;
