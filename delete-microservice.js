// delete-microservice.js
// Script per eliminare un microservizio esistente
"use strict";

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const readline = require("readline");

// ---------- utils di base ----------

function usage() {
  console.log(`
Usage:
  node delete-microservice.js <serviceName>

⚠️  ATTENZIONE:
  Questo script elimina un microservizio esistente:
  - Rimuove da docker-compose.yml e docker-compose.local.yml
  - Rimuove da doc/ports.json
  - Rimuove da .env files
  - Rimuove da .github/workflows/deploy.yml
  - Cancella dal database (service_flags)
  - Rimuove la pagina frontend
  - Rinomina la cartella in .DELETED_<timestamp>

Esempi:
  node delete-microservice.js MarketListener
  node delete-microservice.js liquidity-manager
`);
  process.exit(1);
}

function parseArgs() {
  const [, , rawName] = process.argv;
  if (!rawName) usage();
  return { name: rawName };
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

function makeTimestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// ---------- User Confirmation ----------

async function confirmDeletion(serviceName) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`\n⚠️  Are you sure you want to delete microservice "${serviceName}"? (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

// ---------- Remove from Docker Compose ----------

function removeFromDockerCompose(composePath, serviceKey) {
  if (!fs.existsSync(composePath)) {
    console.warn(`⚠️  ${composePath} not found, skipping`);
    return false;
  }

  try {
    const content = fs.readFileSync(composePath, "utf8");
    const lines = content.split('\n');
    const result = [];
    let i = 0;
    let found = false;
    let removed = false;

    while (i < lines.length) {
      const line = lines[i];

      // Check if this line is the service definition we want to remove
      // Format: "  servicename:" at the beginning of the line
      if (line.match(new RegExp(`^  ${serviceKey}:\\s*$`))) {
        found = true;
        removed = true;
        i++; // Skip the service name line

        // Skip all lines that belong to this service (indented with more than 2 spaces)
        while (i < lines.length) {
          const nextLine = lines[i];

          // If we hit a line that starts with 0-2 spaces followed by a non-whitespace char,
          // or an empty line followed by such a line, we've reached the next section
          if (nextLine.match(/^[a-z]/i) || nextLine.match(/^volumes:/i) || nextLine.match(/^networks:/i)) {
            // This is a top-level section, stop here
            break;
          } else if (nextLine.match(/^  [a-z]/i) && !nextLine.match(/^    /)) {
            // This is another service (starts with exactly 2 spaces + letter), stop here
            break;
          } else if (nextLine.trim() === '' && i + 1 < lines.length) {
            // Empty line - check if next line is a new section
            const lineAfterEmpty = lines[i + 1];
            if (lineAfterEmpty.match(/^[a-z]/i) ||
                lineAfterEmpty.match(/^volumes:/i) ||
                lineAfterEmpty.match(/^networks:/i) ||
                (lineAfterEmpty.match(/^  [a-z]/i) && !lineAfterEmpty.match(/^    /))) {
              // Next section is coming, include this empty line but stop after
              i++;
              break;
            }
          }

          // This line belongs to the service we're removing, skip it
          i++;
        }

        continue;
      }

      // Keep this line
      result.push(line);
      i++;
    }

    if (removed) {
      // Clean up multiple consecutive empty lines
      let cleanResult = [];
      let lastWasEmpty = false;
      for (const line of result) {
        const isEmpty = line.trim() === '';
        if (isEmpty && lastWasEmpty) {
          continue; // Skip consecutive empty lines
        }
        cleanResult.push(line);
        lastWasEmpty = isEmpty;
      }

      fs.writeFileSync(composePath, cleanResult.join('\n'), "utf8");
      console.log(`   ✓ Removed from ${path.basename(composePath)}`);
      return true;
    } else {
      console.warn(`   ⚠️  Service "${serviceKey}" not found in ${path.basename(composePath)}`);
      return false;
    }
  } catch (error) {
    console.error(`   ❌ Failed to remove from ${path.basename(composePath)}: ${error.message}`);
    return false;
  }
}

// ---------- Remove from ports.json ----------

function removeFromPorts(portsPath, serviceKey) {
  if (!fs.existsSync(portsPath)) {
    console.warn("⚠️  doc/ports.json not found, skipping");
    return false;
  }

  try {
    const ports = JSON.parse(fs.readFileSync(portsPath, "utf8"));

    if (ports[serviceKey]) {
      delete ports[serviceKey];
      fs.writeFileSync(portsPath, JSON.stringify(ports, null, 4), "utf8");
      console.log("   ✓ Removed from doc/ports.json");
      return true;
    } else {
      console.warn(`   ⚠️  Service "${serviceKey}" not found in ports.json`);
      return false;
    }
  } catch (error) {
    console.error(`   ❌ Failed to remove from ports.json: ${error.message}`);
    return false;
  }
}

// ---------- Remove from .env files ----------

function removeFromEnvFile(envPath, upperKey, urlEnvVar) {
  if (!fs.existsSync(envPath)) return false;

  try {
    let content = fs.readFileSync(envPath, "utf8");
    let updated = false;

    const versionKey = `${upperKey}_VERSION`;
    const versionRegex = new RegExp(`^${versionKey}=.*\\n?`, "m");
    if (versionRegex.test(content)) {
      content = content.replace(versionRegex, "");
      updated = true;
    }

    const urlRegex = new RegExp(`^${urlEnvVar}=.*\\n?`, "m");
    if (urlRegex.test(content)) {
      content = content.replace(urlRegex, "");
      updated = true;
    }

    if (updated) {
      fs.writeFileSync(envPath, content, "utf8");
      return true;
    }
    return false;
  } catch (error) {
    console.error(`   ❌ Failed to remove from ${path.basename(envPath)}: ${error.message}`);
    return false;
  }
}

// ---------- Remove from deploy.yml ----------

function removeFromDeployWorkflow(rootDir, serviceName) {
  const deployPath = path.join(rootDir, ".github", "workflows", "deploy.yml");
  if (!fs.existsSync(deployPath)) {
    console.warn("⚠️  .github/workflows/deploy.yml not found, skipping");
    return false;
  }

  try {
    const content = fs.readFileSync(deployPath, "utf8");
    const servicesRegex = /(services=\(\n)([\s\S]*?)(\n\s*\))/m;
    const match = content.match(servicesRegex);

    if (!match) {
      console.warn("⚠️  services=(...) block not found in deploy.yml");
      return false;
    }

    const [, start, body, end] = match;
    const entries = body
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .filter(name => name !== serviceName);

    if (entries.length === body.split("\n").filter(Boolean).length) {
      console.warn(`   ⚠️  Service "${serviceName}" not found in deploy.yml`);
      return false;
    }

    const indentMatch = body.match(/\n?(\s*)\S/);
    const entryIndent = indentMatch ? indentMatch[1] : "          ";
    const newBody = entries.map(name => `${entryIndent}${name}`).join("\n");
    const newContent = content.replace(servicesRegex, `${start}${newBody}${end}`);

    fs.writeFileSync(deployPath, newContent, "utf8");
    console.log("   ✓ Removed from deploy.yml");
    return true;
  } catch (error) {
    console.error(`   ❌ Failed to remove from deploy.yml: ${error.message}`);
    return false;
  }
}

// ---------- Remove from Database ----------

async function removeFromDatabase(serviceKey, serviceName) {
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
    connection = await mysql.createConnection(mysqlConfig);

    // Try to delete using kebab-case serviceKey first (new format)
    let [result] = await connection.execute(
      "DELETE FROM service_flags WHERE ENV = ? AND microservice = ?",
      [env, serviceKey]
    );

    if (result.affectedRows > 0) {
      console.log(`   ✓ Removed from database (${result.affectedRows} row(s) deleted)`);
      return true;
    }

    // If not found, try with original serviceName (old format for backward compatibility)
    [result] = await connection.execute(
      "DELETE FROM service_flags WHERE ENV = ? AND microservice = ?",
      [env, serviceName]
    );

    if (result.affectedRows > 0) {
      console.log(`   ✓ Removed from database using legacy name (${result.affectedRows} row(s) deleted)`);
      return true;
    }

    console.warn(`   ⚠️  Service "${serviceKey}" or "${serviceName}" not found in database for ENV=${env}`);
    return false;
  } catch (error) {
    console.warn(`   ⚠️  Database deletion failed: ${error.message}`);
    return false;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// ---------- Remove Frontend Page ----------

function removeFrontendPage(serviceName, className, serviceKey) {
  const frontendDir = path.join(__dirname, "..", "astraai");
  const pagesDir = path.join(frontendDir, "src", "components", "pages", "microservices");
  const detailPagePath = path.join(frontendDir, "src", "components", "pages", "AdminMicroserviceDetailPage.tsx");

  if (!fs.existsSync(frontendDir)) {
    console.warn("⚠️  Frontend directory not found, skipping");
    return false;
  }

  let success = false;

  try {
    // Remove page file
    const pagePath = path.join(pagesDir, `${className}MicroservicePage.tsx`);
    if (fs.existsSync(pagePath)) {
      fs.unlinkSync(pagePath);
      console.log(`   ✓ Removed ${className}MicroservicePage.tsx`);
      success = true;
    } else {
      console.warn(`   ⚠️  ${className}MicroservicePage.tsx not found`);
    }

    // Update AdminMicroserviceDetailPage.tsx
    if (!fs.existsSync(detailPagePath)) {
      console.warn("⚠️  AdminMicroserviceDetailPage.tsx not found");
      return success;
    }

    let detailContent = fs.readFileSync(detailPagePath, "utf8");
    let modified = false;

    // Remove import statement
    const importStatement = `import ${className}MicroservicePage from "./microservices/${className}MicroservicePage";\n`;
    if (detailContent.includes(importStatement)) {
      detailContent = detailContent.replace(importStatement, "");
      modified = true;
      console.log("   ✓ Removed import from AdminMicroserviceDetailPage.tsx");
    }

    // Remove case statement
    const casePattern = new RegExp(
      `\\n\\s+case "${serviceKey}":[\\s\\S]*?(?=\\n\\s+case |\\n\\s+default:)`,
      "m"
    );
    if (casePattern.test(detailContent)) {
      detailContent = detailContent.replace(casePattern, "");
      modified = true;
      console.log("   ✓ Removed route case from AdminMicroserviceDetailPage.tsx");
    }

    if (modified) {
      fs.writeFileSync(detailPagePath, detailContent, "utf8");
      success = true;
    }

    return success;
  } catch (error) {
    console.error(`   ❌ Failed to remove frontend page: ${error.message}`);
    return false;
  }
}

// ---------- Rename Service Directory ----------

function renameServiceDirectory(rootDir, serviceKey) {
  const serviceDir = path.join(rootDir, serviceKey);

  if (!fs.existsSync(serviceDir)) {
    console.warn(`⚠️  Service directory "${serviceKey}" not found, skipping rename`);
    return false;
  }

  try {
    const timestamp = makeTimestamp();
    const deletedDir = path.join(rootDir, `.DELETED_${serviceKey}_${timestamp}`);
    fs.renameSync(serviceDir, deletedDir);
    console.log(`   ✓ Renamed directory to ${path.basename(deletedDir)}`);
    return true;
  } catch (error) {
    console.error(`   ❌ Failed to rename directory: ${error.message}`);
    return false;
  }
}

// ---------- MAIN ----------

(async () => {
  const opts = parseArgs();

  const serviceName = opts.name;
  const className = toPascalCase(serviceName);
  const serviceKey = toKebabCase(serviceName);

  const rootDir = __dirname;
  const portsPath = path.join(rootDir, "doc", "ports.json");
  const composePath = path.join(rootDir, "docker-compose.yml");
  const composeLocalPath = path.join(rootDir, "docker-compose.local.yml");

  console.log(`\n🗑️  Deleting microservice: ${serviceName}`);
  console.log(`   Service key: ${serviceKey}`);
  console.log(`   Class name:  ${className}`);

  // Confirm deletion
  const confirmed = await confirmDeletion(serviceName);
  if (!confirmed) {
    console.log("\n❌ Deletion cancelled by user");
    process.exit(0);
  }

  console.log("\n📋 Starting deletion process...\n");

  // Remove from docker-compose.yml
  console.log("🐳 Removing from Docker Compose files...");
  removeFromDockerCompose(composePath, serviceKey);
  removeFromDockerCompose(composeLocalPath, serviceKey);

  // Remove from ports.json
  console.log("\n📋 Removing from ports.json...");
  removeFromPorts(portsPath, serviceKey);

  // Remove from .env files
  console.log("\n📄 Removing from .env files...");
  const upperKey = serviceKey.toUpperCase();
  const cleanName = serviceKey.replace(/[^a-zA-Z0-9]/g, "");
  const urlEnvVar = `${cleanName.toUpperCase()}_URL`;

  const envFiles = [".env", ".env.local", ".env.paper"];
  let envUpdated = false;
  for (const envName of envFiles) {
    const envPath = path.join(rootDir, envName);
    if (removeFromEnvFile(envPath, upperKey, urlEnvVar)) {
      envUpdated = true;
    }
  }
  if (envUpdated) {
    console.log("   ✓ Updated .env files");
  }

  // Remove from deploy.yml
  console.log("\n📦 Removing from deploy.yml...");
  removeFromDeployWorkflow(rootDir, serviceName);

  // Remove from database
  console.log("\n💾 Removing from database...");
  await removeFromDatabase(serviceKey, serviceName);

  // Remove frontend page
  console.log("\n🎨 Removing frontend page...");
  removeFrontendPage(serviceName, className, serviceKey);

  // Rename service directory
  console.log("\n📁 Renaming service directory...");
  renameServiceDirectory(rootDir, serviceKey);

  console.log("\n✅ Microservice deleted successfully!\n");
  console.log("📊 Summary:");
  console.log(`   Name:         ${serviceName}`);
  console.log(`   Service key:  ${serviceKey}`);
  console.log(`   Class:        ${className}`);
  console.log("\n   Removed from:");
  console.log("   • docker-compose.yml");
  console.log("   • docker-compose.local.yml");
  console.log("   • doc/ports.json");
  console.log("   • .env files");
  console.log("   • .github/workflows/deploy.yml");
  console.log(`   • Database: service_flags table (ENV=${process.env.ENV || "local"})`);
  console.log(`   • Frontend: ../astraai (page and route)`);
  console.log(`   • Directory renamed to: .DELETED_${serviceKey}_<timestamp>`);

  console.log("\n💡 Notes:");
  console.log("   • The service directory has been renamed, not deleted");
  console.log("   • You can manually delete the .DELETED_* directory when you're sure");
  console.log("   • If the service was running, you may need to stop it manually");
})();
