# mcp-gateway

MCP (Model Context Protocol) Gateway microservice — exposes trading-system tools to AI agents via stdio or HTTP transport.

## Quick Start

```bash
# Development (stdio transport, default)
npm run dev

# Production
npm start
```

## Architecture

- **BaseService** (`modules/main.js`): Business logic, initialises MCP subsystem
- **serverFactory** (`server.js`): Express server with standard routes
- **MCP subsystem** (`modules/mcp/`): Registry, transports, tools
- **Debug router** (`routes.mcpDebug.js`): introspection endpoints at `/mcp`
- **HTTP router** (`routes.mcpHttp.js`): MCP-over-HTTP transport at configurable path

## Transport Modes

### stdio (Claude Desktop / Claude Code)

Default mode. The service reads JSON-RPC lines from stdin and writes results to stdout.

```bash
MCP_TRANSPORT=stdio node server.js
```

Claude Desktop config (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "trading-system": {
      "command": "node",
      "args": ["/path/to/mcp-gateway/server.js"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "TICKERSCANNER_URL": "http://localhost:3013"
      }
    }
  }
}
```

### HTTP (URL Connector)

REST-based MCP transport. Protected by `X-Internal-Token` header when `INTERNAL_TOKEN` is set.

```bash
MCP_TRANSPORT=http MCP_HTTP_PATH=/mcp node server.js
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MCP_ENABLED` | `true` | Set to `false` to disable MCP subsystem |
| `MCP_TRANSPORT` | `stdio` | Transport mode: `stdio` or `http` |
| `MCP_HTTP_PATH` | `/mcp` | Mount path for HTTP transport |
| `MCP_TOOL_ALLOWLIST` | _(all)_ | Comma-separated list of allowed tool names |
| `INTERNAL_TOKEN` | _(none)_ | Token required in `X-Internal-Token` header for HTTP transport |
| `TICKERSCANNER_URL` | `http://tickerscanner:3013` | Used by `strategies_list` tool |

## Endpoints

### Debug / Introspection (always active)

```bash
# Liveness check
curl http://localhost:3004/mcp/health

# List registered tools
curl http://localhost:3004/mcp/tools
```

### HTTP Transport (MCP_TRANSPORT=http)

```bash
# List tools
curl http://localhost:3004/mcp/tools \
  -H "X-Internal-Token: $INTERNAL_TOKEN"

# Call a tool
curl -X POST http://localhost:3004/mcp/call \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -d '{"tool":"ping","input":{"message":"hello"}}'

# Call strategies_list
curl -X POST http://localhost:3004/mcp/call \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -d '{"tool":"strategies_list","input":{}}'
```

### stdio Protocol

Each request is a JSON line written to stdin:

```json
{"id":"1","tool":"ping","input":{"message":"hello"}}
```

Each response is a JSON line written to stdout:

```json
{"id":"1","ok":true,"data":{"pong":true,"echo":"hello","ts":"2026-03-04T..."}}
```

## Available Tools

| Tool | Description |
|---|---|
| `ping` | Connectivity check — echoes back the input message |
| `strategies_list` | Lists trading strategies (pipes) from tickerScanner |

## Standard Endpoints

- `GET /status/health` — Health check
- `GET /status/info` — Service information
- `GET /release` — Release information
- `GET /settings` — Current settings
- `POST /settings/reload` — Reload settings from DB

## Port

Default: **3004**

## Documentation

- [BaseService API](../shared/BaseService.README.md)
- [Server Factory](../shared/FACTORIES_README.md)
