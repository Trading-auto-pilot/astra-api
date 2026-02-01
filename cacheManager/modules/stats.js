// modules/stats.js
"use strict";

const fs = require("fs");
const fsp = require("fs").promises;
const path = require("path");
const { getSetting } = require("../../shared/loadSettings");

module.exports = function createStatsModule(cacheManager) {
  const resolveBasePath = () => {
    const cfg = cacheManager.cacheBasePath || "cache";
    const candidates = [];
    // absolute path
    if (path.isAbsolute(cfg)) candidates.push(cfg);
    // relative to cwd
    candidates.push(path.resolve(process.cwd(), cfg));
    // relative to module dir
    candidates.push(path.resolve(__dirname, "..", cfg));

    for (const p of candidates) {
      try {
        if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
      } catch {
        // ignore
      }
    }
    // fallback: first candidate
    return candidates[0];
  };

  const walkDir = async (dir) => {
    const result = { path: dir, totalBytes: 0, files: [], fileCount: 0, dirCount: 0 };
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return result;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const child = await walkDir(full);
        result.totalBytes += child.totalBytes;
        result.fileCount += child.fileCount;
        result.dirCount += child.dirCount + 1;
        result.files.push(child);
      } else if (entry.isFile()) {
        try {
          const stat = await fsp.stat(full);
          result.totalBytes += stat.size;
          result.fileCount += 1;
          result.files.push({
            path: full,
            size: stat.size,
            createdAt: stat.birthtime?.toISOString?.() || stat.birthtime,
            updatedAt: stat.mtime?.toISOString?.() || stat.mtime,
          });
        } catch {
          // ignore unreadable file
        }
      }
    }

    return result;
  };

  const removePath = async (target) => {
    try {
      const stat = await fsp.stat(target);
      if (stat.isDirectory()) {
        // Recursively remove directory
        await fsp.rm(target, { recursive: true, force: true });
      } else {
        await fsp.unlink(target);
      }
      return true;
    } catch {
      return false;
    }
  };

  const removeChildren = async (dir) => {
    try {
      const entries = await fsp.readdir(dir);
      for (const entry of entries) {
        const full = path.join(dir, entry);
        await removePath(full);
      }
      return true;
    } catch {
      return false;
    }
  };

  const listFiles = async (dir, out = []) => {
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return out;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await listFiles(full, out);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
    return out;
  };

  const toTimestampMs = (value) => {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "number") {
      return value < 1e12 ? value * 1000 : value;
    }
    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? null : parsed;
  };

  return {
    getL1Stats() {
      return {
        provider: process.env.HISTORICAL_PROVIDER || "ALPACA",
        l1_hits: cacheManager.L1Hit || 0,
        last_provider_call: cacheManager.lastProviderCall || null,
      };
    },

    getL2Stats() {
      return {
        l2_hits: cacheManager.L2Hit || 0,
        l2_miss: cacheManager.L2Miss || 0,
        cache_base_path: cacheManager.cacheBasePath,
      };
    },

    getParamsSetting() {
      return {
        provider: process.env.HISTORICAL_PROVIDER || "ALPACA",
        timeframe: cacheManager.tf || "1Day",
        cache_base_path: cacheManager.cacheBasePath,
      };
    },

    getCacheHits() {
      return {
        l1_hits: cacheManager.L1Hit || 0,
        l2_hits: cacheManager.L2Hit || 0,
        l2_miss: cacheManager.L2Miss || 0,
        l3_hits: cacheManager.L3Hit || 0,
        total_requests: cacheManager.totalRequests || 0,
      };
    },

    async getL2Size() {
      const root = resolveBasePath();

      let stats;
      try {
        stats = await fsp.stat(root);
      } catch {
        return { basePath: root, exists: false, totalBytes: 0, fileCount: 0, dirCount: 0, tree: null };
      }

      if (!stats.isDirectory()) {
        return { basePath: root, exists: false, totalBytes: 0, fileCount: 0, dirCount: 0, tree: null };
      }

      const tree = await walkDir(root);

      const aggregate = (node) => {
        if (!node) return { bytes: 0, files: 0, dirs: 0 };
        if (typeof node.size === "number") return { bytes: node.size, files: 1, dirs: 0 };
        if (Array.isArray(node.files)) {
          return node.files.reduce(
            (acc, f) => {
              const agg = aggregate(f);
              return { bytes: acc.bytes + agg.bytes, files: acc.files + agg.files, dirs: acc.dirs + agg.dirs };
            },
            { bytes: 0, files: 0, dirs: 0 }
          );
        }
        return { bytes: 0, files: 0, dirs: 0 };
      };

      const totals = aggregate(tree);

      return {
        basePath: root,
        exists: true,
        totalBytes: totals.bytes,
        fileCount: totals.files,
        dirCount: totals.dirs,
        tree,
        maxSizeCache: getSetting ? getSetting("MAX_L2_CACHE_MB") : undefined,
      };
    },

    /**
     * Cancella l'intera cache L2 (basePath) o parti di essa.
     * @param {string[]} segments path relativi da cancellare ([] = tutto)
     */
    async deleteL2(segments = []) {
      const root = resolveBasePath();

      // nessun segmento -> cancella tutto
      if (!segments.length) {
        const ok = await removeChildren(root);
        return { ok, deleted: root };
      }

      // costruisci percorso relativo
      const safeSegments = segments.filter((s) => typeof s === "string" && s.trim() !== "");
      if (!safeSegments.length) {
        await removePath(root);
        return { ok: true, deleted: root };
      }

      const target = path.join(root, ...safeSegments);
      const success = await removePath(target);
      return { ok: success, deleted: target };
    },

    /**
     * Audit cache L2: statistiche su candele valide/rotte e coverage temporale.
     */
    async auditL2({ symbol, tf, clean } = {}) {
      const root = resolveBasePath();
      const exists = fs.existsSync(root);
      if (!exists) {
        return { ok: false, error: "cache base path not found", basePath: root };
      }

      const files = await listFiles(root);
      const jsonFiles = files.filter((f) => f.toLowerCase().endsWith(".json"));
      const wantedSymbol = symbol ? String(symbol).trim().toUpperCase() : null;
      const wantedTf = tf ? String(tf).trim() : null;

      const summary = {
        basePath: root,
        totalFiles: 0,
        totalSymbols: 0,
        totalCandles: 0,
        validCandles: 0,
        brokenCandles: 0,
        brokenReasons: {
          invalid_t: 0,
          invalid_ohlc: 0,
          invalid_json: 0,
          not_array: 0,
        },
        providers: {},
        timeRange: { start: null, end: null },
        cleanedFiles: 0,
        removedCandles: 0,
        topBrokenFiles: [],
      };

      const perSymbol = {};
      const brokenFileStats = [];

      for (const file of jsonFiles) {
        const rel = path.relative(root, file).replace(/\\/g, "/");
        const parts = rel.split("/");
        const fileSymbol = parts[0] || "UNKNOWN";
        if (wantedSymbol && fileSymbol.toUpperCase() !== wantedSymbol) continue;

        const tfMatch = rel.match(/_(.+)\.json$/);
        const tfValue = tfMatch ? tfMatch[1] : "unknown";
        if (wantedTf && tfValue.toLowerCase() !== wantedTf.toLowerCase()) continue;

        summary.totalFiles += 1;
        if (!perSymbol[fileSymbol]) {
          perSymbol[fileSymbol] = {
            files: 0,
            totalCandles: 0,
            validCandles: 0,
            brokenCandles: 0,
            providers: {},
            timeRange: { start: null, end: null },
            timeframes: {},
          };
        }

        const tf = tfValue;
        perSymbol[fileSymbol].files += 1;
        perSymbol[fileSymbol].timeframes[tf] = (perSymbol[fileSymbol].timeframes[tf] || 0) + 1;

        let data;
        try {
          const raw = await fsp.readFile(file, "utf8");
          data = JSON.parse(raw);
        } catch {
          summary.brokenReasons.invalid_json += 1;
          continue;
        }

        if (!Array.isArray(data)) {
          summary.brokenReasons.not_array += 1;
          continue;
        }

        let fileBroken = 0;
        let fileValid = 0;
        const cleaned = [];

        for (const candle of data) {
          summary.totalCandles += 1;
          perSymbol[fileSymbol].totalCandles += 1;

          const t = toTimestampMs(candle?.t ?? candle?.timestamp ?? candle?.time ?? candle?.date);
          const o = Number(candle?.o ?? candle?.open);
          const h = Number(candle?.h ?? candle?.high);
          const l = Number(candle?.l ?? candle?.low);
          const c = Number(candle?.c ?? candle?.close);

          let valid = true;
          if (!Number.isFinite(t)) {
            summary.brokenReasons.invalid_t += 1;
            valid = false;
          }
          if (![o, h, l, c].every((v) => Number.isFinite(v))) {
            summary.brokenReasons.invalid_ohlc += 1;
            valid = false;
          }

          if (valid) {
            summary.validCandles += 1;
            perSymbol[fileSymbol].validCandles += 1;
            fileValid += 1;
            cleaned.push(candle);
          } else {
            summary.brokenCandles += 1;
            perSymbol[fileSymbol].brokenCandles += 1;
            fileBroken += 1;
          }

          const provider = candle?.provider || "UNKNOWN";
          summary.providers[provider] = (summary.providers[provider] || 0) + 1;
          perSymbol[fileSymbol].providers[provider] =
            (perSymbol[fileSymbol].providers[provider] || 0) + 1;

          if (Number.isFinite(t)) {
            const iso = new Date(t).toISOString();
            if (!summary.timeRange.start || iso < summary.timeRange.start) summary.timeRange.start = iso;
            if (!summary.timeRange.end || iso > summary.timeRange.end) summary.timeRange.end = iso;
            if (!perSymbol[fileSymbol].timeRange.start || iso < perSymbol[fileSymbol].timeRange.start) {
              perSymbol[fileSymbol].timeRange.start = iso;
            }
            if (!perSymbol[fileSymbol].timeRange.end || iso > perSymbol[fileSymbol].timeRange.end) {
              perSymbol[fileSymbol].timeRange.end = iso;
            }
          }
        }

        if (fileBroken > 0) {
          brokenFileStats.push({
            file: rel,
            symbol: fileSymbol,
            tf,
            total: fileValid + fileBroken,
            broken: fileBroken,
            brokenPct: (fileBroken / Math.max(1, fileValid + fileBroken)) * 100,
          });
        }

        if (clean && fileBroken > 0) {
          try {
            await fsp.writeFile(file, JSON.stringify(cleaned, null, 2), "utf8");
            summary.cleanedFiles += 1;
            summary.removedCandles += fileBroken;
          } catch {
            // ignore write errors
          }
        }
      }

      summary.totalSymbols = Object.keys(perSymbol).length;
      summary.topBrokenFiles = brokenFileStats
        .sort((a, b) => b.brokenPct - a.brokenPct || b.broken - a.broken)
        .slice(0, 10);

      return { ok: true, summary, perSymbol };
    },

    /**
     * Statistiche L3 (Redis) sui key candles:*
     */
    async getL3Size() {
      const client = cacheManager?.bus?.pub;
      if (!client || !client.isOpen) {
        return { ok: false, error: "Redis client non disponibile", totalBytes: 0, keys: [] };
      }

      const keys = [];
      let totalBytes = 0;
      let maxmemory = null;
      try {
        // recupera maxmemory via CONFIG GET
        try {
          const cfg = await client.configGet("maxmemory");
          if (cfg && typeof cfg.maxmemory === "string") {
            const val = cfg.maxmemory.trim();
            if (val !== "0") maxmemory = val;
          }
        } catch (_) {
          // ignore
        }

        for await (const key of client.scanIterator({ MATCH: "candles:*" })) {
          const size = await client.strLen(key).catch(() => 0);
          totalBytes += size;
          keys.push({ key, bytes: size });
        }
        return { ok: true, totalBytes, count: keys.length, keys, maxmemory };
      } catch (e) {
        return { ok: false, error: e?.message || String(e), totalBytes, count: keys.length, keys, maxmemory };
      }
    },

    async deleteL3(segments = []) {
      const client = cacheManager?.bus?.pub;
      if (!client || !client.isOpen) {
        return { ok: false, error: "Redis client non disponibile" };
      }

      let pattern = "candles:*";
      if (segments.length === 1 && segments[0]) {
        pattern = `candles:${segments[0]}:*`;
      } else if (segments.length >= 2 && segments[0] && segments[1]) {
        pattern = `candles:${segments[0]}:${segments[1]}`;
      }

      let deleted = 0;
      const keysToDelete = [];
      try {
        for await (const key of client.scanIterator({ MATCH: pattern })) {
          keysToDelete.push(key);
        }
        if (keysToDelete.length) {
          deleted = await client.del(keysToDelete);
        }
        return { ok: true, deleted, pattern, keys: keysToDelete };
      } catch (e) {
        return { ok: false, error: e?.message || String(e), deleted, pattern, keys: keysToDelete };
      }
    }
  };
};
