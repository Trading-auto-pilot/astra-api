// routes/api/v2/strategies.js
const express = require('express');
const router = express.Router();

/**
 * Factory: inietta dbManager e un'istanza di RedisBus già connessa.
 * Valori in cache = RAW (array/oggetto), così i moduli possono leggerli direttamente.
 * Gli endpoint wrappano in { ok:true, ... } solo in risposta HTTP.
 */
module.exports = (dbManager,bus, {logger}) => {
  const TTL = 10; // sec
  const log = logger?.forModule ? logger.forModule(__filename) : console;
  // helpers locali
  const getBus = (req) => {
    const bus = req.app.get('bus');
    return bus && typeof bus.get === 'function' && typeof bus.key === 'function' ? bus : null;
  };
  const hasBus = () => !!bus && typeof bus.get === 'function' && typeof bus.key === 'function';

  // chiavi cache (env-aware)
  const KEY_ALL = () => bus.key('strategies','v2','all');
  const KEY_ID  = (id) => bus.key('strategies','v2','id', id);

  // --------- CREATE ---------
  router.post("/", async (req, res) => {
    try {
      if (!req.body?.strategy || !Array.isArray(req.body?.symbols)) {
        return res.status(400).json({ ok: false, error: "payload non valido" });
      }
      log.trace('[/api/v2/strategies] POST con body | '+JSON.stringify(req.body));
      const result = await dbManager.createStrategyV2(req.body);
      // invalidate
      if (hasBus()) {
        try {
          await bus.del(KEY_ALL());
          if (result?.id) await bus.del(KEY_ID(result.id));
        } catch {}
      }
      res.status(201).json(result); // { ok:true, id }
    } catch (e) {
      const msg = e?.message || String(e);
      const code = /duplicate|foreign key|constraint/i.test(msg) ? 409 : 400;
      log.error('[/api/v2/strategies] POST error : '+msg);
      res.status(code).json({ ok: false, error: msg });
    }
  });

  // --------- UPDATE ---------
  router.put("/:id", async (req, res) => {
    try {
      if (!req.body?.strategy || !Array.isArray(req.body?.symbols)) {
        return res.status(400).json({ ok: false, error: "payload non valido" });
      }
      const result = await dbManager.modifyStrategyV2(req.params.id, req.body);
      if (hasBus()) {
        try {
          await bus.del(KEY_ALL());
          await bus.del(KEY_ID(req.params.id));
        } catch {}
      }
      res.status(201).json(result); // { ok:true, id }
    } catch (e) {
      const msg = e?.message || String(e);
      const code = /duplicate|foreign key|constraint/i.test(msg) ? 409 : 400;
      log.error('[/api/v2/strategies/'+req.params.id+'] PUT error : '+msg);
      res.status(code).json({ ok: false, error: msg });
    }
  });

  // --------- DELETE ---------
  router.delete("/:id", async (req, res) => {
    try {
      const result = await dbManager.deleteStrategyV2(req.params.id);
      if (hasBus()) {
        try {
          await bus.del(KEY_ALL());
          await bus.del(KEY_ID(req.params.id));
        } catch {}
      }
      res.status(201).json(result); // { ok:true, id }
    } catch (e) {
      const msg = e?.message || String(e);
      const code = /duplicate|foreign key|constraint/i.test(msg) ? 409 : 400;
      log.error('[/api/v2/strategies/'+req.params.id+'] DELETE error : '+msg);
      res.status(code).json({ ok: false, error: msg });
    }
  });

  // --------- LIST (GET ALL) ---------
  router.get("/", async (req, res) => {
    try {
      // read-through cache (RAW array)
      if (hasBus()) {
        try {
          const cached = await bus.get(KEY_ALL());
          if (Array.isArray(cached)) {
            return res.json({ ok: true, items: cached });
          }
        } catch {}
      }

      const items = await dbManager.listStrategiesV2();

      if (hasBus()) {
        try { await bus.set(KEY_ALL(), items, { EX: TTL }); } catch {}
      }

      res.json({ ok: true, items });
    } catch (e) {
      log.error('[/api/v2/strategies] GET error : '+e?.message);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // --------- GET BY ID ---------
  router.get("/:id", async (req, res) => {
    try {
      if (hasBus()) {
        try {
          const cached = await bus.get(KEY_ID(req.params.id));
          if (cached && typeof cached === 'object') {
            return res.json({ ok: true, data: cached });
          }
        } catch {}
      }

      const data = await dbManager.getStrategyV2(req.params.id);
      if (!data) return res.status(404).json({ ok: false, error: "not found" });

      if (hasBus()) {
        try { await bus.set(KEY_ID(req.params.id), data, { EX: TTL }); } catch {}
      }

      res.json({ ok: true, data });
    } catch (e) {
      log.error('[/api/v2/strategies'+eq.params.id+'] GET error : '+e?.message);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  return router;
};
