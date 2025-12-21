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
          result.files.push({ path: full, size: stat.size });
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
        await removePath(root);
        return { ok: true, deleted: root };
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
