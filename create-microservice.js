// create-microservice.js
"use strict";

const fs = require("fs");
const path = require("path");

// ---------- utils di base ----------

function usage() {
  console.log(`
Usage:
  node create-microservice.js <serviceName> [--port=NNNN] [--version=X.Y.Z] [--description="..."] [--refactor]

Opzioni:
  --port=NNNN        Porta da usare per il nuovo microservizio (se non in refactor)
  --version=X.Y.Z    Versione iniziale del microservizio (default: 0.1.0)
  --description="..."Descrizione per package.json
  --refactor         Refactoring di un microservizio ESISTENTE:
                     - rinomina la cartella esistente in <ServiceName>_backup_...
                     - riusa la porta già presente in doc/ports.json
                     - NON modifica doc/ports.json, docker-compose.yml, .env*

Esempi:
  node create-microservice.js MarketListener
  node create-microservice.js OrderRouter --port=3020 --version=0.2.0 --description="Order routing microservice"
  node create-microservice.js tickerScanner --refactor
`);
  process.exit(1);
}

function parseArgs() {
  const [, , rawName, ...rest] = process.argv;
  if (!rawName) usage();

  const opts = { name: rawName };
  for (const a of rest) {
    // flag booleano --refactor
    if (a === "--refactor") {
      opts.refactor = true;
      continue;
    }

    // parametri tipo --key=value
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim();
    opts[key] = val;
  }
  return opts;
}

