// /route/bots.js

const express = require('express');
const cache = require('../../shared/cache');
const router = express.Router();

module.exports = (dbManager) => {
// GET /logs?limit=123&offset=0&page=0
router.get('/', async (req, res) => {
  // 1) valida/parsa limit
  const n = Number(req.query.limit);
  const limit = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 1000) : 100;
  const p = Number(req.query.page);
  const rawOffset = Number(req.query.offset);
  const microservice = typeof req.query.microservice === "string" ? req.query.microservice.trim() : null;
  const levelRaw = typeof req.query.level === "string" ? req.query.level.trim() : null;
  const moduleRaw = typeof req.query.module === "string"
    ? req.query.module.trim()
    : typeof req.query.moduleName === "string"
      ? req.query.moduleName.trim()
      : null;
  const functionRaw = typeof req.query.function === "string"
    ? req.query.function.trim()
    : typeof req.query.functionName === "string"
      ? req.query.functionName.trim()
      : null;
  const startDateRaw = typeof req.query.startDate === "string"
    ? req.query.startDate.trim()
    : typeof req.query.from === "string"
      ? req.query.from.trim()
      : null;
  const endDateRaw = typeof req.query.endDate === "string"
    ? req.query.endDate.trim()
    : typeof req.query.to === "string"
      ? req.query.to.trim()
      : null;

  const levels = levelRaw
    ? levelRaw
        .split(",")
        .map((lvl) => lvl.trim())
        .filter(Boolean)
    : null;
  const offsetFromOffset = Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.floor(rawOffset) : null;
  const offsetFromPage = Number.isFinite(p) && p >= 0 ? Math.floor(p) * limit : null;
  const offset = offsetFromOffset !== null ? offsetFromOffset : offsetFromPage !== null ? offsetFromPage : 0;

  const cacheKey = `logs:all:limit:${limit}:offset:${offset}:ms:${microservice || "all"}:level:${(levels || []).join("|") || "all"}:module:${moduleRaw || "all"}:function:${functionRaw || "all"}:from:${startDateRaw || "all"}:to:${endDateRaw || "all"}`;

  try {
    // 2) prova cache
    let cached = await cache.get(cacheKey);
    if (cached) {
      try { cached = typeof cached === 'string' ? JSON.parse(cached) : cached; } catch {}
      return res.json(cached);
    }

    // 3) DB
    const result = await dbManager.getAllLogs(limit, offset, {
      microservice,
      levels,
      moduleName: moduleRaw,
      functionName: functionRaw,
      startDate: startDateRaw,
      endDate: endDateRaw,
    });

    // 4) metti in cache (puoi aggiungere TTL se supportato)
    try { await cache.set(cacheKey, JSON.stringify(result)); } catch {}

    return res.json({
      items: result,
      limit,
      offset,
      page: offsetFromPage !== null ? offsetFromPage / limit : Math.floor(offset / limit),
      nextOffset: offset + limit,
      count: Array.isArray(result) ? result.length : 0,
      microservice: microservice || null,
      level: levels || null,
      moduleName: moduleRaw || null,
      functionName: functionRaw || null,
      startDate: startDateRaw || null,
      endDate: endDateRaw || null,
    });
  } catch (error) {
    console.error('[GET /logs] Errore: ', error);
    return res
      .status(500)
      .json({ error: 'Errore durante la lettura dei logs ' + (error?.message || String(error)), module: '[GET /logs]' });
  }
});


  router.post('/', async (req, res) => {
    try {
      const result = await dbManager.insertLogs(req.body);
      await cache.del('logs:all');
      res.json(result);
    } catch (error) {
      console.error('[POST /logs] Errore: ', error.message);
      res.status(500).json({ error: 'Errore durante la scrittura dei logs '+error.message, module:"[POST /logs]" });
    }
  });

  return router;
};
