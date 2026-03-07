// routes/serviceFlags.js
"use strict";

const express = require("express");

module.exports = (dbManager) => {
  const router = express.Router();

  // GET /service-flags
  router.get("/", async (_req, res) => {
    try {
      const items = await dbManager.getAllServiceFlags();
      return res.json({ ok: true, items });
    } catch (err) {
      console.error("[GET /service-flags] Error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante la lettura dei service flags" });
    }
  });

  // GET /service-flags/:id
  router.get("/:id", async (req, res) => {
    const { id } = req.params;
    try {
      const item = await dbManager.getServiceFlagById(id);
      if (!item) {
        return res.status(404).json({ ok: false, error: "Flag non trovato" });
      }
      return res.json({ ok: true, item });
    } catch (err) {
      console.error("[GET /service-flags/:id] Error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante la lettura del flag" });
    }
  });

  // POST /service-flags
  router.post("/", async (req, res) => {
    const { env, microservice, enabled = true, note = null } = req.body || {};
    if (!env || !microservice) {
      return res.status(400).json({ ok: false, error: "env e microservice sono obbligatori" });
    }
    try {
      const result = await dbManager.createServiceFlag({ env, microservice, enabled, note });
      return res.json({ ok: true, ...result });
    } catch (err) {
      if (err.code === "DUPLICATE") {
        return res.status(409).json({ ok: false, error: err.message });
      }
      console.error("[POST /service-flags] Error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante la creazione del flag" });
    }
  });

  // PUT /service-flags/:id
  router.put("/:id", async (req, res) => {
    const { id } = req.params;
    const { env, microservice, enabled = true, note = null } = req.body || {};
    if (!env || !microservice) {
      return res.status(400).json({ ok: false, error: "env e microservice sono obbligatori" });
    }
    try {
      const result = await dbManager.updateServiceFlag(id, { env, microservice, enabled, note });
      if (!result.updated) {
        return res.status(404).json({ ok: false, error: "Flag non trovato" });
      }
      return res.json({ ok: true, ...result });
    } catch (err) {
      if (err.code === "DUPLICATE") {
        return res.status(409).json({ ok: false, error: err.message });
      }
      console.error("[PUT /service-flags/:id] Error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante l'aggiornamento del flag" });
    }
  });

  // DELETE /service-flags/:id
  router.delete("/:id", async (req, res) => {
    const { id } = req.params;
    try {
      const result = await dbManager.deleteServiceFlag(id);
      if (!result.deleted) {
        return res.status(404).json({ ok: false, error: "Flag non trovato" });
      }
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[DELETE /service-flags/:id] Error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante la cancellazione del flag" });
    }
  });

  return router;
};
