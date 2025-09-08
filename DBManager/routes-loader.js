// loaders/routes-loader.js
const fs = require("fs");
const path = require("path");

function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

function mountRoutesFrom(app, baseDir, baseUrl, dbManager, { maxDepth = 2, logger = console } = {}) {
  const exts = new Set([".js"]);

  function walk(currDir, currUrl, depth) {
    if (depth > maxDepth) return;

    for (const entry of fs.readdirSync(currDir)) {
      if (entry.startsWith(".")) continue;               // skip .DS_Store, .gitkeep, ecc.
      const abs = path.join(currDir, entry);

      if (isDir(abs)) {
        const nextUrl = path.posix.join(currUrl, entry); // sempre / anche su Windows
        walk(abs, nextUrl, depth + 1);
        continue;
      }

      const ext = path.extname(entry);
      if (!exts.has(ext)) continue;

      const name = path.basename(entry, ext);
      const mountPath = name === "index"
        ? currUrl
        : path.posix.join(currUrl, name);

      // supporta: factory(dbManager) oppure export di un Router
      const mod = require(abs);
      const factory =
        typeof mod === "function" ? mod :
        (typeof mod?.default === "function" ? mod.default : null);

      const router = factory ? factory(dbManager) : (mod?.default || mod);

      if (!router) {
        logger.warn?.(`[server] Skip ${abs}: nessun router/factory export`);
        continue;
      }
      app.use(mountPath, router);
      logger.trace?.(`[server] Mounted ${abs} -> ${mountPath}`);
    }
  }

  // normalizza baseUrl
  const rootUrl = baseUrl.startsWith("/") ? baseUrl : `/${baseUrl}`;
  walk(baseDir, rootUrl, 0);
}

module.exports = { mountRoutesFrom };
