// modules/mcp/transports/stdio.js
// Implements MCP JSON-RPC 2.0 stdio transport.
// Protocol spec: https://spec.modelcontextprotocol.io
"use strict";

const readline = require("readline");

const PROTOCOL_VERSION = "2024-11-05";

class StdioTransport {
  constructor({ registry, logger, ctx }) {
    this._registry = registry;
    this._logger = logger;
    this._ctx = ctx;
    this._rl = null;
  }

  start() {
    if (this._rl) return;

    this._rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    this._rl.on("line", async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let msg;
      try {
        msg = JSON.parse(trimmed);
      } catch (_e) {
        // Cannot respond without an id — just ignore unparseable lines
        this._logger?.warning?.("[mcp/stdio] received unparseable line");
        return;
      }

      const { id, method, params } = msg;

      // Notifications have no id — handle but do NOT respond
      if (id === undefined || id === null) {
        if (method === "notifications/initialized") {
          this._logger?.info?.("[mcp/stdio] client initialized");
        }
        return;
      }

      await this._handleRequest(id, method, params || {});
    });

    this._rl.on("close", () => {
      this._logger?.info?.("[mcp/stdio] stdin closed");
    });

    this._logger?.info?.("[mcp/stdio] MCP JSON-RPC 2.0 stdio transport started");
  }

  stop() {
    if (this._rl) {
      this._rl.close();
      this._rl = null;
      this._logger?.info?.("[mcp/stdio] stdio transport stopped");
    }
  }

  // -------------------------------------------------------------------------
  // Request dispatcher
  // -------------------------------------------------------------------------

  async _handleRequest(id, method, params) {
    switch (method) {
      case "initialize":
        return this._respond(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "mcp-gateway", version: "1.0.0" },
        });

      case "ping":
        return this._respond(id, {});

      case "tools/list":
        return this._respond(id, { tools: this._listTools() });

      case "tools/call": {
        const { name, arguments: args } = params;
        if (!name || typeof name !== "string") {
          return this._respondError(id, -32602, "Invalid params: missing tool name");
        }
        const result = await this._registry.callTool(name, args ?? {}, this._ctx);
        if (result.ok === false) {
          return this._respond(id, {
            content: [{ type: "text", text: result.error?.message || "Tool error" }],
            isError: true,
          });
        }
        const text =
          typeof result.data === "string"
            ? result.data
            : JSON.stringify(result.data ?? result, null, 2);
        return this._respond(id, {
          content: [{ type: "text", text }],
          isError: false,
        });
      }

      default:
        return this._respondError(id, -32601, `Method not found: ${method}`);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  _listTools() {
    return this._registry.listTools().map(({ name, description, inputSchema }) => ({
      name,
      description: description ?? "",
      inputSchema: this._toJsonSchema(inputSchema),
    }));
  }

  /**
   * Converts our internal inputSchema format { fieldName: { type, description, required } }
   * to proper JSON Schema { type:"object", properties:{...}, required:[...] }.
   */
  _toJsonSchema(schema) {
    if (!schema || typeof schema !== "object") {
      return { type: "object", properties: {} };
    }
    // Already proper JSON Schema
    if (schema.type === "object" && schema.properties) return schema;

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

  _respond(id, result) {
    this._write({ jsonrpc: "2.0", id, result });
  }

  _respondError(id, code, message) {
    this._write({ jsonrpc: "2.0", id, error: { code, message } });
  }

  _write(obj) {
    try {
      process.stdout.write(JSON.stringify(obj) + "\n");
    } catch (_e) {
      // stdout closed — ignore
    }
  }
}

module.exports = StdioTransport;
