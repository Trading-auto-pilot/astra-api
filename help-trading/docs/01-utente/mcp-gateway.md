---
sidebar_position: 9
---

# MCP Gateway — Assistente AI sul trading system

Il **MCP Gateway** è un canale di accesso che permette ad agenti AI come **Claude** (Claude Desktop, Claude Code o qualsiasi client compatibile MCP) di interagire direttamente con il trading system: interrogare strategie, leggere dati e ricevere risposte in linguaggio naturale.

In pratica: puoi chiedere a Claude "quali strategie ho attive?" e ottenere una risposta aggiornata direttamente dai tuoi dati reali, senza aprire interfacce web.

---

## Scheda operativa

| Voce | Dettaglio |
|---|---|
| Scopo | Esporre gli strumenti del trading system ad agenti AI tramite protocollo MCP |
| Microservizio | `mcp-gateway` — porta `3004` |
| Protocolli supportati | **stdio** (Claude Desktop / Claude Code) · **HTTP** (URL connector o altri client MCP) |
| Strumenti disponibili | `ping` (test connettività) · `strategies_list` (elenco strategie attive) |
| Prerequisiti | `mcp-gateway` in esecuzione + `tickerscanner` raggiungibile |

---

## Come funziona

Claude parla con il trading system attraverso il **protocollo MCP** (Model Context Protocol): un formato standard per fornire strumenti ad agenti AI. Ogni "strumento" è un'azione che Claude può eseguire — per esempio recuperare la lista delle pipe di trading attive.

Esistono due modalità di connessione:

| Modalità | Quando usarla |
|---|---|
| **stdio** | Integrazione locale con Claude Desktop o Claude Code — Claude avvia il server come processo figlio e comunica via stdin/stdout |
| **HTTP** | Connessione remota da un client MCP, URL connector, o automazioni — Claude chiama endpoint REST |

---

## Connessione con Claude Desktop

:::info Percorso file di configurazione
Claude Desktop (l'app macOS separata) usa un file di configurazione diverso da Claude Code CLI.
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
:::

Se il file non esiste, crealo. Il contenuto completo deve essere:

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

Sostituisci `/percorso/assoluto/mcp-gateway/server.js` con il path reale sul tuo sistema (es. `/Users/vincenzo/code/trading-system/mcp-gateway/server.js`).

Dopo aver salvato, riavvia Claude Desktop. Comparirà un'icona strumenti nella barra di chat.

---

## Connessione con Claude Code

**Claude Code CLI** usa `~/.claude/settings.json` (globale) oppure `.claude/settings.json` nella cartella del progetto.

**Metodo 1 — comando CLI (consigliato):**

```bash
claude mcp add trading-system node /percorso/assoluto/mcp-gateway/server.js
```

**Metodo 2 — modifica manuale di `~/.claude/settings.json`:**

Apri (o crea) `~/.claude/settings.json` e aggiungi/aggiorna la sezione `mcpServers`:

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

:::note
Se `~/.claude/settings.json` contiene già altre impostazioni (temi, keybindings ecc.), aggiungi solo il blocco `"mcpServers"` senza sovrascrivere il resto.
:::

---

## Connessione in modalità HTTP

Se il `mcp-gateway` è avviato con `MCP_TRANSPORT=http`, espone endpoint REST che qualsiasi client HTTP può chiamare:

```bash
# Verifica connessione
curl http://localhost:3004/mcp/health

# Elenca strumenti disponibili
curl http://localhost:3004/mcp/tools \
  -H "X-Internal-Token: $INTERNAL_TOKEN"

# Chiama uno strumento
curl -X POST http://localhost:3004/mcp/call \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -d '{"tool":"strategies_list","input":{}}'
```

:::info
In produzione il gateway è raggiungibile via Traefik al prefisso `/mcp-gateway/`. Gli endpoint diventano quindi `/mcp-gateway/mcp/health`, `/mcp-gateway/mcp/tools` ecc.
:::

---

## Strumenti disponibili

### `ping` — Test di connettività

Verifica che il gateway sia raggiungibile e risponda correttamente. Utile come primo check.

**Puoi chiedere a Claude:** *"Fai un ping al trading system"* oppure *"Il gateway MCP risponde?"*

**Input opzionale:**
```json
{ "message": "ciao" }
```
**Risposta:**
```json
{ "ok": true, "data": { "pong": true, "echo": "ciao", "ts": "2026-03-04T10:00:00.000Z" } }
```

---

### `strategies_list` — Elenco strategie (pipe)

Recupera la lista delle pipe di trading configurate nel tickerscanner, con nome, ID e stato.

**Puoi chiedere a Claude:** *"Quali strategie di trading ho attive?"* oppure *"Elenca tutte le pipe configurate"* oppure *"Mostrami la strategia con ID 5"*

**Input opzionale:**
```json
{ "pipeId": 5 }
```
Omettere `pipeId` per ricevere tutte le pipe.

**Risposta:**
```json
{
  "ok": true,
  "data": {
    "pipes": [
      { "id": 1, "name": "Growth US Equity", "userId": 7, "active": true },
      { "id": 5, "name": "ETF Rotation", "userId": 7, "active": true }
    ]
  }
}
```

---

## Esempi di domande da fare a Claude

Una volta connesso il gateway, Claude può rispondere a domande come:

- *"Quante strategie ho attive nel trading system?"*
- *"Mostrami i dettagli della pipe numero 3"*
- *"Il gateway è operativo?"*
- *"Elenca tutte le pipe di trading e dimmi quali sono ETF"*

Man mano che vengono aggiunti nuovi strumenti al gateway, le capacità di Claude si espandono automaticamente senza richiedere aggiornamenti alla configurazione.

---

## Errori comuni

| Sintomo | Causa probabile | Soluzione |
|---|---|---|
| Claude non vede il server MCP | File di configurazione non salvato o path errato | Verificare il path assoluto in `claude_desktop_config.json` e riavviare Claude Desktop |
| `ping` fallisce | `mcp-gateway` non in esecuzione | Avviare il container: `docker compose --profile mcp-gateway up -d mcp-gateway` |
| `strategies_list` restituisce errore | `tickerscanner` non raggiungibile | Verificare `TICKERSCANNER_URL` e che il container tickerscanner sia up |
| `401 Unauthorized` su HTTP | `INTERNAL_TOKEN` richiesto ma mancante | Aggiungere `-H "X-Internal-Token: <token>"` alla richiesta |
| Strumento non trovato | Tool non nella allowlist | Verificare `MCP_TOOL_ALLOWLIST` — se impostata, deve includere il nome del tool |
