---
sidebar_position: 5
---

# Runbook

## Avvio rapido

```bash
docker compose -f docker-compose.local.yml --env-file .env.local \
  --profile mcp-gateway up -d mcp-gateway

docker compose -f docker-compose.local.yml logs -f mcp-gateway
```

## Check operativi

```bash
# Liveness check
curl -f http://localhost:3004/status/health

# Info servizio
curl http://localhost:3004/status/info

# Elenco tool registrati
curl http://localhost:3004/mcp/tools

# Chiamata diretta ping
curl -X POST http://localhost:3004/mcp/call \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -d '{"tool":"ping","input":{"message":"test"}}'
```

## Problemi comuni

- **`GET /mcp/tools` restituisce lista vuota**: verificare `MCP_ENABLED=true` e che `MCP_TOOL_ALLOWLIST` non escluda tutti i tool.
- **`strategies_list` restituisce `FETCH_ERROR`**: verificare che `tickerscanner` sia in esecuzione e raggiungibile all'URL configurato in `TICKERSCANNER_URL`.
- **`401 Unauthorized` sugli endpoint HTTP**: aggiungere `-H "X-Internal-Token: $INTERNAL_TOKEN"` alla richiesta.
- **Claude Desktop non vede il server MCP**: verificare path assoluto in `claude_desktop_config.json`, riavviare Claude Desktop, controllare che `node` sia nel PATH.
- **Errori su dipendenze**: verificare `DATAHUB_URL` / `REDIS_URL` e DNS Docker.

## Osservabilita

- Log servizio: `docker compose logs -f mcp-gateway`
- Canali runtime: `GET /status/communicationChannels`
- Metriche runtime: `GET /status/metrics`
- Tool attivi: `GET /mcp/tools`

## Rebuild e restart (local)

```bash
docker compose -f docker-compose.local.yml --env-file .env.local \
  build mcp-gateway

docker compose -f docker-compose.local.yml --env-file .env.local \
  up -d --no-deps mcp-gateway
```
