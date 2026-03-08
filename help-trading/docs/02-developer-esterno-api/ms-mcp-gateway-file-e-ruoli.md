---
sidebar_position: 3
---

# Implementazione per file

## Struttura principale

- `mcp-gateway/server.js`
- `mcp-gateway/modules/main.js`
- `mcp-gateway/routes.mcpDebug.js`
- `mcp-gateway/routes.mcpHttp.js`
- `mcp-gateway/modules/mcp/index.js`
- `mcp-gateway/modules/mcp/registry.js`
- `mcp-gateway/modules/mcp/transports/stdio.js`

## Strumenti (tools)

- `mcp-gateway/modules/mcp/tools/ping.js`
- `mcp-gateway/modules/mcp/tools/strategies_list.js`

## Ruolo dei file

### `server.js`

Thin bootstrap: chiama `createMicroserviceServer` con `ServiceClass: McpGatewayService` e l'array di route. Registra sempre il router di debug; aggiunge il router HTTP solo se `MCP_TRANSPORT=http`. Nessuna logica business.

### `modules/main.js`

`McpGateway extends BaseService`:
- costruttore: crea `McpSubsystem` se `MCP_ENABLED !== "false"`;
- `_onInit()`: avvia il trasporto stdio (o logga che il trasporto HTTP è attivo);
- `_onShutdown()`: ferma il trasporto stdio;
- `getMcpRegistry()`: restituisce `this.mcp.registry` — usato dai router REST via `getService()`.

### `routes.mcpDebug.js`

Router factory `createMcpDebugRouter({ logger, getService })`:
- `GET /health` — liveness check statico;
- `GET /tools` — chiama `getService().getMcpRegistry().listTools()`.

Montato con `protected: true` (richiede che il servizio sia inizializzato).

### `routes.mcpHttp.js`

Router factory `createMcpHttpRouter({ logger, getService })`:
- middleware `requireToken`: valida `X-Internal-Token` se `INTERNAL_TOKEN` è impostato;
- `GET /tools` — lista tool (con token);
- `POST /call` — invoca `registry.callTool(tool, input, ctx)` con body JSON.

Montato con `protected: false` (la protezione è gestita internamente dal middleware token).

### `modules/mcp/index.js` — `McpSubsystem`

- costruttore: legge `MCP_TOOL_ALLOWLIST`, crea `McpRegistry` con allowlist;
- `startStdio()`: crea e avvia `StdioTransport`;
- `stopStdio()`: ferma il trasporto;
- espone `this.registry` (letto da `getMcpRegistry()`).

### `modules/mcp/registry.js` — `McpRegistry`

- `constructor({ allowlist, logger })`: registra `DEFAULT_TOOLS` con rispetto allowlist;
- `register(tool)`: valida struttura tool, verifica allowlist, aggiunge a `_tools` Map;
- `listTools()`: mappa `_tools` in array `{ name, description, inputSchema }`;
- `callTool(name, input, ctx)`: lookup tool, validate opzionale, chiama `handler`, cattura eccezioni.

### `modules/mcp/transports/stdio.js` — `StdioTransport`

- `start()`: apre `readline.Interface` su `process.stdin` (terminal: false);
- per ogni riga: parse JSON, valida presenza `tool`, chiama `registry.callTool`, scrive risposta su stdout;
- `stop()`: chiude readline;
- `_write(obj)`: `process.stdout.write(JSON.stringify(obj) + "\n")` con try/catch.

### `modules/mcp/tools/ping.js`

Tool senza dipendenze: restituisce `{ pong: true, echo: input.message, ts: now }`. Usato come healthcheck e test di connettività dal client AI.

### `modules/mcp/tools/strategies_list.js`

Tool che chiama `GET /fundamentals/users/pipes[/:pipeId]` su `tickerscanner` via `fetch()` globale (Node 18+). Timeout 5 secondi via `AbortSignal.timeout`. Legge l'URL da `ctx.service.tickerscannerUrl` con fallback a `TICKERSCANNER_URL` e al default Docker interno.

## Contratto tool

Ogni tool esporta un oggetto con la seguente struttura:

```javascript
module.exports = {
  name: "nome_tool",                  // stringa, chiave nel registry
  description: "Descrizione...",      // mostrata in listTools()
  inputSchema: {                      // schema campi input (non validato automaticamente)
    campo: { type: "string", description: "...", required: false },
  },
  validate(input) { /* opzionale */ return null | "messaggio errore"; },
  async handler(ctx, input) {
    // ctx = { service, logger }
    return { ok: true, data: { ... } };
    // oppure
    return { ok: false, error: { code: "CODICE", message: "..." } };
  },
};
```
