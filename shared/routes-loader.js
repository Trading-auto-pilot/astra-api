// shared/routes-loader.js
const fs = require("fs");
const path = require("path");

function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

function makeLog(logger, filename) {
  return logger?.forModule
    ? logger.forModule(filename)
    : { trace: (...a)=>console.log(...a), info: (...a)=>console.log(...a), warning: (...a)=>console.warn(...a), error: (...a)=>console.error(...a) };
}

/**
 * @param {Express} app
 * @param {object}  opts
 * @param {string}  opts.routesDir   // path assoluto
 * @param {string}  [opts.baseUrl="/api"]
 * @param {any[]}   [opts.factoryArgs=[]] // <-- gli argomenti da passare alla factory dei router
 * @param {number}  [opts.maxDepth=2]
 * @param {string[]} [opts.extensions=[".js"]]
 * @param {any}     [opts.logger]
 */
function mountRoutesFrom(app, {
  routesDir,
  baseUrl = "/api",
  factoryArgs = [],         // <<--- nuovo
  maxDepth = 2,
  extensions = [".js"],
  logger,
}) {
  const log = makeLog(logger, __filename);
  const exts = new Set(extensions);

  if (!routesDir || !path.isAbsolute(routesDir)) {
    throw new Error("mountRoutesFrom: 'routesDir' deve essere un path assoluto");
  }

  function walk(currDir, currUrl, depth) {
    if (depth > maxDepth) return;

    for (const entry of fs.readdirSync(currDir)) {
      if (entry.startsWith(".")) continue;
      const abs = path.join(currDir, entry);

      if (isDir(abs)) {
        const nextUrl = path.posix.join(currUrl, entry);
        walk(abs, nextUrl, depth + 1);
        continue;
      }

      const ext = path.extname(entry);
      if (!exts.has(ext)) continue;

      const name = path.basename(entry, ext);
      const mountPath = name === "index" ? currUrl : path.posix.join(currUrl, name);

      const mod = require(abs);
      const factory =
        typeof mod === "function" ? mod :
        (typeof mod?.default === "function" ? mod.default : null);

      const router = factory
        ? factory(...factoryArgs)                 // <<--- inoltra gli argomenti così come sono
        : (mod?.default || mod);

      if (!router) {
        log.warning(`[server] Skip ${abs}: nessun router/factory export`);
        continue;
      }
      app.use(mountPath, router);
      log.trace(`[server] Mounted ${abs} -> ${mountPath}`);
    }
  }

  const rootUrl = baseUrl.startsWith("/") ? baseUrl : `/${baseUrl}`;
  walk(routesDir, rootUrl, 0);
}

module.exports = { mountRoutesFrom };
