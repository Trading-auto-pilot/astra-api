---
sidebar_position: 2
---

# Endpoint dettagliati

Prefisso esterno via Traefik local: `/mcp-gateway`.

## Endpoint debug / introspezione (sempre attivi)

Montati a `/mcp`, protetti da `requireReady` (il servizio deve essere inizializzato).

### `GET /mcp-gateway/mcp/health`

Liveness check. Risponde immediatamente senza accedere al registry.

```json
{ "ok": true, "service": "mcp-gateway", "version": "1.0.0" }
```

### `GET /mcp-gateway/mcp/tools`

Elenca tutti i tool registrati nel registry MCP.

```json
{
  "ok": true,
  "count": 2,
  "tools": [
    { "name": "ping", "description": "Simple connectivity check...", "inputSchema": { "message": { "type": "string" } } },
    { "name": "strategies_list", "description": "Lists active trading strategies...", "inputSchema": { "pipeId": { "type": "number" } } }
  ]
}
```

---

## Endpoint HTTP transport (solo `MCP_TRANSPORT=http`)

Montati al path `MCP_HTTP_PATH` (default `/mcp`). Protetti da `X-Internal-Token` se `INTERNAL_TOKEN` è impostato.

:::info
Per evitare conflitti con il router di debug (che monta `GET /tools` su `/mcp`), configurare `MCP_HTTP_PATH` su un path dedicato come `/mcp/transport`.
:::

### `GET <MCP_HTTP_PATH>/tools`

Equivalente all'endpoint debug ma protetto da token. Restituisce la stessa lista tool.

### `POST <MCP_HTTP_PATH>/call`

Invoca un tool MCP per nome.

**Body:**
```json
{
  "tool": "ping",
  "input": { "message": "hello" }
}
```

**Risposta success:**
```json
{ "ok": true, "data": { "pong": true, "echo": "hello", "ts": "2026-03-04T..." } }
```

**Risposta errore tool non trovato:**
```json
{ "ok": false, "error": { "code": "TOOL_NOT_FOUND", "message": "Unknown tool: \"foo\"" } }
```

**Risposta errore validazione:**
```json
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

**Risposta errore autenticazione (se `INTERNAL_TOKEN` impostato):**
```json
{ "ok": false, "error": { "code": "UNAUTHORIZED", "message": "Invalid or missing X-Internal-Token" } }
```

---

## Endpoint standard microservizio

- `GET /mcp-gateway/release`
- `GET /mcp-gateway/settings`
- `PUT /mcp-gateway/settings`
- `POST /mcp-gateway/settings/reload`
- `PUT /mcp-gateway/connect`
- `DELETE /mcp-gateway/connect`
- `GET /mcp-gateway/dbLogger`
- `PUT /mcp-gateway/dbLogger/:status`

## Endpoint status

Prefisso: `/mcp-gateway/status`.

- `GET /status/health`
- `GET /status/info`
- `GET /status/metrics`
- `GET /status/logLevel`
- `PUT /status/logLevel`
- `GET /status/communicationChannels`
- `PUT /status/communicationChannels`
