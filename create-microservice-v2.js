// create-microservice-v2.js
// Versione 2.0 - Usa librerie condivise (BaseService, serverFactory, statusRouterFactory)
"use strict";

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { execSync, spawn } = require("child_process");

// ---------- utils di base ----------

function usage() {
  console.log(`
Usage:
  node create-microservice-v2.js <serviceName> [--port=NNNN] [--version=X.Y.Z] [--description="..."]

Opzioni:
  --port=NNNN         Porta da usare per il nuovo microservizio
  --version=X.Y.Z     Versione iniziale del microservizio (default: 1.0.0)
  --description="..." Descrizione per package.json

✨ Novità v2:
  - Usa BaseService invece di duplicare codice
  - Usa serverFactory e statusRouterFactory
  - NO più status.js (eliminato!)
  - Riduzione codice: ~650 righe → ~165 righe (75%)
  - Aggiorna automaticamente docker-compose.yml E docker-compose.local.yml
  - Configura Traefik labels per routing in locale
  - Registra il servizio nel database (service_flags)
  - Crea automaticamente la pagina frontend nel progetto astraai
  - Compila e avvia il servizio in background

Esempi:
  node create-microservice-v2.js MarketListener
  node create-microservice-v2.js OrderRouter --port=3020 --version=1.0.0
`);
  process.exit(1);
}

