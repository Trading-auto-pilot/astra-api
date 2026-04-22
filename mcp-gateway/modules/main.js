// modules/main.js
"use strict";

const BaseService = require("../../shared/BaseService");
const McpSubsystem = require("./mcp");
const { getConfigBoolean, getConfigString } = require("../../shared/loadSettings");

class McpGateway extends BaseService {
  constructor() {
    super({
      microservice: "mcp-gateway",
      moduleName: "main",
      moduleVersion: "1.0.0",
    });

    this.mcpEnabled = getConfigBoolean("MCP_ENABLED", true);
    this.mcpTransport = getConfigString("MCP_TRANSPORT", "stdio");
    this.mcpHttpPath = getConfigString("MCP_HTTP_PATH", "/mcp");

    this.mcp = this.mcpEnabled
      ? new McpSubsystem({ service: this, logger: this.logger })
      : null;
  }

  /**
   * Called after Redis connection and settings loading.
   * Starts the MCP transport if enabled.
   */
  async _onInit() {
    if (!this.mcpEnabled) {
      this.logger.info("[_onInit] MCP disabled (MCP_ENABLED=false)");
      return;
    }

    if (this.mcpTransport === "stdio") {
      this.logger.info("[_onInit] Starting MCP stdio transport");
      this.mcp.startStdio();
    } else {
      this.logger.info(
        `[_onInit] MCP HTTP transport active — path=${this.mcpHttpPath}`
      );
    }
  }

  /**
   * Called during graceful shutdown, before Redis is closed.
   */
  async _onShutdown() {
    if (this.mcp) {
      this.logger.info("[_onShutdown] Stopping MCP subsystem");
      this.mcp.stopStdio();
    }
  }

  /**
   * Returns the MCP tool registry.
   * Used by root-level REST routers via getService().
   * @returns {import("./mcp/registry")}
   */
  getMcpRegistry() {
    if (!this.mcp) {
      throw new Error("MCP subsystem is disabled (MCP_ENABLED=false)");
    }
    return this.mcp.registry;
  }
}

module.exports = McpGateway;
