
const express = require('express');
const router = express.Router();

module.exports = (dbManager) => {


  // POST /api/v1/strategies  — salva strategies_v2 + strategy_symbol
  router.post("/", async (req, res) => {
    try {
      // verifiche minime di coerenza (ulteriori controlli sono in createStrategyV2)
      if (!req.body?.strategy || !Array.isArray(req.body?.symbols)) {
        return res.status(400).json({ ok: false, error: "payload non valido" });
      }

      const result = await dbManager.createStrategyV2(req.body);
      res.status(201).json(result); // { ok:true, id }
    } catch (e) {
      const msg = e?.message || String(e);
      const code = /duplicate|foreign key|constraint/i.test(msg) ? 409 : 400;
      res.status(code).json({ ok: false, error: msg });
    }
  });


    // GET tutte le strategie
  router.get("/", async (req, res) => {
    try {
      const items = await dbManager.listStrategiesV2();
      res.json({ ok: true, items });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // (opzionale) GET singola strategia
  router.get("/:id", async (req, res) => {
    try {
      const data = await dbManager.getStrategyV2(req.params.id);
      if (!data) return res.status(404).json({ ok: false, error: "not found" });
      res.json({ ok: true, data });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });


    return router;
}