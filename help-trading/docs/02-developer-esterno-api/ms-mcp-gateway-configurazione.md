---
sidebar_position: 4
---

# Configurazione

## Scenari di deployment

### Scenario 1 — stdio locale (Claude Desktop / Claude Code)

Configurazione minima per integrare il gateway con un client AI locale. Non richiede Traefik né rete Docker.

```bash
MCP_TRANSPORT=stdio \
MCP_ENABLED=true \
TICKERSCANNER_URL=http://localhost:3013 \
DATAHUB_URL=http://localhost:3000 \
REDIS_URL=redis://localhost:6379 \
node mcp-gateway/server.js
```

In `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "trading-system": {
      "command": "node",
      "args": ["/percorso/assoluto/mcp-gateway/server.js"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "TICKERSCANNER_URL": "http://localhost:3013",
        "DATAHUB_URL": "http://localhost:3000",
        "REDIS_URL": "redis://localhost:6379"
      }
    }
  }
}
```

### Scenario 2 — HTTP transport containerizzato

Deployment via Docker Compose, trasporto HTTP, protetto da token.

```yaml
# docker-compose.local.yml
mcp-gateway:
  environment:
    - MCP_TRANSPORT=http
    - MCP_HTTP_PATH=/mcp/transport
    - INTERNAL_TOKEN=${INTERNAL_TOKEN}
    - MCP_TOOL_ALLOWLIST=ping,strategies_list
    - TICKERSCANNER_URL=http://tickerscanner:3013
```

Con `MCP_HTTP_PATH=/mcp/transport`, gli endpoint diventano:
- `GET /mcp/health` (debug, sempre attivo)
- `GET /mcp/tools` (debug, sempre attivo)
- `GET /mcp/transport/tools` (HTTP transport)
- `POST /mcp/transport/call` (HTTP transport)

### Scenario 3 — MCP disabilitato (solo REST standard)

Se si vuole avere il container attivo per gli endpoint standard (`/status/health`, `/settings` ecc.) senza esporre strumenti MCP:

```yaml
environment:
  - MCP_ENABLED=false
```

Il server REST rimane completamente funzionale. Le chiamate a `getMcpRegistry()` restituiranno un errore interno.

---

## Variabili di riferimento completo

| Variabile | Default | Obbligatoria | Descrizione |
|---|---|---|---|
| `DATAHUB_URL` | `http://datahub:3000` | Sì | URL datahub (gestita da BaseService) |
| `REDIS_URL` | — | Sì | URI Redis |
| `MCP_ENABLED` | `true` | No | Disabilitare con `false` |
| `MCP_TRANSPORT` | `stdio` | No | `stdio` oppure `http` |
| `MCP_HTTP_PATH` | `/mcp` | No | Path mount HTTP transport |
| `MCP_TOOL_ALLOWLIST` | _(tutti)_ | No | Lista tool abilitati (CSV) |
| `INTERNAL_TOKEN` | — | No | Token protezione endpoint HTTP |
| `TICKERSCANNER_URL` | `http://tickerscanner:3013` | No | Upstream per `strategies_list` |
| `LOG_LEVEL` | `info` | No | Livello di log |
| `ENV` | — | No | Prefisso canali Redis |
| `PORT` | `3004` | No | Porta Express |

## Aggiungere un nuovo tool

1. Creare `modules/mcp/tools/<nome>.js` con la struttura tool (vedi [File e ruoli](./ms-mcp-gateway-file-e-ruoli.md)).
2. Aggiungere il require in `modules/mcp/registry.js` nell'array `DEFAULT_TOOLS`.
3. Se si usa `MCP_TOOL_ALLOWLIST`, aggiungere il nome del tool alla variabile.
4. Riavviare il servizio — il tool comparirà automaticamente in `GET /mcp/tools` e sarà disponibile al client AI.
