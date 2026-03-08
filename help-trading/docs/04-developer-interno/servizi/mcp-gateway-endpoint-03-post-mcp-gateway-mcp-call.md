---
title: POST /mcp-gateway/mcp/call
---

# POST /mcp-gateway/mcp/call

Area: `HTTP Transport MCP`.

:::info
Questo endpoint è disponibile **solo se `MCP_TRANSPORT=http`**. In modalità stdio il transport è gestito via stdin/stdout e non espone endpoint REST aggiuntivi per l'invocazione.

Il path esatto dipende da `MCP_HTTP_PATH` (default `/mcp`). Se configurato diversamente (es. `/mcp/transport`), l'endpoint diventa `POST /mcp-gateway/mcp/transport/call`.
:::

## Request

- Metodo: `POST`
- Path: `/mcp-gateway/mcp/call` (o `/<MCP_HTTP_PATH>/call`)
- Header obbligatorio (se `INTERNAL_TOKEN` impostato): `X-Internal-Token: <token>`
- Content-Type: `application/json`

## Parametri / Body

```json
{
  "tool": "strategies_list",
  "input": {
    "pipeId": 5
  }
}
```

| Campo | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `tool` | `string` | Sì | Nome del tool da invocare (deve esistere nel registry) |
| `input` | `object` | No | Parametri passati all'handler del tool (default `{}`) |

## Risposta attesa

`200 OK` — risposta del tool.

**Esempio ping:**
```json
{
  "ok": true,
  "data": {
    "pong": true,
    "echo": "hello",
    "ts": "2026-03-04T10:00:00.000Z"
  }
}
```

**Esempio strategies_list:**
```json
{
  "ok": true,
  "data": {
    "pipes": [
      { "id": 1, "name": "Growth US Equity", "userId": 7 },
      { "id": 5, "name": "ETF Rotation", "userId": 7 }
    ]
  }
}
```

## Errori comuni

| HTTP | Quando |
|---|---|
| `400` | Campo `tool` mancante o non stringa. |
| `401` | `X-Internal-Token` mancante o non valido (solo se `INTERNAL_TOKEN` è impostato). |
| `500` | Errore interno nell'handler del tool o registry non disponibile. |

**Risposta tool non trovato (`200` con `ok: false`):**
```json
{
  "ok": false,
  "error": { "code": "TOOL_NOT_FOUND", "message": "Unknown tool: \"foo\"" }
}
```

**Risposta errore validazione (`200` con `ok: false`):**
```json
{
  "ok": false,
  "error": { "code": "VALIDATION_ERROR", "message": "..." }
}
```

## Esempio

```bash
# Ping
curl -X POST "http://localhost:3004/mcp/call" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -d '{"tool":"ping","input":{"message":"hello"}}'

# Lista strategie
curl -X POST "http://localhost:3004/mcp/call" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -d '{"tool":"strategies_list","input":{}}'

# Strategia specifica
curl -X POST "http://localhost:3004/mcp/call" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -d '{"tool":"strategies_list","input":{"pipeId":5}}'
```
