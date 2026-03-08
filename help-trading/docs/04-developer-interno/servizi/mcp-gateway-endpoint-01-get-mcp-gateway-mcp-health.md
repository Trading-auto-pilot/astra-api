---
title: GET /mcp-gateway/mcp/health
---

# GET /mcp-gateway/mcp/health

Area: `Debug / Introspezione`.

## Request

- Metodo: `GET`
- Path: `/mcp-gateway/mcp/health`
- Input noto: Nessuno. Risponde immediatamente senza accedere al registry MCP.

## Parametri / Body

Nessun parametro richiesto.

## Risposta attesa

`200 OK`

```json
{
  "ok": true,
  "service": "mcp-gateway",
  "version": "1.0.0"
}
```

## Errori comuni

| HTTP | Quando |
|---|---|
| `503` | Servizio non ancora pronto (requireReady non soddisfatto). |
| `500` | Errore interno. |

## Esempio

```bash
curl "http://localhost:3004/mcp/health"
```
