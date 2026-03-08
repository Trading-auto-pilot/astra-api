---
sidebar_position: 42
---

# mcp-gateway

## Cosa fa

`mcp-gateway` espone gli strumenti del trading system ad agenti AI tramite il protocollo **MCP** (Model Context Protocol). Supporta due modalità di trasporto: **stdio** (per Claude Desktop / Claude Code) e **HTTP** (per client MCP remoti o URL connector).

## Ruoli e responsabilita

- punto di ingresso MCP per agenti AI (Claude Desktop, Claude Code, altri client MCP);
- registry configurabile di tool con supporto allowlist;
- trasporto stdio: line-delimited JSON su stdin/stdout (Node 18+ readline);
- trasporto HTTP: endpoint REST protetti da `X-Internal-Token`;
- endpoint di debug/introspezione sempre attivi (`/mcp/health`, `/mcp/tools`);
- integrazione con `tickerscanner` per lo strumento `strategies_list`.

## Porta esposta

- Porta interna servizio: `3004`
- Esposizione via Traefik (local profile): `http://localhost/mcp-gateway/*`

## Configurazione compose

```yaml
mcp-gateway:
  image: local/mcp-gateway:${MCP_GATEWAY_VERSION:-latest}
  restart: unless-stopped
  ports:
    - "3004:3004"
  profiles: ["mcp-gateway"]
  environment:
    - DATAHUB_URL=http://datahub:3000
    - REDIS_URL=redis://redis:6379
    - TICKERSCANNER_URL=http://tickerscanner:3013
    - MCP_TRANSPORT=stdio
    - MCP_ENABLED=true
    - INTERNAL_TOKEN=${INTERNAL_TOKEN}
    - ENV=${ENV}
    - TZ=${TIMEZONE}
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3004/status/health"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 15s
  labels:
    - "traefik.enable=true"
    - "traefik.http.routers.mcp-gateway.rule=Host(`localhost`) && PathPrefix(`/mcp-gateway`)"
    - "traefik.http.middlewares.mcp-gateway-stripprefix.stripPrefix.prefixes=/mcp-gateway"
    - "traefik.http.routers.mcp-gateway.middlewares=mcp-gateway-stripprefix,cors-default@docker,auth-forward@docker"
```

## Variabili d'ambiente

### Infrastruttura

Variabili obbligatorie gestite da `BaseService` (comune a tutti i microservizi).

| Variabile | Default | Descrizione |
|---|---|---|
| `DATAHUB_URL` | `http://datahub:3000` | URL del servizio `datahub` (ex `DBMANAGER_URL`, ancora accettato come alias). |
| `REDIS_URL` | — | URI Redis (es. `redis://redis:6379`). Obbligatorio per il bus eventi e i canali di stato. |
| `LOG_LEVEL` | `info` | Livello di log: `trace`, `debug`, `info`, `warning`, `error`. |
| `ENV` | — | Ambiente di esecuzione (`local`, `paper`, `prod`). Usato nel prefisso dei canali Redis. |
| `ENABLE_DB_LOG` | — | Se `true`, abilita la scrittura dei log su DB via `datahub`. |
| `TZ` | — | Timezone di sistema del container (es. `America/New_York`). |

### MCP Gateway

| Variabile | Default | Descrizione |
|---|---|---|
| `MCP_ENABLED` | `true` | Se `false`, il sottosistema MCP è disabilitato. Il server REST rimane attivo ma `getMcpRegistry()` lancia errore. |
| `MCP_TRANSPORT` | `stdio` | Modalità trasporto: `stdio` (Claude Desktop/Code) oppure `http` (REST). |
| `MCP_HTTP_PATH` | `/mcp` | Path di mount del trasporto HTTP (solo se `MCP_TRANSPORT=http`). Consigliato: usare un path diverso da `/mcp` per evitare conflitti con il router di debug. |
| `MCP_TOOL_ALLOWLIST` | _(tutti)_ | Lista tool abilitati, separata da virgola (es. `ping,strategies_list`). Se vuota, tutti i tool registrati sono disponibili. |
| `INTERNAL_TOKEN` | — | Token richiesto nell'header `X-Internal-Token` per gli endpoint HTTP transport. Se non impostato, gli endpoint non richiedono autenticazione. |

### Dipendenze upstream

| Variabile | Default | Descrizione |
|---|---|---|
| `TICKERSCANNER_URL` | `http://tickerscanner:3013` | URL del `tickerscanner`, usato dallo strumento `strategies_list` per recuperare le pipe. |

:::caution
Se `MCP_TRANSPORT=http` e `MCP_HTTP_PATH` non è configurato, il trasporto HTTP si monta sullo stesso prefisso `/mcp` del router di debug. In questo caso `GET /mcp/tools` viene gestito dal router di debug (montato per primo). Impostare `MCP_HTTP_PATH=/mcp/transport` o un path dedicato per evitare ambiguità.
:::

## Pagine dedicate

- [Architettura e flussi](./ms-mcp-gateway-architettura.md)
- [Endpoint dettagliati](./ms-mcp-gateway-endpoint.md)
- [Implementazione per file](./ms-mcp-gateway-file-e-ruoli.md)
- [Configurazione](./ms-mcp-gateway-configurazione.md)
- [Runbook operativo](./ms-mcp-gateway-runbook.md)