function toPascalCase(str) {
  return str
    .replace(/[_\-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

function formatNow() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function makeBackupSuffix() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function replaceInFile(filePath, replacements) {
  let content = fs.readFileSync(filePath, "utf8");
  for (const [placeholder, value] of Object.entries(replacements)) {
    const re = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    content = content.replace(re, value);
  }
  fs.writeFileSync(filePath, content, "utf8");
}

// blocco URL per main.js (this.xxxUrl = process.env.XXX_URL || "http://name:port")
function buildServiceUrlBlock(ports) {
  const lines = [];
  lines.push("    // Auto-generated service URLs from doc/ports.json");
  for (const [name, p] of Object.entries(ports)) {
    if (name === "mysql" || name === "redis") continue;
    const cleanName = name.replace(/[^a-zA-Z0-9]/g, "");
    const varName = `${cleanName}Url`;               // es: dbmanagerUrl
    const envVar = `${cleanName.toUpperCase()}_URL`; // es: DBMANAGER_URL
    lines.push(
      `    this.${varName} = process.env.${envVar} || "http://${name}:${p}";`
    );
  }
  return lines.join("\n");
}

// blocco YAML del servizio da iniettare in docker-compose.yml
function buildDockerServiceBlock(serviceKey, port, portsObj) {
  const upperKey = serviceKey.toUpperCase();
  const versionVar = `${upperKey}_VERSION`;

  const envLines = [];
  // base env: MYSQL, LOG, REDIS, DBMANAGER
  envLines.push("      - LOG_LEVEL=${LOG_LEVEL}");
  envLines.push("      - MYSQL_HOST=mysql");
  envLines.push("      - MYSQL_PORT=${MYSQL_PORT}");
  envLines.push("      - MYSQL_USER=${MYSQL_USER}");
  envLines.push("      - MYSQL_PASSWORD=${MYSQL_PASSWORD}");
  envLines.push("      - MYSQL_DATABASE=${MYSQL_DATABASE}");
  envLines.push("      - REDIS_URL=redis://redis:6379");
  envLines.push("      - DBMANAGER_URL=http://dbmanager:3002");

  // URL di tutti gli altri microservizi presenti in ports.json
  for (const [name, p] of Object.entries(portsObj)) {
    if (name === "mysql" || name === "redis" || name === serviceKey) continue;

    const cleanName = name.replace(/[^a-zA-Z0-9]/g, "");
    const envName = `${cleanName.toUpperCase()}_URL`;
    if (envName === "DBMANAGER_URL") continue; // già aggiunto sopra

    envLines.push(`      - ${envName}=http://${name}:${p}`);
  }

  const block = `
  ${serviceKey}:
    image: expovin/${serviceKey}:\${${versionVar}}
    container_name: ${serviceKey}
    restart: unless-stopped
    ports:
      - "${port}:${port}"
    networks:
      - trading-net
    depends_on:
      dbmanager:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
${envLines.join("\n")}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${port}/health"]
      interval: 10s
      timeout: 10s
      retries: 5
`;
  return block;
}

// inserisce il blocco servizio prima della sezione "volumes:" in docker-compose.yml
function injectServiceIntoCompose(composePath, serviceBlock) {
  let content = fs.readFileSync(composePath, "utf8");

  const marker = "\nvolumes:";
  const idx = content.indexOf(marker);

  if (idx === -1) {
    // se non troviamo volumes, appendiamo in fondo
    const newContent = content.trimEnd() + "\n" + serviceBlock + "\n";
    fs.writeFileSync(composePath, newContent, "utf8");
    return;
  }

  const before = content.slice(0, idx).trimEnd();
  const after = content.slice(idx);
  const newContent = `${before}\n${serviceBlock}\n${after}`;
  fs.writeFileSync(composePath, newContent, "utf8");
}

// ---------- aggiornamento .env / .env.local / .env.paper ----------

function updateEnvFile(envPath, upperKey, urlEnvVar, port) {
  if (!fs.existsSync(envPath)) return;

  let content = fs.readFileSync(envPath, "utf8");
  let updated = false;

  const ensureNewlineEnd = () => {
    if (!content.endsWith("\n")) content += "\n";
  };

  const versionKey = `${upperKey}_VERSION`;
  const versionRegex = new RegExp(`^${versionKey}=`, "m");
  if (!versionRegex.test(content)) {
    ensureNewlineEnd();
    content += `${versionKey}=latest\n`;
    updated = true;
  }

  const urlRegex = new RegExp(`^${urlEnvVar}=`, "m");
  if (!urlRegex.test(content)) {
    ensureNewlineEnd();
    content += `${urlEnvVar}=http://localhost:${port}\n`;
    updated = true;
  }

  if (updated) {
    fs.writeFileSync(envPath, content, "utf8");
  }
}

// aggiorna .github/workflows/deploy.yml aggiungendo il servizio nel blocco services=(...)
function updateDeployWorkflow(rootDir, serviceName) {
  const deployPath = path.join(rootDir, ".github", "workflows", "deploy.yml");
  if (!fs.existsSync(deployPath)) {
    console.warn("⚠️  .github/workflows/deploy.yml non trovato, skip aggiornamento services");
    return;
  }

  const content = fs.readFileSync(deployPath, "utf8");
  const servicesRegex = /(services=\(\n)([\s\S]*?)(\n\s*\))/m;
  const match = content.match(servicesRegex);

  if (!match) {
    console.warn("⚠️  Blocco services=(...) non trovato in deploy.yml, nessuna modifica");
    return;
  }

  const [, start, body, end] = match;
  const entries = body
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  if (entries.includes(serviceName)) {
    console.log(`   deploy.yml: ${serviceName} già presente in services, nessuna modifica`);
    return;
  }

  const indentMatch = body.match(/\n?(\s*)\S/);
  const entryIndent = indentMatch ? indentMatch[1] : "          ";
  const newBody = [...entries, serviceName].map(name => `${entryIndent}${name}`).join("\n");
  const newContent = content.replace(servicesRegex, `${start}${newBody}${end}`);

  fs.writeFileSync(deployPath, newContent, "utf8");
  console.log(`   deploy.yml: aggiunto ${serviceName} nella lista services`);
}

// ---------- main ----------

(async () => {
  const opts = parseArgs();

  const serviceName = opts.name; // es: MarketListener
  const serviceKey = serviceName.toLowerCase().replace(/\s+/g, ""); // es: marketlistener
  const className  = toPascalCase(serviceName);                     // es: MarketListener
  const version    = opts.version || "0.1.0";
  const description = opts.description || `Microservice ${serviceName}`;

  const rootDir      = __dirname;
  const templateDir  = path.join(rootDir, "__TemplateService");
  const destDir      = path.join(rootDir, serviceName);
  const portsPath    = path.join(rootDir, "doc", "ports.json");
  const composePath  = path.join(rootDir, "docker-compose.yml");

  if (!fs.existsSync(templateDir)) {
    console.error("Template folder __TemplateService non trovato nella root.");
    process.exit(1);
  }
  if (!fs.existsSync(portsPath)) {
    console.error("doc/ports.json non trovato.");
    process.exit(1);
  }
  if (!fs.existsSync(composePath)) {
    console.error("docker-compose.yml non trovato nella root.");
    process.exit(1);
  }

  // Se la cartella esiste e siamo in refactor → rinomina
  if (fs.existsSync(destDir)) {
    if (opts.refactor) {
      const suffix = makeBackupSuffix();
      const backupDir = `${destDir}_backup_${suffix}`;
      fs.renameSync(destDir, backupDir);
      console.log(`   Refactor: cartella esistente rinominata in ${backupDir}`);
    } else {
      console.error(`La cartella di destinazione ${destDir} esiste già.`);
      process.exit(1);
    }
  }

  // ---- carica ports.json e calcola porta ----
  const ports = JSON.parse(fs.readFileSync(portsPath, "utf8"));
  const existingPort = ports[serviceKey]; // può essere undefined

  const usedPorts = new Set(Object.values(ports).map(Number));
  let port;

  if (opts.refactor) {
    // in refactor dobbiamo avere già una porta definita
    if (!existingPort) {
      console.error(
        `--refactor richiesto ma il servizio "${serviceKey}" non è presente in doc/ports.json.`
      );
      process.exit(1);
    }
    port = existingPort;
    console.log(`   Refactor: uso la porta esistente ${port} da doc/ports.json`);
  } else {
    // comportamento standard (no refactor)
    if (existingPort) {
      console.error(
        `Il microservizio "${serviceKey}" esiste già in doc/ports.json (porta ${existingPort}).`
      );
      process.exit(1);
    }

    if (opts.port) {
      const p = parseInt(opts.port, 10);
      if (!Number.isInteger(p) || p <= 0) {
        console.error("Parametro --port non valido.");
        process.exit(1);
      }
      if (usedPorts.has(p)) {
        console.error(`La porta ${p} è già utilizzata. Scegli un'altra porta o ometti --port.`);
        process.exit(1);
      }
      port = p;
    } else {
      // auto-assegna da 3002 in su
      port = 3002;
      while (usedPorts.has(port)) port++;
    }

    // aggiorna ports.json SOLO se non è refactor
    ports[serviceKey] = port;
    fs.writeFileSync(portsPath, JSON.stringify(ports, null, 4), "utf8");
  }

  // ---- copia template ----
  fs.cpSync(templateDir, destDir, { recursive: true });

  // ---- sostituzioni nei file ----

  // main.js
  const mainPath = path.join(destDir, "modules", "main.js");
  replaceInFile(mainPath, {
    "__MICROSERVICE_NAME__": serviceName,
    "__CLASS_NAME__": className,
    "__MODULE_VERSION__": version
  });

  // inietta blocco URL microservizi se presente il placeholder
  let mainContent = fs.readFileSync(mainPath, "utf8");
  if (mainContent.includes("__SERVICE_URLS_BLOCK__")) {
    const block = buildServiceUrlBlock(ports);
    mainContent = mainContent.replace("__SERVICE_URLS_BLOCK__", block);
    fs.writeFileSync(mainPath, mainContent, "utf8");
  }

  // server.js
  const serverPath = path.join(destDir, "server.js");
  replaceInFile(serverPath, {
    "__MICROSERVICE_NAME__": serviceName,
    "__REST_MODULE_NAME__": "RESTServer",
    "__MODULE_VERSION__": version,
    "__PORT__": String(port)
  });

  // package.json
  const pkgPath = path.join(destDir, "package.json");
  replaceInFile(pkgPath, {
    "__MICROSERVICE_NAME__": serviceName,
    "__VERSION__": version,
    "__DESCRIPTION__": description
  });

  // Dockerfile
  const dockerPath = path.join(destDir, "Dockerfile");
  replaceInFile(dockerPath, {
    "__SERVICE_FOLDER__": serviceName,
    "__PORT__": String(port)
  });

  // release.json
  const relPath = path.join(destDir, "release.json");
  replaceInFile(relPath, {
    "__LAST_UPDATE__": formatNow(),
    "__VERSION__": version,
    "__MICROSERVICE_NAME__": serviceName
  });

  // nodemon.json
  const nodemonPath = path.join(destDir, "nodemon.json");
  if (fs.existsSync(nodemonPath)) {
    replaceInFile(nodemonPath, {
      "__SERVICE_MAIN_FILE__": "modules/main.js"
    });
  }

  // ---- aggiorna docker-compose.yml con nuovo servizio (solo se NON refactor) ----
  if (!opts.refactor) {
    const serviceBlock = buildDockerServiceBlock(serviceKey, port, ports);
    injectServiceIntoCompose(composePath, serviceBlock);
  }

  // ---- aggiorna .env, .env.local, .env.paper (solo se NON refactor) ----
  if (!opts.refactor) {
    const upperKey = serviceKey.toUpperCase();
    const cleanName = serviceKey.replace(/[^a-zA-Z0-9]/g, "");
    const urlEnvVar = `${cleanName.toUpperCase()}_URL`;

    const envFiles = [".env", ".env.local", ".env.paper"];
    for (const envName of envFiles) {
      const envPath = path.join(rootDir, envName);
      updateEnvFile(envPath, upperKey, urlEnvVar, port);
    }

    updateDeployWorkflow(rootDir, serviceName);
  }

  console.log("✅ Microservizio creato:");
  console.log(`   Nome:        ${serviceName}`);
  console.log(`   Service key: ${serviceKey}`);
  console.log(`   Classe:      ${className}`);
  console.log(`   Porta:       ${port}`);
  console.log(`   Versione:    ${version}`);
  console.log(`   Cartella:    ${destDir}`);
  console.log(`   Docker:      ${opts.refactor ? "NON modificato (refactor)" : "entry aggiunta in docker-compose.yml"}`);
  console.log(`   ENV:         ${opts.refactor ? "NON modificate (refactor)" : "variabili aggiunte a .env / .env.local / .env.paper (se esistono)"}`);
})();
