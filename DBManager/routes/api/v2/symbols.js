const express = require('express');
const router = express.Router();

const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);

module.exports = (dbManager) => {

router.post("/branding", async (req, res) => {
  try {
    const body = req.body;
    if (!isObj(body)) {
      return res.status(400).json({ ok: false, error: "Payload mancante o non valido (results)" });
    }
    const r = body;
    if (!r.ticker || typeof r.ticker !== "string") {
      return res.status(400).json({ ok: false, error: "Campo results.ticker mancante" });
    }

    // (opzionale) coerenza base
    if (body.status && String(body.status).toUpperCase() !== "OK") {
      return res.status(422).json({ ok: false, error: `status non OK: ${body.status}` });
    }

    const result = await dbManager.upsertSymbolBrandingFromPolygon(body);
    return res.status(result.inserted ? 201 : 200).json({ ok: true, ...result });
  } catch (e) {
    console.error("[polygon/branding] error", e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

router.get("/branding", async (_req, res) => {
  try {
    const items = await dbManager.listSymbols();           // nessun filtro
    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// GET /api/v1/symbols/:symbol  → singolo simbolo
router.get("/branding/:symbol", async (req, res) => {
  try {
    const sym = String(req.params.symbol || "").trim();
    if (!sym) return res.status(400).json({ ok: false, error: "symbol mancante" });
    const [item] = await dbManager.listSymbols(sym);       // filtrato
    if (!item) return res.status(404).json({ ok: false, error: "Not found" });
    res.json({ ok: true, item });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

return router;
}