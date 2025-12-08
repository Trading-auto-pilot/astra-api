"use strict";

const express = require("express");

module.exports = function buildFundamentalsRouter({ service, logger, moduleName }) {
  const router = express.Router();
  const fnPrefix = "fundamentals";

  // GET /fundamentals  -> tutti i simboli
  router.get("/", async (req, res) => {
    const fn = `${fnPrefix}.GET:/`;

    try {
      logger.trace(`${fn} start`);

      const data = await service.fundamentalService.getAll();

      logger.trace(`${fn} success`, { count: Array.isArray(data) ? data.length : undefined });
      res.json(data);
    } catch (err) {
      logger.error(`${fn} error`, { error: err?.message || String(err) });
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /fundamentals/:symbol  -> singolo simbolo
  router.get("/:symbol", async (req, res) => {
    const fn = `${fnPrefix}.GET:/:symbol`;
    const { symbol } = req.params;

    try {
      logger.trace(`${fn} start`, { symbol });

      if (!symbol) {
        logger.warn(`${fn} missing symbol`);
        return res.status(400).json({ error: "symbol is required" });
      }

      const data = await service.fundamentalService.getOne(symbol);

      if (!data || (Array.isArray(data) && data.length === 0)) {
        logger.info(`${fn} not found`, { symbol });
        return res.status(404).json({ error: "Not found" });
      }

      logger.trace(`${fn} success`, { symbol });
      res.json(data);
    } catch (err) {
      logger.error(`${fn} error`, { symbol, error: err?.message || String(err) });
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
};
