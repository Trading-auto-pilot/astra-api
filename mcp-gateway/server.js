// server.js
"use strict";

const { getConfigString } = require("../shared/loadSettings");
const MCP_TRANSPORT = getConfigString("MCP_TRANSPORT", "stdio");

// In stdio mode stdout is the MCP JSON-RPC 2.0 channel.
// Redirect all console output to stderr so log messages don't corrupt the stream.
if (MCP_TRANSPORT === "stdio") {
  const toStderr = (...args) => process.stderr.write(args.join(" ") + "\n");
  console.log  = toStderr;
  console.info = toStderr;
}

if (MCP_TRANSPORT === "stdio") {
  // -----------------------------------------------------------------------
  // Stdio-only mode: MCP runs entirely over stdin/stdout.
  // No Express server is started — avoids port conflicts with the Docker
  // container and removes unnecessary overhead for Claude Desktop / Code.
  // -----------------------------------------------------------------------
  const createLogger  = require("../shared/logger");
  const McpSubsystem  = require("./modules/mcp");

  const logger = createLogger(
    "mcp-gateway", "main", "1.0.0",
    getConfigString("LOG_LEVEL", "info")
  );

  const mcp = new McpSubsystem({ service: null, logger });
  mcp.startStdio();

  const shutdown = () => { mcp.stopStdio(); process.exit(0); };
  process.on("SIGINT",  shutdown);
  process.on("SIGTERM", shutdown);

} else {
  // -----------------------------------------------------------------------
  // HTTP / full-server mode: Express + REST routes + Docker container.
  // -----------------------------------------------------------------------
  const { createMicroserviceServer } = require("../shared/serverFactory");
  const McpGatewayService            = require("./modules/main");
  const createMcpDebugRouter         = require("./routes.mcpDebug");
  const createMcpHttpRouter          = require("./routes.mcpHttp");

  const MCP_HTTP_PATH = getConfigString("MCP_HTTP_PATH", "/mcp");

  const routes = [
    { path: "/mcp",        router: createMcpDebugRouter, protected: true  },
    { path: MCP_HTTP_PATH, router: createMcpHttpRouter,  protected: false },
  ];

  createMicroserviceServer({
    ServiceClass:  McpGatewayService,
    microservice:  "mcp-gateway",
    moduleName:    "RESTServer",
    moduleVersion: "1.0.0",
    defaultPort:   3004,
    routes,
  });
}
