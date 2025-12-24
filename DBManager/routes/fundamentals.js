// /route/fundamentals.js

const express = require("express");
const cache = require("../../shared/cache");
const router = express.Router();

module.exports = (dbManager) => {

  /**
   * GET /fundamentals/history?symbol=XYZ&days=70
   * Restituisce gli snapshot storici (default ultimi 70 giorni).
   */
  router.get("/history", async (req, res) => {
    const { symbol } = req.query;
    const days = req.query.days ? Number(req.query.days) : 70;
    try {
      const rows = await dbManager.getFundamentalsHistory({
        symbol: symbol ? String(symbol).toUpperCase() : null,
        limitDays: Number.isFinite(days) ? days : 70,
      });
      return res.json(rows);
    } catch (err) {
      console.error("[GET /fundamentals/history] Errore:", err.message);
      return res.status(500).json({
        error: "Errore durante la lettura della cronologia fundamentals",
        module: "[GET /fundamentals/history]",
      });
    }
  });

  /**
   * POST /fundamentals/history
   * Body: { records: [ { symbol, as_of_date, ... } ] }
   */
  router.post("/history", async (req, res) => {
    const records = req.body?.records || req.body?.results || req.body;
    if (!Array.isArray(records) || !records.length) {
      return res.status(400).json({
        ok: false,
        error: "Formato input non valido: serve { records: [...] }",
      });
    }
    try {
      const result = await dbManager.insertOrUpdateFundamentalsHistoryBulk(records);
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[POST /fundamentals/history] Errore:", err.message);
      return res.status(500).json({
        ok: false,
        error: "Errore durante la scrittura della cronologia fundamentals",
        module: "[POST /fundamentals/history]",
      });
    }
  });
  
  /**
   * GET /fundamentals
   * Restituisce tutta la tabella fundamentals (o una lista filtrata in futuro).
   * Cache: fundamentals:all
   */
  router.get("/", async (_req, res) => {
    const cacheKey = "fundamentals:all";

    try {
      let cached = await cache.get(cacheKey);
      if (cached) return res.json(cached);

      const rows = await dbManager.getAllFundamentals();

      // salva in cache
      await cache.set(cacheKey, rows);

      return res.json(rows);

    } catch (err) {
      console.error("[GET /fundamentals] Errore:", err.message);
      return res.status(500).json({
        error: "Errore durante la lettura dei fundamentals",
        module: "[GET /fundamentals]"
      });
    }
  });



  /**
   * GET /fundamentals/:symbol
   * Restituisce 1 solo ticker
   * Cache: fundamentals:symbol:<SYM>
   */
  router.get("/:symbol", async (req, res) => {
    const { symbol } = req.params;

    const cacheKey = `fundamentals:symbol:${symbol}`;

    try {
      let cached = await cache.get(cacheKey);
      if (cached) return res.json(cached);

      const row = await dbManager.getFundamentalsBySymbol(symbol);
      if (!row) {
        return res.status(404).json({
          error: `Fundamentals non trovati per ${symbol}`,
        });
      }

      await cache.set(cacheKey, row);

      return res.json(row);

    } catch (err) {
      console.error(`[GET /fundamentals/${symbol}] Errore:`, err.message);
      return res.status(500).json({
        error: "Errore durante la lettura dei fundamentals",
        module: `[GET /fundamentals/${symbol}]`
      });
    }
  });


router.put("/bulk", async (req, res) => {
  const results = req.body?.results;
  if (!Array.isArray(results) || !results.length) {
    return res.status(400).json({
      ok: false,
      error: "Serve { results: [ { symbol, momentum }, ... ] }",
    });
  }

  try {
    const out = await dbManager.updateFundamentalsMomentumBulk(results);
    // invalidiamo eventuale cache per simboli singoli
    for (const r of results) {
      if (r.symbol) {
        await cache.del(`fundamentals:symbol:${r.symbol}`);
      }
    }
    return res.json({ ok: true, ...out });
  } catch (err) {
    console.error("[POST /fundamentals/momentum/bulk] Errore:", err.message);
    return res.status(500).json({
      ok: false,
      error: "Errore durante aggiornamento momentum",
    });
  }
});


  /**
   * POST /fundamentals/bulk
   * Inserisce/aggiorna più ticker
   * Invalida la cache globale e quella per simbolo
   */
  router.post("/bulk", async (req, res) => {
    const records = req.body?.results;

    if (!Array.isArray(records)) {
      return res.status(400).json({
        error: "Formato input non valido: serve { records: [...] }"
      });
    }

    try {
      const result = await dbManager.insertOrUpdateFundamentalsBulk(records);

      // 🔥 invalidazione cache globale
      await cache.del("fundamentals:all");

      // 🔥 invalidazione cache per ogni simbolo aggiornato
      for (const r of records) {
        const key = `fundamentals:symbol:${r.symbol}`;
        await cache.del(key);
      }

      return res.json({ ok: true, ...result });

    } catch (err) {
      console.error("[POST /fundamentals/bulk] Errore:", err.message);
      return res.status(500).json({
        error: "Errore durante la scrittura dei fundamentals",
        module: "[POST /fundamentals/bulk]"
      });
    }
  });

  /**
   * DELETE /fundamentals/:symbol
   * Cancella un ticker dalla tabella fundamentals
   * e invalida la cache relativa.
   */
  router.delete("/:symbol", async (req, res) => {
    const { symbol } = req.params;

    try {
      const result = await dbManager.deleteFundamentalsBySymbol(symbol);

      if (!result.affectedRows) {
        return res.status(404).json({
          error: `Fundamentals non trovati per ${symbol}`,
          module: "[DELETE /fundamentals/:symbol]"
        });
      }

      // invalida cache globale e per simbolo
      await cache.del("fundamentals:all");
      await cache.del(`fundamentals:symbol:${symbol}`);

      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[DELETE /fundamentals/:symbol] Errore:", err.message);
      return res.status(500).json({
        error: "Errore durante la cancellazione dei fundamentals",
        module: "[DELETE /fundamentals/:symbol]"
      });
    }
  });


  return router;
};
