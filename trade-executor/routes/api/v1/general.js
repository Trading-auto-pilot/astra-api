const express = require('express');
const router = express.Router();

module.exports = (tradeExecutor,bus, {logger}) => {

  const log = logger?.forModule ? logger.forModule(__filename) : console;

  // (opzionale) GET singola strategia
  // Vedifica lo stato di scrittura dei log su DB ON/OFF (true/false)
  router.get("/dbLogger", async (req, res) => {
    try {
      const data = await logger.getDbLogStatus();
      log.trace('[/api/v1/general/dbLogger] GET | '+JSON.stringify(data));
      res.json({ ok: true, data });
    } catch (e) {
      log.error('[/api/v1/general/dbLogger] GET error : '+e?.message);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

    // PUT /dbLogger/:status
    // Modifica lo stato di scrittura su DB ON/OFF (true/false)
    router.put("/dbLogger/:status", async (req, res) => {
      const raw = String(req.params.status ?? "").trim();
      const normalized = raw.toLowerCase();

      log.trace('[/api/v1/general/dbLogger'+req.params.status+'] PUT '+normalized);
      let enable;
      if (normalized === "on") enable = true;
      else if (normalized === "off") enable = false;
      else {
          return res.status(400).json({
          ok: false,
          error: "Invalid status. Use 'on' or 'off'.",
          received: raw,
          allowed: ["on", "off"],
          });
    }

    try {
        const data = await logger.setDbLogStatus(enable); // <-- passa boolean
        if (data == null) {
        return res.status(404).json({ ok: false, error: "not found" });
        }
        return res.json({ ok: true, status: enable ? "on" : "off", data });
    } catch (e) {
        console.error("[dbLogger] set status error:", e);
        log.error('[/api/v1/general/dbLogger'+req.params.status+'] PUT error : '+e?.message);
        return res
        .status(500)
        .json({ ok: false, error: e?.message || String(e) });
    }
    });


  router.get("/logLevel", async (req, res) => {
    try {
      const data = await logger.getLevel();
      res.json({ ok: true, data });
    } catch (e) {
      log.error('[/api/v1/general/logLevel] GET error : '+e?.message);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  router.put("/logLevel/:level", async (req, res) => {
    try {
      const data = await logger.setLevel(req.params.level);
      res.json({ ok: true, data });
    } catch (e) {
      log.error('[/api/v1/general/logLevel] GET error : '+e?.message);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

    return router;
}