// routes.mcpHttp.js
// MCP HTTP transport endpoints: tool listing and tool invocation.
// Mounted only when MCP_TRANSPORT=http. Auth is delegated to Traefik/auth-forward.
"use strict";

const { Router } = require("express");

const PROTOCOL_VERSION = "2024-11-05";

function requireToken(req, res, next) {
  // No internal token check: upstream Traefik/auth-forward enforces API key auth.
  next();
}

/**
 * Factory called by serverFactory with { logger, getService }.
 * @returns {Router}
 */
function createMcpHttpRouter({ logger, getService }) {
  const router = Router();

  function toJsonRpcError(id, code, message) {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }

  function toJsonSchema(schema) {
    if (!schema || typeof schema !== "object") {
      return { type: "object", properties: {} };
    }
    if (schema.type === "object" && schema.properties) {
      return schema;
    }

    const properties = {};
    const required = [];
    for (const [key, def] of Object.entries(schema)) {
      properties[key] = {
        type: def.type ?? "string",
        ...(def.description ? { description: def.description } : {}),
      };
      if (def.required === true) required.push(key);
    }

    return {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
    };
  }

  async function handleJsonRpc(service, msg) {
    const id = msg?.id ?? null;
    const method = msg?.method;
    const params = msg?.params ?? {};

    if (!method || typeof method !== "string") {
      return toJsonRpcError(id, -32600, "Invalid Request: missing method");
    }

    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: "mcp-gateway", version: "1.0.0" },
          },
        };

      case "ping":
        return { jsonrpc: "2.0", id, result: {} };

      case "tools/list": {
        const tools = service.getMcpRegistry().listTools().map(({ name, description, inputSchema }) => ({
          name,
          description: description ?? "",
          inputSchema: toJsonSchema(inputSchema),
        }));
        return { jsonrpc: "2.0", id, result: { tools } };
      }

      case "tools/call": {
        const toolName = params?.name;
        const args = params?.arguments ?? {};
        if (!toolName || typeof toolName !== "string") {
          return toJsonRpcError(id, -32602, "Invalid params: missing tool name");
        }

        const ctx = { service, logger };
        const result = await service.getMcpRegistry().callTool(toolName, args, ctx);
        if (result?.ok === false) {
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: result.error?.message || "Tool error" }],
              isError: true,
            },
          };
        }

        const text =
          typeof result?.data === "string"
            ? result.data
            : JSON.stringify(result?.data ?? result, null, 2);

        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text }],
            isError: false,
          },
        };
      }

      default:
        return toJsonRpcError(id, -32601, `Method not found: ${method}`);
    }
  }

  // POST / — MCP JSON-RPC endpoint for Web connectors
  router.post("/", requireToken, async (req, res) => {
    try {
      const service = getService();
      const msg = req.body;

      if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
        return res.status(400).json(toJsonRpcError(null, -32600, "Invalid Request"));
      }

      // Notifications: no id, no response body
      if (msg.id === undefined || msg.id === null) {
        if (msg.method === "notifications/initialized") {
          logger?.info?.("[mcp/http] notifications/initialized received");
        }
        return res.status(204).end();
      }

      const response = await handleJsonRpc(service, msg);
      return res.json(response);
    } catch (err) {
      logger?.error?.(`[mcp/http] POST / (json-rpc) error: ${err?.message || String(err)}`);
      return res.status(500).json(toJsonRpcError(null, -32603, "Internal error"));
    }
  });

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
