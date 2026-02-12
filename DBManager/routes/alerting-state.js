// routes/alerting-state.js
"use strict";

const express = require("express");

module.exports = (dbManager) => {
  const router = express.Router();

  router.get("/", async (_req, res) => {
    try {
      const items = await dbManager.getAllAlertingState();
      return res.json({ ok: true, items });
    } catch (err) {
      console.error("[GET /alerting-state] Error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante la lettura dello stato" });
    }
  });

  router.get("/:id", async (req, res) => {
    const { id } = req.params;
    try {
      const item = await dbManager.getAlertingStateById(id);
      if (!item) return res.status(404).json({ ok: false, error: "Stato non trovato" });
      return res.json({ ok: true, item });
    } catch (err) {
      console.error("[GET /alerting-state/:id] Error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante la lettura dello stato" });
    }
  });

  router.post("/", async (req, res) => {
    const { rule_id } = req.body || {};
    if (!rule_id) {
      return res.status(400).json({ ok: false, error: "rule_id è obbligatorio" });
    }
    try {
      const result = await dbManager.createAlertingState(req.body);
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[POST /alerting-state] Error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante la creazione dello stato" });
    }
  });

  router.put("/:id", async (req, res) => {
    const { id } = req.params;
    const { rule_id } = req.body || {};
    if (!rule_id) {
      return res.status(400).json({ ok: false, error: "rule_id è obbligatorio" });
    }
    try {
      const result = await dbManager.updateAlertingState(id, req.body);
      if (!result.updated) return res.status(404).json({ ok: false, error: "Stato non trovato" });
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[PUT /alerting-state/:id] Error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante l'aggiornamento dello stato" });
    }
  });

  router.delete("/:id", async (req, res) => {
    const { id } = req.params;
    try {
      const result = await dbManager.deleteAlertingState(id);
      if (!result.deleted) return res.status(404).json({ ok: false, error: "Stato non trovato" });
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[DELETE /alerting-state/:id] Error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante la cancellazione dello stato" });
    }
  });

  return router;
};
