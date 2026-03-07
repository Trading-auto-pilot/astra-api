// modules/mcp/index.js
"use strict";

const McpRegistry = require("./registry");
const StdioTransport = require("./transports/stdio");

class McpSubsystem {
  constructor({ service, logger }) {
    this._service = service;
    this._logger = logger;
    this._stdio = null;

    const allowlistRaw = process.env.MCP_TOOL_ALLOWLIST || "";
    const allowlist = allowlistRaw
      ? allowlistRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    this.registry = new McpRegistry({ allowlist, logger });
  }

  startStdio() {
    if (this._stdio) return;
    const ctx = { service: this._service, logger: this._logger };
    this._stdio = new StdioTransport({
      registry: this.registry,
      logger: this._logger,
      ctx,
    });
    this._stdio.start();
  }

  stopStdio() {
    if (this._stdio) {
      this._stdio.stop();
      this._stdio = null;
    }
  }
}

module.exports = McpSubsystem;
