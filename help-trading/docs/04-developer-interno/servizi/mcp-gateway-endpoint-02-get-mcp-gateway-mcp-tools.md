---
title: GET /mcp-gateway/mcp/tools
---

# GET /mcp-gateway/mcp/tools

Area: `Debug / Introspezione`.

## Request

- Metodo: `GET`
- Path: `/mcp-gateway/mcp/tools`
- Input noto: Nessuno. Restituisce tutti i tool registrati nel registry MCP.

## Parametri / Body

Nessun parametro richiesto.

## Risposta attesa

`200 OK`

```json
{
  "ok": true,
  "count": 2,
  "tools": [
    {
      "name": "ping",
      "description": "Simple connectivity check. Returns pong with the input message echoed back.",
      "inputSchema": {
        "message": { "type": "string", "description": "Optional message to echo", "required": false }
      }
    },
    {
      "name": "strategies_list",
      "description": "Lists active trading strategies (pipes) available for the authenticated user.",
      "inputSchema": {
        "pipeId": { "type": "number", "description": "Optional pipe ID to fetch a specific pipe", "required": false }
      }
    }
  ]
}
```

## Errori comuni

| HTTP | Quando |
|---|---|
| `500` | Registry MCP non inizializzato o `MCP_ENABLED=false`. |
| `503` | Servizio non ancora pronto. |

## Esempio

```bash
curl "http://localhost:3004/mcp/tools"
```
