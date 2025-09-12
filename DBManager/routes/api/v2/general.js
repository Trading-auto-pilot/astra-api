
const express = require('express');
const router = express.Router();

module.exports = (dbManager) => {

  // (opzionale) GET singola strategia
  router.get("/dbLogger", async (req, res) => {
    try {
      const data = await dbManager.getDbLogStatus();
      res.json({ ok: true, data });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

    // PUT /dbLogger/:status
    router.put("/dbLogger/:status", async (req, res) => {
    const raw = String(req.params.status ?? "").trim();
    const normalized = raw.toLowerCase();

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
        return res
        .status(500)
        .json({ ok: false, error: e?.message || String(e) });
    }
    });


    return router;
}