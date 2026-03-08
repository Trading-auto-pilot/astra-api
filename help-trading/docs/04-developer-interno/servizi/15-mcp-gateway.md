---
sidebar_position: 16
---

# mcp-gateway

Questa pagina è l'hub API del microservizio `mcp-gateway`.

## Endpoint disponibili

| Metodo | Path | Descrizione | Dettaglio |
|---|---|---|---|
| `GET` | `/mcp-gateway/mcp/health` | Liveness check del gateway MCP. Sempre attivo, non richiede inizializzazione registry. | [Apri](./mcp-gateway-endpoint-01-get-mcp-gateway-mcp-health.md) |
| `GET` | `/mcp-gateway/mcp/tools` | Elenca i tool MCP registrati nel registry. Richiede servizio inizializzato. | [Apri](./mcp-gateway-endpoint-02-get-mcp-gateway-mcp-tools.md) |
| `POST` | `/mcp-gateway/mcp/call` | Invoca un tool MCP per nome (solo se `MCP_TRANSPORT=http`). Richiede `X-Internal-Token` se `INTERNAL_TOKEN` impostato. | [Apri](./mcp-gateway-endpoint-03-post-mcp-gateway-mcp-call.md) |
