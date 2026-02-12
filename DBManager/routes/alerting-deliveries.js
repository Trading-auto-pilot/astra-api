// routes/alerting-deliveries.js
"use strict";

const express = require("express");

module.exports = (dbManager) => {
  const router = express.Router();

  router.get("/", async (_req, res) => {
    try {
      const items = await dbManager.getAllAlertingDeliveries();
      return res.json({ ok: true, items });
    } catch (err) {
      console.error("[GET /alerting-deliveries] Error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante la lettura degli invii" });
    }
  });

  router.get("/:id", async (req, res) => {
    const { id } = req.params;
    try {
      const item = await dbManager.getAlertingDeliveryById(id);
      if (!item) return res.status(404).json({ ok: false, error: "Invio non trovato" });
      return res.json({ ok: true, item });
    } catch (err) {
      console.error("[GET /alerting-deliveries/:id] Error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante la lettura dell'invio" });
    }
  });

  router.post("/", async (req, res) => {
    const { rule_id, provider, status } = req.body || {};
    if (!rule_id || !provider || !status) {
      return res.status(400).json({ ok: false, error: "rule_id, provider, status sono obbligatori" });
    }
    try {
      const result = await dbManager.createAlertingDelivery(req.body);
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[POST /alerting-deliveries] Error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante la creazione dell'invio" });
    }
  });

  router.put("/:id", async (req, res) => {
    const { id } = req.params;
    const { rule_id, provider, status } = req.body || {};
    if (!rule_id || !provider || !status) {
      return res.status(400).json({ ok: false, error: "rule_id, provider, status sono obbligatori" });
    }
    try {
      const result = await dbManager.updateAlertingDelivery(id, req.body);
      if (!result.updated) return res.status(404).json({ ok: false, error: "Invio non trovato" });
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[PUT /alerting-deliveries/:id] Error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante l'aggiornamento dell'invio" });
    }
  });

  router.delete("/:id", async (req, res) => {
    const { id } = req.params;
    try {
      const result = await dbManager.deleteAlertingDelivery(id);
      if (!result.deleted) return res.status(404).json({ ok: false, error: "Invio non trovato" });
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[DELETE /alerting-deliveries/:id] Error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante la cancellazione dell'invio" });
    }
  });

  return router;
};
