---
sidebar_position: 7
title: DevSpot — Sviluppo AI da mobile
---

# Guida completa

> Obiettivo: avviare una VM spot GCP on-demand dall'iPhone con un tap,
> che espone un MCP server accessibile via Cloudflare Tunnel.
> Claude (e altri AI) leggono, modificano e testano il codice tramite
> conversazione. Il push su Git è sempre esplicito — mai automatico.

---

## Indice

1. [Account e credenziali necessari](#1-account-e-credenziali-necessari)
2. [Architettura del sistema](#2-architettura-del-sistema)
3. [Step 1 — Preparazione GCP](#3-step-1--preparazione-gcp)
4. [Step 2 — Cloudflare Tunnel (una volta sola)](#4-step-2--cloudflare-tunnel-una-volta-sola)
5. [Step 3 — Codice: mcp-dev-server](#5-step-3--codice-mcp-dev-server)
6. [Step 4 — Codice: startup.sh](#6-step-4--codice-startupsh)
7. [Step 5 — Codice: Cloud Function](#7-step-5--codice-cloud-function)
8. [Step 6 — Deploy Cloud Function](#8-step-6--deploy-cloud-function)
9. [Step 7 — Shortcut iPhone](#9-step-7--shortcut-iphone)
10. [Step 8 — Configurare Claude e ChatGPT](#10-step-8--configurare-claude-e-chatgpt)
11. [Step 9 — Workflow di sviluppo](#11-step-9--workflow-di-sviluppo)
12. [Step 10 — Commit del codice nel repo](#12-step-10--commit-del-codice-nel-repo)
13. [Verifica end-to-end](#13-verifica-end-to-end)
14. [Costi stimati](#14-costi-stimati)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Account e credenziali necessari

### Google Cloud Platform

| Cosa | Dove | Note |
|------|------|------|
| Project ID | Console GCP → homepage → "Project info" | Usato ovunque |
| Zona | `europe-west1-b` consigliata | Bassa latenza da Dubai |
| Service Account | Da creare allo Step 1 | Per la Cloud Function |

```bash
# Installare gcloud CLI
brew install google-cloud-sdk   # macOS
# oppure: curl https://sdk.cloud.google.com | bash

# Login
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

---

### GitHub

| Cosa | Dove | Note |
|------|------|------|
| Personal Access Token | github.com/settings/tokens/new | Tipo: classic |
| Username | Il tuo username | |
| Email | Email account GitHub | |
| Repo/i | es. `vincenzo/trading-system` | CSV se multipli |

**Creare il token:**
1. https://github.com/settings/tokens/new
2. Note: `mcp-dev-server` — Expiration: `No expiration`
3. Scopes: `repo` (tutto) + `workflow`
4. Generate — copiare immediatamente

---

### Anthropic (Claude)

| Cosa | Dove | Note |
|------|------|------|
| Account claude.ai | claude.ai | Per chat da mobile |
| API Key | console.anthropic.com → API Keys | Solo per Claude Desktop su Mac |

**Aggiungere MCP in Claude Desktop:**
`~/Library/Application Support/Claude/claude_desktop_config.json`

---

### OpenAI (ChatGPT)

| Cosa | Dove | Note |
|------|------|------|
| Account ChatGPT | chatgpt.com | Per chat da mobile |

**Aggiungere MCP:** Settings → Connected apps → Add MCP server

---

### Cloudflare

| Cosa | Dove | Note |
|------|------|------|
| Account | cloudflare.com | Gratuito |
| Dominio configurato | Già fatto nel setup precedente | |
| Tunnel Token | Da creare allo Step 2 | Token fisso — non cambia mai |

---

### Telegram Bot

```bash
# 1. Su Telegram: @BotFather → /newbot → segui le istruzioni
# 2. Copia il token (formato: 123456789:ABC-DEF...)
# 3. Manda /start al tuo nuovo bot
# 4. Ottieni il chat ID:
curl "https://api.telegram.org/bot<TOKEN>/getUpdates" | jq '.result[0].message.chat.id'
```

---

### Token di sicurezza da generare

```bash
openssl rand -hex 32   # → TRIGGER_TOKEN  (per lo shortcut iPhone)
openssl rand -hex 32   # → MCP_DEV_TOKEN  (per Claude/ChatGPT)
```

Salvare in Note con Face ID o password manager.

---

## 2. Architettura del sistema

```
iPhone
  │
  ├─ Tap shortcut → Cloud Function HTTPS
  │                   └─ Crea VM spot GCP
  │                        Nessuna firewall rule necessaria
  │                        Nessuna porta aperta
  │                        └─ Startup script:
  │                              1. git clone repo
  │                              2. avvia mcp-dev-server :3099
  │                              3. avvia cloudflared (tunnel)
  │                                   └─ connessione uscente verso Cloudflare
  │                              4. programma auto-shutdown 2h
  │
  ├─ Notifica Telegram: "✅ VM pronta — https://spotdev.tuodominio.com"
  │    URL sempre fisso — nessuna riconfigurazione Claude/ChatGPT
  │
  └─ Chat Claude.ai / ChatGPT da mobile
         │
         Claude → https://spotdev.tuodominio.com/mcp
                    └─ Cloudflare riceve la richiesta
                    └─ La passa al tunnel attivo sulla VM
                    └─ Il tunnel la consegna a localhost:3099
                    └─ Risponde mcp-dev-server
```

### Perché il Tunnel è meglio del DDNS

| Aspetto | DDNS (vecchio) | Cloudflare Tunnel |
|---------|----------------|-------------------|
| Firewall rule GCP | Necessaria | ❌ Non serve |
| Porte aperte su internet | Sì (3099) | ❌ Nessuna |
| Aggiornamento DNS all'avvio | Sì | ❌ Non serve |
| Tempo propagazione DNS | 1-2 minuti | Istantaneo |
| HTTPS | No (HTTP) | ✅ Automatico |
| Sicurezza | Porta esposta | Connessione solo uscente |
| Variabili env Cloud Function | Molte (DDNS + firewall) | Solo il tunnel token |

Il tunnel è una connessione **uscente** dalla VM verso Cloudflare —
nessuno può raggiungere la VM direttamente. Cloudflare fa da proxy
e consegna solo il traffico autorizzato.

---

## 3. Step 1 — Preparazione GCP

```bash
# Abilitare API
gcloud services enable \
  compute.googleapis.com \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com

# Service Account
gcloud iam service-accounts create dev-vm-manager \
  --display-name "Dev VM Manager"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:dev-vm-manager@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/compute.instanceAdmin.v1"
```

**Nessuna firewall rule da creare** — con il Tunnel non servono
porte aperte. Il Service Account non ha più bisogno del ruolo
`compute.securityAdmin`.

---

## 4. Step 2 — Cloudflare Tunnel (una volta sola)

Questa configurazione si fa una volta sola. Il token generato è
permanente e viene riusato ad ogni avvio della VM.

### 4.1 Creare il tunnel

```
Cloudflare Dashboard → Zero Trust → Networks → Tunnels
→ Create a tunnel
→ Connector type: Cloudflared
→ Nome tunnel: spotdev-vm
→ Save tunnel
→ Nella schermata successiva scegli: Docker
→ Copia il TOKEN (stringa lunga dopo --token)
   Salvarlo come CLOUDFLARE_TUNNEL_TOKEN
```

### 4.2 Configurare il hostname pubblico

```
Nel tunnel appena creato → Public Hostnames → Add a public hostname:

  Subdomain:  spotdev
  Domain:     tuodominio.com
  Type:       HTTP
  URL:        localhost:3099

→ Save hostname
```

Da questo momento `https://spotdev.tuodominio.com` è l'URL fisso
del MCP server — funziona ogni volta che la VM è accesa e il tunnel
è attivo, non risponde quando la VM è spenta.

### 4.3 Opzionale — Cloudflare Access (protezione aggiuntiva)

Il MCP server ha già autenticazione Bearer token. Se si vuole un
layer aggiuntivo di protezione a livello Cloudflare:

```
Zero Trust → Access → Applications → Add an application
→ Self-hosted
→ Application name: spotdev-mcp
→ Domain: spotdev.tuodominio.com
→ Policies: aggiungi email o altri criteri
```

Per uso personale con Bearer token è sufficiente — Access è opzionale.

---

## 5. Step 3 — Codice: mcp-dev-server

Creare la directory `mcp-dev-server/` nella root del repo.

### `mcp-dev-server/package.json`

```json
{
  "name": "mcp-dev-server",
  "version": "1.0.0",
  "main": "server.js",
  "type": "commonjs",
  "scripts": { "start": "node server.js" },
  "dependencies": {}
}
```

### `mcp-dev-server/server.js`

```javascript
"use strict";

const http  = require("http");
const path  = require("path");
const fs    = require("fs");
const { exec } = require("child_process");

const PORT           = Number(process.env.MCP_DEV_PORT)  || 3099;
const TOKEN          = process.env.MCP_DEV_TOKEN         || "";
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT        || "/workspace";

const ALLOWED_COMMANDS = [
  "npm ", "node ", "npx ",
  "docker compose ", "docker-compose ",
  "docker build ", "docker logs ", "docker ps",
  "git status", "git diff", "git log",
  "ls ", "cat ", "find ", "grep ",
  "df ", "du ", "free ", "curl ",
];

const ALLOWED_CONTAINERS = (process.env.ALLOWED_CONTAINERS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

function safePath(p) {
  const abs = path.resolve(WORKSPACE_ROOT, p.replace(/^\//, ""));
  if (!abs.startsWith(WORKSPACE_ROOT)) throw new Error(`Path non consentito: ${p}`);
  return abs;
}

function isAllowed(cmd) {
  return ALLOWED_COMMANDS.some(prefix => cmd.trim().startsWith(prefix));
}

function execSafe(cmd, cwd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: cwd || WORKSPACE_ROOT, timeout: 60000, maxBuffer: 1024 * 1024 * 10 },
      (err, stdout, stderr) => err ? reject(new Error(stderr || err.message)) : resolve(stdout));
  });
}

function jsonBody(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise(resolve => {
    let d = "";
    req.on("data", c => d += c);
    req.on("end", () => { try { resolve(JSON.parse(d || "{}")); } catch { resolve({}); } });
  });
}

const tools = {

  // ── Filesystem ───────────────────────────────────────────────────────────

  read_file: async ({ path: p }) => {
    const content = fs.readFileSync(safePath(p), "utf8");
    return { path: p, content, size: content.length };
  },

  write_file: async ({ path: p, content }) => {
    const abs = safePath(p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
    return { ok: true, path: p, size: content.length };
  },

  list_directory: async ({ path: p = ".", depth = 2 }) => {
    const abs = safePath(p);
    function walk(dir, d) {
      if (d > depth) return [];
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => !e.name.startsWith(".") && e.name !== "node_modules")
        .map(e => {
          const rel = path.relative(WORKSPACE_ROOT, path.join(dir, e.name));
          if (e.isDirectory())
            return { name: e.name, type: "dir", path: rel,
              children: walk(path.join(dir, e.name), d + 1) };
          return { name: e.name, type: "file", path: rel,
            size: fs.statSync(path.join(dir, e.name)).size };
        });
    }
    return { path: p, entries: walk(abs, 1) };
  },

  search_files: async ({ pattern, directory = ".", file_pattern = "*" }) => {
    const abs = safePath(directory);
    const out = await execSafe(
      `grep -r --include="${file_pattern}" -n -l "${pattern.replace(/"/g, '\\"')}" "${abs}" 2>/dev/null | head -50`
    );
    const files = out.trim().split("\n").filter(Boolean);
    const results = [];
    for (const f of files.slice(0, 10)) {
      try {
        const lines = await execSafe(`grep -n "${pattern.replace(/"/g, '\\"')}" "${f}" | head -20`);
        results.push({ file: path.relative(WORKSPACE_ROOT, f),
          matches: lines.trim().split("\n").filter(Boolean) });
      } catch { /**/ }
    }
    return { pattern, total_files: files.length, results };
  },

  exec_command: async ({ command, cwd = "." }) => {
    if (!isAllowed(command)) throw new Error(`Comando non consentito: "${command}"`);
    const output = await execSafe(command, safePath(cwd));
    return { ok: true, command, output: output.trim() };
  },

  // ── Git — lettura ─────────────────────────────────────────────────────────

  git_status: async ({ directory = "." }) => {
    const cwd = safePath(directory);
    const [status, branch] = await Promise.all([
      execSafe("git status --short", cwd),
      execSafe("git rev-parse --abbrev-ref HEAD", cwd),
    ]);
    return {
      branch: branch.trim(),
      changes: status.trim().split("\n").filter(Boolean)
        .map(line => ({ status: line.slice(0, 2).trim(), file: line.slice(3) })),
    };
  },

  git_diff: async ({ directory = ".", file = null }) => {
    const diff = await execSafe(
      `git diff ${file ? `-- "${file}"` : ""}`, safePath(directory));
    return { diff: diff.trim() };
  },

  git_log: async ({ directory = ".", limit = 10 }) => {
    const log = await execSafe(
      `git log --oneline --decorate -${Number(limit) || 10}`, safePath(directory));
    return { commits: log.trim().split("\n").filter(Boolean)
      .map(line => { const [h, ...r] = line.split(" "); return { hash: h, message: r.join(" ") }; }) };
  },

  // ── Git — scrittura (SOLO su richiesta esplicita) ─────────────────────────

  git_create_branch: async ({ branch_name, directory = "." }) => {
    await execSafe(`git checkout -b "${branch_name}"`, safePath(directory));
    return { ok: true, branch: branch_name };
  },

  git_commit_push: async ({ message, branch, directory = "." }) => {
    // Chiamato SOLO su richiesta esplicita dell'utente dopo verifica sulla VM.
    // "branch" è required e senza default — impedisce push accidentali.
    if (!message) throw new Error("message obbligatorio");
    if (!branch)  throw new Error("branch obbligatorio — specificare esplicitamente");
    const cwd = safePath(directory);
    const current = (await execSafe("git rev-parse --abbrev-ref HEAD", cwd)).trim();
    if (current !== branch) await execSafe(`git checkout ${branch}`, cwd);
    await execSafe("git add -A", cwd);
    const staged = await execSafe("git diff --cached --name-only", cwd);
    if (!staged.trim()) return { ok: false, message: "Nessuna modifica da committare" };
    const diffStat = await execSafe("git diff --cached --stat", cwd);
    await execSafe(`git commit -m "${message.replace(/"/g, '\\"')}"`, cwd);
    await execSafe(`git push origin ${branch}`, cwd);
    const last = await execSafe("git log --oneline -1", cwd);
    return { ok: true, branch, commit: last.trim(), diff_stat: diffStat.trim() };
  },

  // ── Docker ────────────────────────────────────────────────────────────────

  docker_ps: async () => {
    const out = await execSafe(
      "docker ps --format '{{.Names}}\\t{{.Status}}\\t{{.Ports}}'");
    return { containers: out.trim().split("\n").filter(Boolean)
      .map(line => { const [n, s, p] = line.split("\t");
        return { name: n, status: s, ports: p }; }) };
  },

  docker_logs: async ({ container, lines = 50 }) => {
    const out = await execSafe(
      `docker logs --tail ${Number(lines) || 50} ${container} 2>&1`);
    return { container, logs: out.trim().split("\n") };
  },

  docker_restart: async ({ container }) => {
    if (ALLOWED_CONTAINERS.length > 0 && !ALLOWED_CONTAINERS.includes(container))
      throw new Error(`Container non consentito: ${container}`);
    await execSafe(`docker restart ${container}`);
    return { ok: true, container };
  },

  docker_compose_build: async ({ service = null, directory = ".", no_cache = false }) => {
    const cmd = `docker compose build ${no_cache ? "--no-cache" : ""} ${service || ""} 2>&1`;
    const output = await execSafe(cmd, safePath(directory));
    return { ok: true, output: output.trim() };
  },

  docker_compose_up: async ({ service = null, directory = ".", build = true }) => {
    const cmd = `docker compose up -d ${build ? "--build" : ""} ${service || ""}`;
    const output = await execSafe(cmd, safePath(directory));
    return { ok: true, output: output.trim() };
  },
};

const TOOLS_SCHEMA = [
  { name: "read_file", description: "Legge un file dal workspace",
    inputSchema: { type: "object",
      properties: { path: { type: "string", description: "Path relativo a WORKSPACE_ROOT" } },
      required: ["path"] } },

  { name: "write_file", description: "Scrive o sovrascrive un file nel workspace",
    inputSchema: { type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"] } },

  { name: "list_directory", description: "Elenca file e directory",
    inputSchema: { type: "object",
      properties: { path: { type: "string", default: "." }, depth: { type: "number", default: 2 } } } },

  { name: "search_files", description: "Cerca testo nei file con grep",
    inputSchema: { type: "object",
      properties: { pattern: { type: "string" }, directory: { type: "string", default: "." },
        file_pattern: { type: "string", default: "*" } },
      required: ["pattern"] } },

  { name: "exec_command",
    description: "Esegue comando bash (whitelist: npm, node, docker compose/build/logs/ps, git status/diff/log, ls, cat, grep, curl)",
    inputSchema: { type: "object",
      properties: { command: { type: "string" }, cwd: { type: "string", default: "." } },
      required: ["command"] } },

  { name: "git_status", description: "Branch corrente e file modificati",
    inputSchema: { type: "object",
      properties: { directory: { type: "string", default: "." } } } },

  { name: "git_diff", description: "Diff modifiche non committate",
    inputSchema: { type: "object",
      properties: { directory: { type: "string", default: "." },
        file: { type: "string", description: "File specifico (opzionale)" } } } },

  { name: "git_log", description: "Ultimi N commit",
    inputSchema: { type: "object",
      properties: { directory: { type: "string", default: "." },
        limit: { type: "number", default: 10 } } } },

  { name: "git_create_branch", description: "Crea e fa checkout di un nuovo branch",
    inputSchema: { type: "object",
      properties: { branch_name: { type: "string" }, directory: { type: "string", default: "." } },
      required: ["branch_name"] } },

  { name: "git_commit_push",
    description: "SOLO SU RICHIESTA ESPLICITA: commit + push. Il branch è obbligatorio e senza default per evitare push accidentali.",
    inputSchema: { type: "object",
      properties: {
        message:   { type: "string", description: "Messaggio di commit" },
        branch:    { type: "string", description: "Branch target — es: main, develop, feature/xxx" },
        directory: { type: "string", default: "." },
      },
      required: ["message", "branch"] } },

  { name: "docker_ps", description: "Lista container Docker attivi",
    inputSchema: { type: "object", properties: {} } },

  { name: "docker_logs", description: "Ultimi N log di un container",
    inputSchema: { type: "object",
      properties: { container: { type: "string" }, lines: { type: "number", default: 50 } },
      required: ["container"] } },

  { name: "docker_restart", description: "Riavvia un container Docker",
    inputSchema: { type: "object",
      properties: { container: { type: "string" } },
      required: ["container"] } },

  { name: "docker_compose_build", description: "docker compose build sulla VM spot per test",
    inputSchema: { type: "object",
      properties: { service: { type: "string" }, directory: { type: "string", default: "." },
        no_cache: { type: "boolean", default: false } } } },

  { name: "docker_compose_up", description: "docker compose up -d sulla VM spot per test",
    inputSchema: { type: "object",
      properties: { service: { type: "string" }, directory: { type: "string", default: "." },
        build: { type: "boolean", default: true } } } },
];

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname !== "/health") {
    const auth = req.headers["authorization"] || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!TOKEN || token !== TOKEN) return jsonBody(res, { error: "Unauthorized" }, 401);
  }

  if (url.pathname === "/health")
    return jsonBody(res, { ok: true, workspace: WORKSPACE_ROOT, tools: Object.keys(tools).length });

  if (url.pathname === "/mcp" && req.method === "POST") {
    const body = await readBody(req);
    if (body.method === "initialize")
      return jsonBody(res, { protocolVersion: "2024-11-05", capabilities: { tools: {} },
        serverInfo: { name: "mcp-dev-server", version: "1.0.0" } });
    if (body.method === "tools/list")
      return jsonBody(res, { tools: TOOLS_SCHEMA });
    if (body.method === "tools/call") {
      const { name, arguments: args = {} } = body.params || {};
      const handler = tools[name];
      if (!handler) return jsonBody(res, { error: `Tool non trovato: ${name}` }, 404);
      try {
        const result = await handler(args);
        return jsonBody(res, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (err) {
        return jsonBody(res, { content: [{ type: "text", text: `Errore: ${err.message}` }], isError: true });
      }
    }
    return jsonBody(res, { error: `Metodo non supportato: ${body.method}` }, 400);
  }
  return jsonBody(res, { error: "Not found" }, 404);
});

server.listen(PORT, () => {
  console.log(`[mcp-dev-server] Porta: ${PORT} | Workspace: ${WORKSPACE_ROOT}`);
  console.log(`[mcp-dev-server] Auth: ${TOKEN ? "ON" : "⚠️  DISABILITATA"}`);
  console.log(`[mcp-dev-server] Tools (${Object.keys(tools).length}): ${Object.keys(tools).join(", ")}`);
});
```

---

## 6. Step 4 — Codice: startup.sh

Salvare come `mcp-dev-server/startup.sh` — `chmod +x` dopo.

```bash
#!/bin/bash
# startup.sh — avvio automatico VM spot dev con Cloudflare Tunnel
set -e

GITHUB_TOKEN="${GITHUB_TOKEN:-}"
GITHUB_USER="${GITHUB_USER:-}"
GITHUB_EMAIL="${GITHUB_EMAIL:-}"
REPOS="${REPOS:-}"
MCP_DEV_TOKEN="${MCP_DEV_TOKEN:-}"
CLOUDFLARE_TUNNEL_TOKEN="${CLOUDFLARE_TUNNEL_TOKEN:-}"
TELEGRAM_TOKEN="${TELEGRAM_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
AUTO_SHUTDOWN_MINUTES="${AUTO_SHUTDOWN_MINUTES:-120}"
WORKSPACE="/workspace"
MCP_DEV_PORT=3099

exec > >(tee -a /var/log/startup.log) 2>&1
echo "=== mcp-dev startup $(date) ==="

# 1. Dipendenze
echo "[1/5] Dipendenze sistema..."
apt-get update -qq
apt-get install -y -qq curl git jq nodejs npm docker.io docker-compose-v2
systemctl start docker || true

# 2. Clone repo
echo "[2/5] Clone repository..."
mkdir -p "$WORKSPACE"
IFS=',' read -ra REPO_LIST <<< "$REPOS"
for REPO in "${REPO_LIST[@]}"; do
  REPO=$(echo "$REPO" | xargs)
  REPO_NAME=$(basename "$REPO")
  TARGET="$WORKSPACE/$REPO_NAME"
  if [ -d "$TARGET/.git" ]; then
    git -C "$TARGET" pull --ff-only || true
  else
    git clone "https://${GITHUB_TOKEN}@github.com/${REPO}.git" "$TARGET"
  fi
done
git config --global user.email "$GITHUB_EMAIL"
git config --global user.name  "$GITHUB_USER"
echo "https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com" > /root/.git-credentials
git config --global credential.helper store

# 3. mcp-dev-server
echo "[3/5] Setup mcp-dev-server..."
FIRST_REPO_NAME=$(basename "$(echo "${REPO_LIST[0]}" | xargs)")
MCP_SOURCE="$WORKSPACE/$FIRST_REPO_NAME/mcp-dev-server"
MCP_DIR="/opt/mcp-dev-server"
mkdir -p "$MCP_DIR"
[ -d "$MCP_SOURCE" ] && cp -r "$MCP_SOURCE/." "$MCP_DIR/"
cd "$MCP_DIR" && npm install --omit=dev --silent 2>/dev/null || true

cat > /etc/mcp-dev.env <<EOF
MCP_DEV_PORT=${MCP_DEV_PORT}
MCP_DEV_TOKEN=${MCP_DEV_TOKEN}
WORKSPACE_ROOT=${WORKSPACE}
ALLOWED_CONTAINERS=tickerscanner,cachemanager,decision-engine,datahub,alertingservice,scheduler
EOF

cat > /etc/systemd/system/mcp-dev.service <<EOF
[Unit]
Description=MCP Dev Server
After=network.target
[Service]
Type=simple
User=root
WorkingDirectory=${MCP_DIR}
EnvironmentFile=/etc/mcp-dev.env
ExecStart=/usr/bin/node ${MCP_DIR}/server.js
Restart=always
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable mcp-dev
systemctl restart mcp-dev
sleep 2
echo "  → mcp-dev: $(systemctl is-active mcp-dev)"

# 4. Cloudflare Tunnel
echo "[4/5] Avvio Cloudflare Tunnel..."
docker run -d \
  --name cloudflared \
  --restart always \
  --network host \
  cloudflare/cloudflared:latest \
  tunnel --no-autoupdate run --token "${CLOUDFLARE_TUNNEL_TOKEN}"

sleep 3
echo "  → cloudflared: $(docker inspect --format='{{.State.Status}}' cloudflared)"

# 5. Auto-shutdown + notifica Telegram
echo "[5/5] Auto-shutdown in ${AUTO_SHUTDOWN_MINUTES} min..."
cat > /usr/local/bin/safe-shutdown.sh <<SHUTDOWN_EOF
#!/bin/bash
docker stop cloudflared 2>/dev/null || true
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
  -d chat_id="${TELEGRAM_CHAT_ID}" \
  -d text="🔴 Dev VM spenta (auto dopo ${AUTO_SHUTDOWN_MINUTES} min)" 2>/dev/null || true
shutdown -h now
SHUTDOWN_EOF
chmod +x /usr/local/bin/safe-shutdown.sh
systemd-run --on-active="${AUTO_SHUTDOWN_MINUTES}min" /usr/local/bin/safe-shutdown.sh

# Notifica Telegram — URL sempre fisso, nessun IP da comunicare
if [ -n "$TELEGRAM_TOKEN" ]; then
  MSG="✅ Dev VM pronta

🔧 MCP: https://spotdev.tuodominio.com/mcp
💻 Health: https://spotdev.tuodominio.com/health
📁 Repo: ${REPOS}
⏱ Auto-shutdown: ${AUTO_SHUTDOWN_MINUTES} min

(Nessuna riconfigurazione Claude necessaria — URL sempre fisso)"

  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" \
    -d text="$MSG" 2>/dev/null || true
fi

echo "=== Setup completato ==="
```

---

## 7. Step 5 — Codice: Cloud Function

Molto più semplice rispetto alla versione DDNS — nessuna logica
firewall, nessuna variabile DNS.

### `cloud-function/package.json`

```json
{
  "name": "mcp-dev-cloud-function",
  "version": "1.0.0",
  "dependencies": { "@google-cloud/compute": "^4.4.0" }
}
```

### `cloud-function/index.js`

```javascript
"use strict";
const { InstancesClient } = require("@google-cloud/compute");

const PROJECT       = process.env.GCP_PROJECT;
const ZONE          = process.env.GCP_ZONE          || "europe-west1-b";
const TRIGGER_TOKEN = process.env.TRIGGER_TOKEN     || "";
const VM_NAME       = process.env.VM_NAME           || "mobile-dev-vm";
const MACHINE_TYPE  = process.env.MACHINE_TYPE      || "e2-medium";

const ENV = {
  GITHUB_TOKEN:             process.env.GITHUB_TOKEN             || "",
  GITHUB_USER:              process.env.GITHUB_USER              || "",
  GITHUB_EMAIL:             process.env.GITHUB_EMAIL             || "",
  REPOS:                    process.env.REPOS                    || "",
  MCP_DEV_TOKEN:            process.env.MCP_DEV_TOKEN            || "",
  CLOUDFLARE_TUNNEL_TOKEN:  process.env.CLOUDFLARE_TUNNEL_TOKEN  || "",
  TELEGRAM_TOKEN:           process.env.TELEGRAM_TOKEN           || "",
  TELEGRAM_CHAT_ID:         process.env.TELEGRAM_CHAT_ID         || "",
  AUTO_SHUTDOWN_MINUTES:    process.env.AUTO_SHUTDOWN_MINUTES     || "120",
};

const FIRST_REPO = ENV.REPOS.split(",")[0].trim();

// Startup script: esporta variabili e scarica startup.sh dal repo
const STARTUP_SCRIPT = [
  "#!/bin/bash",
  ...Object.entries(ENV).map(([k, v]) => `export ${k}="${v}"`),
  `curl -fsSL "https://raw.githubusercontent.com/${FIRST_REPO}/main/mcp-dev-server/startup.sh" \\`,
  `  -H "Authorization: token ${ENV.GITHUB_TOKEN}" | bash`,
].join("\n");

const client = new InstancesClient();

async function getVM() {
  try {
    const [vm] = await client.get({ project: PROJECT, zone: ZONE, instance: VM_NAME });
    return vm;
  } catch (e) {
    if (e.code === 5 || String(e).includes("not found")) return null;
    throw e;
  }
}

exports.startDevVM = async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (!TRIGGER_TOKEN || req.query.token !== TRIGGER_TOKEN)
    return res.status(403).json({ ok: false, error: "Unauthorized" });

  try {
    let vm = await getVM();
    let action = "none";

    if (!vm) {
      // Crea VM spot — nessuna firewall rule necessaria grazie al Tunnel
      const [op] = await client.insert({
        project: PROJECT, zone: ZONE,
        instanceResource: {
          name: VM_NAME,
          machineType: `zones/${ZONE}/machineTypes/${MACHINE_TYPE}`,
          scheduling: {
            preemptible: false, automaticRestart: false,
            onHostMaintenance: "TERMINATE",
            provisioningModel: "SPOT",
            instanceTerminationAction: "STOP",
          },
          disks: [{ boot: true, autoDelete: true, initializeParams: {
            sourceImage: "projects/debian-cloud/global/images/family/debian-12",
            diskSizeGb: "20", diskType: `zones/${ZONE}/diskTypes/pd-ssd`,
          }}],
          networkInterfaces: [{ network: "global/networks/default",
            accessConfigs: [{ type: "ONE_TO_ONE_NAT", name: "External NAT" }] }],
          metadata: { items: [{ key: "startup-script", value: STARTUP_SCRIPT }] },
          // Nessun tag firewall necessario — il Tunnel è una connessione uscente
        },
      });
      await op.promise();
      action = "created";
    } else if (["TERMINATED", "STOPPED"].includes(vm.status)) {
      const [op] = await client.start({ project: PROJECT, zone: ZONE, instance: VM_NAME });
      await op.promise();
      action = "started";
    } else if (vm.status === "RUNNING") {
      action = "already_running";
    }

    return res.json({
      ok: true, action, status: vm?.status,
      message: action === "already_running"
        ? "VM già attiva — https://spotdev.tuodominio.com/mcp"
        : "VM in avvio — notifica Telegram in ~2-3 min",
      mcp_url: "https://spotdev.tuodominio.com/mcp",
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};

exports.stopDevVM = async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (!TRIGGER_TOKEN || req.query.token !== TRIGGER_TOKEN)
    return res.status(403).json({ ok: false, error: "Unauthorized" });
  try {
    const vm = await getVM();
    if (!vm || vm.status !== "RUNNING")
      return res.json({ ok: true, action: "already_stopped" });
    const [op] = await client.stop({ project: PROJECT, zone: ZONE, instance: VM_NAME });
    await op.promise();
    return res.json({ ok: true, action: "stopped" });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
```

---

## 8. Step 6 — Deploy Cloud Function

```bash
cd mcp-dev-server/cloud-function

gcloud functions deploy startDevVM \
  --runtime nodejs20 \
  --trigger-http \
  --allow-unauthenticated \
  --service-account dev-vm-manager@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --region europe-west1 \
  --set-env-vars "\
GCP_PROJECT=YOUR_PROJECT_ID,\
GCP_ZONE=europe-west1-b,\
TRIGGER_TOKEN=IL_TUO_TRIGGER_TOKEN,\
VM_NAME=mobile-dev-vm,\
MACHINE_TYPE=e2-medium,\
GITHUB_TOKEN=ghp_IL_TUO_TOKEN,\
GITHUB_USER=IL_TUO_USERNAME,\
GITHUB_EMAIL=tua@email.com,\
REPOS=vincenzo/trading-system,\
MCP_DEV_TOKEN=IL_TUO_MCP_TOKEN,\
CLOUDFLARE_TUNNEL_TOKEN=IL_TOKEN_DEL_TUNNEL,\
TELEGRAM_TOKEN=IL_BOT_TOKEN,\
TELEGRAM_CHAT_ID=IL_CHAT_ID,\
AUTO_SHUTDOWN_MINUTES=120"

# stopDevVM con le stesse variabili
gcloud functions deploy stopDevVM \
  --runtime nodejs20 --trigger-http --allow-unauthenticated \
  --service-account dev-vm-manager@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --region europe-west1 \
  --set-env-vars "..."

# Test immediato
curl "https://europe-west1-YOUR_PROJECT.cloudfunctions.net/startDevVM?token=IL_TUO_TRIGGER_TOKEN"
# → {"ok":true,"action":"created","mcp_url":"https://spotdev.tuodominio.com/mcp"}
```

---

## 9. Step 7 — Shortcut iPhone

Aprire l'app **Shortcuts** su iPhone.

**Shortcut "Dev VM":**

Blocco 1 — Get Contents of URL
```
URL: https://europe-west1-YOUR_PROJECT.cloudfunctions.net/startDevVM?token=IL_TUO_TRIGGER_TOKEN
Method: GET
```

Blocco 2 — Show Notification
```
Title: Dev VM
Body: "Avvio in corso... riceverai notifica Telegram"
```

**Aggiungere alla Home Screen:** tasto tre puntini → "Aggiungi alla schermata Home".

---

## 10. Step 8 — Configurare Claude e ChatGPT

URL fisso — configurare una volta sola, non cambia mai:
```
https://spotdev.tuodominio.com/mcp
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "dev-tools": {
      "url": "https://spotdev.tuodominio.com/mcp",
      "headers": { "Authorization": "Bearer IL_TUO_MCP_TOKEN" }
    }
  }
}
```
Riavviare Claude Desktop dopo la modifica.

### Claude.ai (mobile)

Settings → Connectors → Add MCP server
```
URL:   https://spotdev.tuodominio.com/mcp
Token: IL_TUO_MCP_TOKEN
```

### ChatGPT

Settings → Connected apps → Add MCP server — stessi valori.

---

## 11. Step 9 — Workflow di sviluppo

```
1. TAP shortcut iPhone
   └─ VM avviata, nessuna porta aperta, nessun firewall

2. ~2 min dopo — Notifica Telegram:
   "✅ Dev VM pronta
    MCP: https://spotdev.tuodominio.com/mcp"
   URL già raggiungibile — nessuna propagazione DNS

3. ANALISI
   "Analizza fmp.js e descrivi il bug del fallback silenzioso"
   └─ Claude usa read_file

4. MODIFICA
   "Implementa il fix"
   └─ Claude usa write_file

5. BUILD + TEST sulla VM spot
   "Builda cacheManager e mostrami i log"
   └─ Claude usa docker_compose_build + docker_compose_up + docker_logs

6. ITERAZIONE se necessario
   "C'è un errore — correggi e rebuilda"

7. VERIFICA
   "Mostrami il diff di tutto quello che hai modificato"
   └─ Claude usa git_diff

8. PUSH — solo su richiesta esplicita con branch specificato
   "Ok funziona. Commit e push su branch fix/fmp-fallback"
   └─ Claude mostra le modifiche → git_commit_push

9. AUTO-SHUTDOWN dopo 2h
   └─ cloudflared si ferma → tunnel diventa Inactive su Cloudflare
   └─ https://spotdev.tuodominio.com dà errore (VM spenta — corretto)
   └─ Notifica Telegram: "🔴 Dev VM spenta"
```

**Regola sul git push:** `branch` è parametro obbligatorio senza
default — Claude non può fare push senza che tu specifichi
esplicitamente il branch target.

---

## 12. Step 10 — Commit del codice nel repo

```bash
cd trading-system

mkdir -p mcp-dev-server/cloud-function

# Creare i file:
# mcp-dev-server/server.js       ← da Step 3
# mcp-dev-server/package.json    ← da Step 3
# mcp-dev-server/startup.sh      ← da Step 4
# mcp-dev-server/cloud-function/index.js      ← da Step 5
# mcp-dev-server/cloud-function/package.json  ← da Step 5

echo "node_modules/" > mcp-dev-server/.gitignore
chmod +x mcp-dev-server/startup.sh

git add mcp-dev-server/
git commit -m "feat: add mcp-dev-server with Cloudflare Tunnel"
git push
```

---

## 13. Verifica end-to-end

```bash
# 1. Tap shortcut iPhone
#    → {"ok":true,"action":"created","mcp_url":"https://spotdev.tuodominio.com/mcp"}

# 2. ~2 min dopo: notifica Telegram "✅ Dev VM pronta"

# 3. Health check — già HTTPS, nessun IP da sapere
curl https://spotdev.tuodominio.com/health \
  -H "Authorization: Bearer IL_TUO_MCP_TOKEN"
# → {"ok":true,"workspace":"/workspace","tools":15}

# 4. Lista strumenti
curl -X POST https://spotdev.tuodominio.com/mcp \
  -H "Authorization: Bearer IL_TUO_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/list"}'
# → {"tools":[...15 strumenti...]}

# 5. Test da Claude
# → "Elenca i file nel workspace" → Claude chiama list_directory

# 6. Test modifica + build
# → "Modifica RuleEngine.js e builda alertingService"
# → Claude: write_file + docker_compose_build + docker_logs

# 7. Test push
# → "Push su branch test/mcp-dev"
# → Claude mostra diff → commit+push → verifica su GitHub

# 8. Verifica tunnel su Cloudflare
# Zero Trust → Networks → Tunnels → spotdev-vm
# → Status: Active (VM accesa) o Inactive (VM spenta)
```

---

## 14. Costi stimati

| Voce | Costo |
|------|-------|
| VM spot `e2-medium` accesa | ~$0.01-0.02/ora |
| 4 ore/mese utilizzo totale | ~$0.06/mese |
| Cloud Function | $0 |
| Disco VM (autoDelete=true) | $0 |
| Cloudflare Tunnel | $0 (piano Free) |
| Firewall rule | $0 (non serve) |
| **Totale mensile** | **~$0.10/mese** |

---

## 15. Troubleshooting

**MCP server non raggiungibile**
```bash
# Verifica stato tunnel su Cloudflare Dashboard
# Zero Trust → Networks → Tunnels → spotdev-vm
# Se "Inactive": VM spenta → tap shortcut iPhone
# Se "Active" ma non risponde: cloudflared crashato sulla VM

# SSH sulla VM per debug
gcloud compute ssh mobile-dev-vm -- docker logs cloudflared
gcloud compute ssh mobile-dev-vm -- systemctl status mcp-dev
```

**Tunnel non si connette**
```bash
# Il token potrebbe essere scaduto o non copiato correttamente
# Cloudflare → Zero Trust → Tunnels → spotdev-vm → Configure
# → copia di nuovo il token e aggiorna la Cloud Function

gcloud functions deploy startDevVM --update-env-vars \
  CLOUDFLARE_TUNNEL_TOKEN=NUOVO_TOKEN
```

**mcp-dev-server non parte**
```bash
gcloud compute ssh mobile-dev-vm -- systemctl status mcp-dev
gcloud compute ssh mobile-dev-vm -- cat /var/log/startup.log
```

**git push fallisce**
```bash
gcloud compute ssh mobile-dev-vm -- cat /root/.git-credentials
# Verificare che il token GitHub abbia scopes: repo + workflow
```

**Claude non vede gli strumenti**
```bash
# Test diretto
curl -X POST https://spotdev.tuodominio.com/mcp \
  -H "Authorization: Bearer IL_TUO_MCP_TOKEN" \
  -d '{"method":"tools/list"}'
# Se 401: MCP_DEV_TOKEN errato
# Se timeout: VM spenta o tunnel non attivo
```
