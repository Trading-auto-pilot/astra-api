
const express = require('express');
const router = express.Router();

module.exports = (dbManager,bus, {logger}) => {

  const log = logger?.forModule ? logger.forModule(__filename) : console;
  // (opzionale) GET singola strategia
  router.get("/dbLogger", async (req, res) => {
    try {
      const data = await dbManager.getDbLogStatus();
      log.trace('[/api/v2/general/dbLogger] GET | '+JSON.stringify(data));
      res.json({ ok: true, data });
    } catch (e) {
      log.error('[/api/v2/general/dbLogger] GET error : '+e?.message);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

    // PUT /dbLogger/:status
    router.put("/dbLogger/:status", async (req, res) => {
    const raw = String(req.params.status ?? "").trim();
    const normalized = raw.toLowerCase();

    log.trace('[/api/v2/general/dbLogger'+req.params.status+'] PUT '+normalized);
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
        const data = await dbManager.setDbLogStatus(enable); // <-- passa boolean
        if (data == null) {
        return res.status(404).json({ ok: false, error: "not found" });
        }
        return res.json({ ok: true, status: enable ? "on" : "off", data });
    } catch (e) {
        console.error("[dbLogger] set status error:", e);
        log.error('[/api/v2/general/dbLogger'+req.params.status+'] PUT error : '+e?.message);
        return res
        .status(500)
        .json({ ok: false, error: e?.message || String(e) });
    }
    });


    return router;
}