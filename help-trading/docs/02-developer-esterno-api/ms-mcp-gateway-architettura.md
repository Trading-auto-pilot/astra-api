---
sidebar_position: 1
---

# Architettura e flussi

## Componenti principali

- `server.js`: bootstrap via `createMicroserviceServer`; registra il router di debug (`routes.mcpDebug.js`) e opzionalmente il router HTTP (`routes.mcpHttp.js`);
- `modules/main.js`: service runtime (`McpGateway extends BaseService`); inizializza `McpSubsystem` e avvia il trasporto configurato in `_onInit()`;
- `modules/mcp/index.js`: `McpSubsystem` — crea il registry e gestisce il ciclo di vita del trasporto stdio;
- `modules/mcp/registry.js`: `McpRegistry` — mappa nome → tool, applica allowlist, espone `listTools()` e `callTool()`;
- `modules/mcp/transports/stdio.js`: `StdioTransport` — readline su stdin, JSON per riga, dispatch a registry;
- `modules/mcp/tools/ping.js` · `modules/mcp/tools/strategies_list.js`: tool registrati di default;
- `routes.mcpDebug.js`: router debug — `GET /mcp/health` e `GET /mcp/tools` (sempre attivi, `protected: true`);
- `routes.mcpHttp.js`: router HTTP transport — `GET /tools` e `POST /call` (solo se `MCP_TRANSPORT=http`, protetti da `X-Internal-Token`).

## Flusso stdio (Claude Desktop / Claude Code)

1. Il client MCP avvia `node server.js` come processo figlio.
2. `_onInit()` chiama `mcp.startStdio()` → crea `StdioTransport`.
3. `StdioTransport.start()` apre un `readline.Interface` su `process.stdin`.
4. Il client invia una riga JSON: `{"id":"1","tool":"ping","input":{"message":"ok"}}`.
5. Il transport chiama `registry.callTool(tool, input, ctx)`.
6. Il registry recupera il tool, esegue `validate()` (se presente) e `handler(ctx, input)`.
7. Il risultato viene scritto su `process.stdout` come riga JSON: `{"id":"1","ok":true,"data":{...}}`.

## Flusso HTTP transport (client MCP remoti)

1. Il servizio avvia con `MCP_TRANSPORT=http`.
2. `serverFactory` monta `routes.mcpHttp.js` al path `MCP_HTTP_PATH`.
3. Il client chiama `GET <path>/tools` (lista) o `POST <path>/call` (invocazione).
4. Il middleware `requireToken` valida `X-Internal-Token` se `INTERNAL_TOKEN` è impostato.
5. `POST /call`: body `{"tool":"...", "input":{...}}` → `registry.callTool()` → risposta JSON.

## Flusso invocazione tool

```
client → transport (stdio | HTTP)
  → registry.callTool(name, input, ctx)
    → tool.validate(input)      [opzionale]
    → tool.handler(ctx, input)  [async]
      → upstream call (es. tickerscanner REST) o logica locale
    ← { ok, data } | { ok: false, error: { code, message } }
  ← risposta al client
```

## Contesto tool (ctx)

Ogni handler riceve un oggetto `ctx` con:

```javascript
{
  service,  // istanza McpGateway (BaseService) — accesso a URL, logger, Redis
  logger,   // logger del servizio
}
```

Gli strumenti accedono agli URL degli altri microservizi tramite `ctx.service.tickerscannerUrl`, `ctx.service.datahubUrl` ecc., senza hardcodare indirizzi.

## Registrazione tool e allowlist

Il registry carica i tool da `DEFAULT_TOOLS` a costruzione. Se `MCP_TOOL_ALLOWLIST` è impostata, solo i tool il cui nome è nella lista vengono registrati. Tool con `name` mancante o `handler` non funzione vengono scartati con log di warning.