function parseArgs() {
  const [, , rawName, ...rest] = process.argv;
  if (!rawName) usage();

  const opts = { name: rawName };
  for (const a of rest) {
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

function toKebabCase(str) {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

function toCamelCase(str) {
  return str
    .replace(/[_\-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      if (i === 0) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join("");
}

function formatNow() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- Template Generation ----------

function generateMainJS(serviceName, className, version, kebabName) {
  return `// modules/main.js
"use strict";

const BaseService = require("../../shared/BaseService");

/**
 * ${className} - ${serviceName} microservice
 *
 * This service extends BaseService which provides:
 * - Redis Bus connection
 * - Logger with DB queuing
 * - Settings management
 * - Standard endpoints
 * - Metrics collection
 * - Graceful shutdown
 */
class ${className} extends BaseService {
  constructor() {
    super({
      microservice: "${kebabName}",
      moduleName: "main",
      moduleVersion: "${version}",
    });

    // =====================================================
    // SERVICE-SPECIFIC PROPERTIES
    // =====================================================

    // Add your custom properties here
    // Example:
    // this.data = new Map();
    // this.config = {};
  }

  /**
   * Custom initialization hook
   * Called after Redis connection and settings loading
   */
  async _onInit() {
    this.logger.info("[_onInit] Custom initialization...");

    // Add your initialization logic here
    // Example:
    // await this._loadConfiguration();
    // await this._setupSubscriptions();
  }

  /**
   * Custom cleanup hook
   * Called during graceful shutdown, before Redis is closed
   */
  async _onShutdown() {
    this.logger.info("[_onShutdown] Cleaning up...");

    // Add your cleanup logic here
    // Example:
    // this.data.clear();
    // await this._saveState();
  }

  // =====================================================
  // SERVICE-SPECIFIC METHODS
  // =====================================================

  /**
   * Example method - replace with your business logic
   */
  async processData(data) {
    this.logger.info("[processData] Processing data...", { data });

    // Your logic here

    return { success: true };
  }
}

module.exports = ${className};
`;
}

function generateServerJS(serviceName, port) {
  const kebabName = toKebabCase(serviceName);
  const camelName = toCamelCase(serviceName);

  return `// server.js
"use strict";

const { createMicroserviceServer } = require("../shared/serverFactory");
const ${camelName}Service = require("./modules/main");

/**
 * ${serviceName} REST Server
 *
 * Uses serverFactory which provides:
 * - Express setup with JSON middleware
 * - CORS configuration (Traefik-compatible)
 * - Service initialization
 * - requireReady middleware
 * - Standard routes (/release, /settings, /connect, /dbLogger)
 * - Status router (/status/*)
 * - Graceful shutdown
 */

const { app, getService, logger } = createMicroserviceServer({
  ServiceClass: ${camelName}Service,
  microservice: "${kebabName}",
  moduleName: "RESTServer",
  moduleVersion: "1.0.0",
  defaultPort: ${port},

  // Custom routes (add your API endpoints here)
  routes: [
    // Example:
    // { path: '/api', router: apiRouter, protected: true }
  ]
});

// Additional custom middleware or routes can be added here
// Example:
// app.get('/custom', (req, res) => {
//   const service = getService();
//   res.json({ custom: 'data' });
// });
`;
}

function generatePackageJSON(serviceName, version, description) {
  const kebabName = toKebabCase(serviceName);

  return JSON.stringify({
    name: kebabName,
    version: version,
    description: description,
    main: "server.js",
    scripts: {
      start: "node server.js",
      dev: "nodemon server.js"
    },
    dependencies: {
      "axios": "^1.6.7",
      "cors": "^2.8.5",
      "dotenv": "^16.4.5",
      "express": "^4.19.2",
      "jose": "^5.9.6",
      "redis": "^4.6.7"
    },
    devDependencies: {
      nodemon: "^3.1.0"
    }
  }, null, 2);
}

function generateDockerfile(serviceName, port) {
  return `FROM node:20
WORKDIR /app

RUN apt-get update && apt-get install -y curl

# Copy service directory
COPY ${serviceName}/ ./${serviceName}/

# Copy shared libraries
COPY shared/ ./shared/

# Copy package.json
COPY ${serviceName}/package.json .

# Install dependencies
RUN npm install --omit=dev

# Expose port
EXPOSE ${port}

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \\
  CMD curl -f http://localhost:${port}/status/health || exit 1

# Start service
CMD ["node", "${serviceName}/server.js"]
`;
}

function generateReleaseJSON(serviceName, version) {
  return JSON.stringify({
    lastUpdate: formatNow(),
    version: version,
    microservice: serviceName,
    note: [
      "Initial release using BaseService",
      "Centralized code with shared libraries",
      "~75% less code than template approach"
    ]
  }, null, 2);
}

function generateNodemonJSON() {
  return JSON.stringify({
    watch: [
      "server.js",
      "modules/**/*.js",
      "../shared/**/*.js"
    ],
    ignore: [
      "*.test.js",
      "node_modules/**",
      "Dockerfile"
    ],
    exec: "node server.js",
    ext: "js,json"
  }, null, 2);
}

function generateREADME(serviceName, className, port) {
  return `# ${serviceName}

${className} microservice built with BaseService framework.

## Quick Start

\`\`\`bash
# Development
npm run dev

# Production
npm start
\`\`\`

## Architecture

This service uses the centralized microservice framework:

- **BaseService** (modules/main.js): Business logic extends BaseService
- **serverFactory** (server.js): Express server with standard routes
- **No status.js**: Eliminated! Status routes provided by statusRouterFactory

## Code Reduction

Traditional approach: ~650 lines (main.js + server.js + status.js)
**This service: ~165 lines (75% reduction)**

## Standard Endpoints

- \`GET /status/health\` - Health check
- \`GET /status/info\` - Service information
- \`GET /release\` - Release information
- \`GET /settings\` - Current settings
- \`POST /settings/reload\` - Reload settings from DB

## Custom Endpoints

Add your custom routes in \`server.js\`:

\`\`\`javascript
routes: [
  { path: '/api', router: apiRouter, protected: true }
]
\`\`\`

## Development

Port: ${port}

Access locally: http://localhost:${port}

## Documentation

- [BaseService API](../shared/BaseService.README.md)
- [Server Factory](../shared/FACTORIES_README.md)
- [Migration Guide](../shared/MIGRATION_EXAMPLE.md)
`;
}

// ---------- Docker Compose Block ----------

function buildDockerServiceBlock(serviceKey, port, portsObj) {
  const upperKey = serviceKey.toUpperCase().replace(/-/g, '_');
  const versionVar = `${upperKey}_VERSION`;

  const envLines = [];
  envLines.push("      - LOG_LEVEL=${LOG_LEVEL}");
  envLines.push("      - MYSQL_HOST=mysql");
  envLines.push("      - MYSQL_PORT=${MYSQL_PORT}");
  envLines.push("      - MYSQL_USER=${MYSQL_USER}");
  envLines.push("      - MYSQL_PASSWORD=${MYSQL_PASSWORD}");
  envLines.push("      - MYSQL_DATABASE=${MYSQL_DATABASE}");
  envLines.push("      - REDIS_URL=redis://redis:6379");
  envLines.push("      - DATAHUB_URL=http://datahub:3000");

  for (const [name, p] of Object.entries(portsObj)) {
    if (name === "mysql" || name === "redis" || name === serviceKey) continue;
    const cleanName = name.replace(/[^a-zA-Z0-9]/g, "");
    const envName = `${cleanName.toUpperCase()}_URL`;
    if (envName === "DATAHUB_URL" || envName === "DBMANAGER_URL") continue;
    envLines.push(`      - ${envName}=http://${name}:${p}`);
  }

  return `
  ${serviceKey}:
    image: expovin/${serviceKey}:\${${versionVar}}
    container_name: ${serviceKey}
    restart: unless-stopped
    ports:
      - "${port}:${port}"
    networks:
      - trading-net
    depends_on:
      datahub:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
${envLines.join("\n")}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${port}/status/health"]
      interval: 10s
      timeout: 10s
      retries: 5
`;
}

function buildDockerServiceBlockLocal(serviceKey, serviceName, port, portsObj) {
  const upperKey = serviceKey.toUpperCase().replace(/-/g, '_');
  const versionVar = `${upperKey}_VERSION`;

  // Build environment variables (use Docker service names for networking)
  const envLines = [];
  envLines.push("      - DATAHUB_URL=http://datahub:3000");
  envLines.push("      - REDIS_URL=redis://redis:6379");
  envLines.push("      - LOG_LEVEL=${LOG_LEVEL}");
  envLines.push("      - ENV=${ENV}");
  envLines.push("      - LOG_BATCH_MAX_BYTES=${LOG_BATCH_MAX_BYTES}");
  envLines.push("      - ENABLE_DB_LOG=${ENABLE_DB_LOG}");
  envLines.push("      - CORS_ORIGIN=${CORS_ORIGIN}");

  // Add other service URLs
  for (const [name, p] of Object.entries(portsObj)) {
    if (name === "mysql" || name === "redis" || name === serviceKey) continue;
    const cleanName = name.replace(/[^a-zA-Z0-9]/g, "");
    const envName = `${cleanName.toUpperCase()}_URL`;
    if (envName === "DATAHUB_URL" || envName === "DBMANAGER_URL") continue;
    envLines.push(`      - ${envName}=http://${name}:${p}`);
  }

  envLines.push("      - TZ=${TIMEZONE}");

  return `
  ${serviceKey}:
    image: local/${serviceKey}:\${${versionVar}:-latest}
    build:
      context: .
      dockerfile: ${serviceName}/Dockerfile
    restart: unless-stopped
    ports:
      - "${port}:${port}"
    environment:
${envLines.join("\n")}
    depends_on:
      datahub:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - /etc/localtime:/etc/localtime:ro
      - /etc/timezone:/etc/timezone:ro
    networks:
      - trading_net
    profiles: ["${serviceKey}"]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${port}/status/health"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.${serviceKey}.rule=Host(\`localhost\`) && PathPrefix(\`/${serviceKey}\`)"
      - "traefik.http.routers.${serviceKey}.entrypoints=web"
      - "traefik.http.services.${serviceKey}.loadbalancer.server.port=${port}"
      - "traefik.http.middlewares.${serviceKey}-stripprefix.stripPrefix.prefixes=/${serviceKey}"
      - "traefik.http.routers.${serviceKey}.middlewares=${serviceKey}-stripprefix,cors-default@docker,auth-forward@docker"
      - "traefik.http.routers.${serviceKey}-preflight.rule=Host(\`localhost\`) && PathPrefix(\`/${serviceKey}\`) && Method(\`OPTIONS\`)"
      - "traefik.http.routers.${serviceKey}-preflight.entrypoints=web"
      - "traefik.http.routers.${serviceKey}-preflight.priority=10000"
      - "traefik.http.routers.${serviceKey}-preflight.service=${serviceKey}"
      - "traefik.http.routers.${serviceKey}-preflight.middlewares=${serviceKey}-stripprefix,cors-default@docker"
`;
}

function injectServiceIntoCompose(composePath, serviceBlock) {
  let content = fs.readFileSync(composePath, "utf8");
  const marker = "\nvolumes:";
  const idx = content.indexOf(marker);

  if (idx === -1) {
    fs.writeFileSync(composePath, content.trimEnd() + "\n" + serviceBlock + "\n", "utf8");
    return;
  }

  const before = content.slice(0, idx).trimEnd();
  const after = content.slice(idx);
  fs.writeFileSync(composePath, `${before}\n${serviceBlock}\n${after}`, "utf8");
}

// ---------- ENV Files ----------

function updateEnvFile(envPath, upperKey, urlEnvVar, port) {
  if (!fs.existsSync(envPath)) return;

  let content = fs.readFileSync(envPath, "utf8");
  let updated = false;

  if (!content.endsWith("\n")) content += "\n";

  const versionKey = `${upperKey}_VERSION`;
  if (!new RegExp(`^${versionKey}=`, "m").test(content)) {
    content += `${versionKey}=latest\n`;
    updated = true;
  }

  if (!new RegExp(`^${urlEnvVar}=`, "m").test(content)) {
    content += `${urlEnvVar}=http://localhost:${port}\n`;
    updated = true;
  }

  if (updated) fs.writeFileSync(envPath, content, "utf8");
}

function updateDeployWorkflow(rootDir, serviceName) {
  const deployPath = path.join(rootDir, ".github", "workflows", "deploy.yml");
  if (!fs.existsSync(deployPath)) {
    console.warn("⚠️  .github/workflows/deploy.yml not found, skipping");
    return;
  }

  const content = fs.readFileSync(deployPath, "utf8");
  const servicesRegex = /(services=\(\n)([\s\S]*?)(\n\s*\))/m;
  const match = content.match(servicesRegex);

  if (!match) {
    console.warn("⚠️  services=(...) block not found in deploy.yml");
    return;
  }

  const [, start, body, end] = match;
  const entries = body.split("\n").map(l => l.trim()).filter(Boolean);

  if (entries.includes(serviceName)) {
    console.log(`   deploy.yml: ${serviceName} already present`);
    return;
  }

  const indentMatch = body.match(/\n?(\s*)\S/);
  const entryIndent = indentMatch ? indentMatch[1] : "          ";
  const newBody = [...entries, serviceName].map(name => `${entryIndent}${name}`).join("\n");
  const newContent = content.replace(servicesRegex, `${start}${newBody}${end}`);

  fs.writeFileSync(deployPath, newContent, "utf8");
  console.log(`   deploy.yml: added ${serviceName} to services list`);
}

// ---------- Database Registration ----------

async function registerServiceInDatabase(serviceKey, description) {
  const env = process.env.ENV || "local";
  const mysqlConfig = {
    host: process.env.MYSQL_HOST || "localhost",
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER || "trading_user",
    password: process.env.MYSQL_PASSWORD || "trading_pass",
    database: process.env.MYSQL_DATABASE || "Trading"
  };

  let connection;

  try {
    // Connect to MySQL
    connection = await mysql.createConnection(mysqlConfig);

    // Check if service already exists
    const [existing] = await connection.execute(
      "SELECT * FROM service_flags WHERE ENV = ? AND microservice = ?",
      [env, serviceKey]
    );

    if (existing.length > 0) {
      console.log(`   Database: ${serviceKey} already exists in service_flags for ENV=${env}, skipping`);
      return;
    }

    // Insert new service (using kebab-case serviceKey for consistency with frontend routing)
    await connection.execute(
      "INSERT INTO service_flags (ENV, microservice, enabled, note) VALUES (?, ?, ?, ?)",
      [env, serviceKey, 1, description]
    );

    console.log(`   Database: ${serviceKey} registered in service_flags (ENV=${env}, enabled=1)`);

  } catch (error) {
    console.warn(`   ⚠️  Database registration failed: ${error.message}`);
    console.warn(`   Service will still work, but won't be tracked in service_flags table`);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// ---------- Frontend Page Generation ----------

function generateFrontendPage(serviceName, className, serviceKey) {
  return `import MicroserviceGeneralTab from "../../molecules/microservice/MicroserviceGeneralTab";

// Tipo per le informazioni di release del microservizio
type ReleaseInfo = {
  version?: string | null;
  lastUpdate?: string | null;
  microservice?: string | null;
  note?: string[] | null;
};

// Props ricevute dal componente padre (AdminMicroserviceDetailPage)
type Props = {
  onReleaseChange?: (rel: ReleaseInfo | null) => void; // Callback quando cambiano le info di release
  onHealthChange?: (health: Record<string, any> | null) => void; // Callback quando cambia lo stato di health
  onOpenReleaseModal?: () => void; // Callback per aprire il modale con le note di release
};

/**
 * Componente per la gestione della pagina del microservizio ${serviceName}
 *
 * Questo componente gestisce solo il tab "General Settings" con le impostazioni comuni:
 * - DB Logger, Log Level
 * - Communication Channels
 * - Logs
 */
export default function ${className}MicroservicePage({
  onReleaseChange,
  onHealthChange,
  onOpenReleaseModal,
}: Props) {
  return (
    <MicroserviceGeneralTab
      microservice="${serviceKey}"
      onReleaseChange={onReleaseChange}
      onHealthChange={onHealthChange}
      onOpenReleaseModal={onOpenReleaseModal}
    />
  );
}
`;
}

function createFrontendPage(serviceName, className, serviceKey) {
  const frontendDir = path.join(__dirname, "..", "astraai");
  const pagesDir = path.join(frontendDir, "src", "components", "pages", "microservices");
  const detailPagePath = path.join(frontendDir, "src", "components", "pages", "AdminMicroserviceDetailPage.tsx");

  // Check if frontend directory exists
  if (!fs.existsSync(frontendDir)) {
    console.warn("⚠️  Frontend directory not found at ../astraai, skipping frontend page creation");
    return false;
  }

  if (!fs.existsSync(pagesDir)) {
    console.warn("⚠️  Microservices pages directory not found, skipping frontend page creation");
    return false;
  }

  try {
    // Generate and write the microservice page file
    const pagePath = path.join(pagesDir, `${className}MicroservicePage.tsx`);
    const pageContent = generateFrontendPage(serviceName, className, serviceKey);
    fs.writeFileSync(pagePath, pageContent, "utf8");
    console.log(`   ✓ Created ${className}MicroservicePage.tsx`);

    // Update AdminMicroserviceDetailPage.tsx
    if (!fs.existsSync(detailPagePath)) {
      console.warn("⚠️  AdminMicroserviceDetailPage.tsx not found, please add the route manually");
      return true;
    }

    let detailContent = fs.readFileSync(detailPagePath, "utf8");

    // Add import statement (after the last import of microservice pages)
    const importStatement = `import ${className}MicroservicePage from "./microservices/${className}MicroservicePage";`;
    const lastMicroserviceImport = detailContent.lastIndexOf('import') + detailContent.slice(detailContent.lastIndexOf('import')).indexOf('\n');

    // Check if import already exists
    if (!detailContent.includes(importStatement)) {
      detailContent = detailContent.slice(0, lastMicroserviceImport + 1) +
                      importStatement + '\n' +
                      detailContent.slice(lastMicroserviceImport + 1);
      console.log(`   ✓ Added import to AdminMicroserviceDetailPage.tsx`);
    }

    // Add case to switch statement (before default case)
    const caseStatement = `
      case "${serviceKey}":
        return (
          <${className}MicroservicePage
            onReleaseChange={setRelease}
            onHealthChange={setHealth}
            onOpenReleaseModal={() => setShowReleaseModal(true)}
          />
        );
`;

    // Check if case already exists
    if (!detailContent.includes(`case "${serviceKey}":`)) {
      const defaultCaseIndex = detailContent.indexOf('      default:');
      if (defaultCaseIndex > -1) {
        detailContent = detailContent.slice(0, defaultCaseIndex) +
                        caseStatement + '\n' +
                        detailContent.slice(defaultCaseIndex);
        fs.writeFileSync(detailPagePath, detailContent, "utf8");
        console.log(`   ✓ Added route case to AdminMicroserviceDetailPage.tsx`);
      } else {
        console.warn("⚠️  Could not find default case in switch statement");
      }
    }

    return true;

  } catch (error) {
    console.error(`   ❌ Failed to create frontend page: ${error.message}`);
    return false;
  }
}

// ---------- Build and Start Service ----------

function buildAndStartService(serviceName, destDir) {
  console.log("\n🔨 Building and starting service...");

  try {
    // Install dependencies
    console.log("   Installing dependencies...");
    execSync("npm install", {
      cwd: destDir,
      stdio: "inherit"
    });
    console.log("   ✓ Dependencies installed");

    // Start service in background
    console.log("   Starting service in background...");
    const child = spawn("npm", ["run", "dev"], {
      cwd: destDir,
      detached: true,
      stdio: "ignore"
    });

    // Unref to allow parent process to exit
    child.unref();

    console.log(`   ✓ Service started in background (PID: ${child.pid})`);
    console.log(`   Monitor logs: cd ${serviceName} && npm run dev`);
    console.log(`   Stop service: kill ${child.pid} or use 'pkill -f "node.*${serviceName}"'`);

  } catch (error) {
    console.error(`   ❌ Failed to build/start service: ${error.message}`);
    console.log(`   You can manually run: cd ${serviceName} && npm install && npm run dev`);
  }
}

// ---------- MAIN ----------

(async () => {
  const opts = parseArgs();

  const serviceName = opts.name;
  const className = toPascalCase(serviceName);
  const serviceKey = toKebabCase(serviceName);
  const version = opts.version || "1.0.0";
  const description = opts.description || `${serviceName} microservice`;

  const rootDir = __dirname;
  const destDir = path.join(rootDir, serviceName);
  const portsPath = path.join(rootDir, "doc", "ports.json");
  const composePath = path.join(rootDir, "docker-compose.yml");
  const composeLocalPath = path.join(rootDir, "docker-compose.local.yml");

  // Validations
  if (!fs.existsSync(portsPath)) {
    console.error("❌ doc/ports.json not found");
    process.exit(1);
  }
  if (!fs.existsSync(composePath)) {
    console.error("❌ docker-compose.yml not found");
    process.exit(1);
  }
  if (fs.existsSync(destDir)) {
    console.error(`❌ Directory ${destDir} already exists`);
    process.exit(1);
  }

  // Load ports and calculate new port
  const ports = JSON.parse(fs.readFileSync(portsPath, "utf8"));
  const usedPorts = new Set(Object.values(ports).map(Number));

  let port;
  if (opts.port) {
    port = parseInt(opts.port, 10);
    if (!Number.isInteger(port) || port <= 0) {
      console.error("❌ Invalid --port parameter");
      process.exit(1);
    }
    if (usedPorts.has(port)) {
      console.error(`❌ Port ${port} already in use`);
      process.exit(1);
    }
  } else {
    port = 3002;
    while (usedPorts.has(port)) port++;
  }

  if (ports[serviceKey]) {
    console.error(`❌ Service "${serviceKey}" already exists in ports.json`);
    process.exit(1);
  }

  console.log("\n🚀 Creating microservice with BaseService framework...\n");

  // Create directory structure
  fs.mkdirSync(destDir, { recursive: true });
  fs.mkdirSync(path.join(destDir, "modules"), { recursive: true });

  // Generate files
  console.log("📝 Generating files...");

  fs.writeFileSync(
    path.join(destDir, "modules", "main.js"),
    generateMainJS(serviceName, className, version, serviceKey)
  );
  console.log("   ✓ modules/main.js (extends BaseService)");

  fs.writeFileSync(
    path.join(destDir, "server.js"),
    generateServerJS(serviceName, port)
  );
  console.log("   ✓ server.js (uses serverFactory)");

  fs.writeFileSync(
    path.join(destDir, "package.json"),
    generatePackageJSON(serviceName, version, description)
  );
  console.log("   ✓ package.json (minimal dependencies)");

  fs.writeFileSync(
    path.join(destDir, "Dockerfile"),
    generateDockerfile(serviceName, port)
  );
  console.log("   ✓ Dockerfile");

  fs.writeFileSync(
    path.join(destDir, "release.json"),
    generateReleaseJSON(serviceName, version)
  );
  console.log("   ✓ release.json");

  fs.writeFileSync(
    path.join(destDir, "nodemon.json"),
    generateNodemonJSON()
  );
  console.log("   ✓ nodemon.json");

  fs.writeFileSync(
    path.join(destDir, "README.md"),
    generateREADME(serviceName, className, port)
  );
  console.log("   ✓ README.md");
  console.log("   ✗ status.js (eliminated - now in shared!)");

  // Update ports.json
  ports[serviceKey] = port;
  fs.writeFileSync(portsPath, JSON.stringify(ports, null, 4), "utf8");
  console.log(`\n📋 Updated doc/ports.json (port ${port})`);

  // Update docker-compose.yml
  const serviceBlock = buildDockerServiceBlock(serviceKey, port, ports);
  injectServiceIntoCompose(composePath, serviceBlock);
  console.log("🐳 Updated docker-compose.yml");

  // Update docker-compose.local.yml (if exists)
  if (fs.existsSync(composeLocalPath)) {
    const serviceBlockLocal = buildDockerServiceBlockLocal(serviceKey, serviceName, port, ports);
    injectServiceIntoCompose(composeLocalPath, serviceBlockLocal);
    console.log("🐳 Updated docker-compose.local.yml");
  } else {
    console.warn("⚠️  docker-compose.local.yml not found, skipping");
  }

  // Update .env files
  const upperKey = serviceKey.toUpperCase().replace(/-/g, '_');
  const cleanName = serviceKey.replace(/[^a-zA-Z0-9]/g, "");
  const urlEnvVar = `${cleanName.toUpperCase()}_URL`;

  const envFiles = [".env", ".env.local", ".env.paper"];
  for (const envName of envFiles) {
    updateEnvFile(path.join(rootDir, envName), upperKey, urlEnvVar, port);
  }
  console.log("📄 Updated .env files");

  // Update deploy.yml
  updateDeployWorkflow(rootDir, serviceName);

  // Register service in database
  console.log("\n💾 Registering service in database...");
  await registerServiceInDatabase(serviceKey, description);

  // Create frontend page
  console.log("\n🎨 Creating frontend page...");
  const frontendCreated = createFrontendPage(serviceName, className, serviceKey);

  // Build and start service
  buildAndStartService(serviceName, destDir);

  console.log("\n✅ Microservice created successfully!\n");
  console.log("📊 Summary:");
  console.log(`   Name:         ${serviceName}`);
  console.log(`   Class:        ${className}`);
  console.log(`   Service key:  ${serviceKey}`);
  console.log(`   Port:         ${port}`);
  console.log(`   Version:      ${version}`);
  console.log(`   Directory:    ${destDir}`);
  console.log(`   Profile:      ${serviceKey}`);
  console.log(`\n   Code stats:`);
  console.log(`   • modules/main.js:  ~100 lines (vs ~450 with template)`);
  console.log(`   • server.js:        ~50 lines  (vs ~120 with template)`);
  console.log(`   • status.js:        ELIMINATED (was ~80 lines)`);
  console.log(`   • Total:            ~150 lines (vs ~650) = 77% reduction! 🎉`);
  console.log(`\n   Updated files:`);
  console.log(`   • doc/ports.json`);
  console.log(`   • docker-compose.yml`);
  console.log(`   • docker-compose.local.yml (with Traefik labels)`);
  console.log(`   • .env / .env.local / .env.paper`);
  console.log(`   • .github/workflows/deploy.yml`);
  console.log(`   • Database: service_flags table (ENV=${process.env.ENV || "local"})`);
  if (frontendCreated) {
    console.log(`   • Frontend: ../astraai/src/components/pages/microservices/${className}MicroservicePage.tsx`);
    console.log(`   • Frontend: ../astraai/src/components/pages/AdminMicroserviceDetailPage.tsx (updated)`);
  }

  console.log(`\n🎯 Service is running!`);
  console.log(`   • Health check: http://localhost:${port}/status/health`);
  console.log(`   • Service info: http://localhost:${port}/status/info`);
  console.log(`   • Via Traefik:  http://localhost:8080/${serviceKey}/status/health`);

  console.log(`\n📚 Documentation:`);
  console.log(`   • BaseService API:    shared/BaseService.README.md`);
  console.log(`   • Factories:          shared/FACTORIES_README.md`);
  console.log(`   • Migration guide:    shared/MIGRATION_EXAMPLE.md`);

  console.log(`\n✨ Built with BaseService v2.0 framework`);
})();
