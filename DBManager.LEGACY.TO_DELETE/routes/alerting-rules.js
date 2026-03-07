// routes/alerting-rules.js
"use strict";

const express = require("express");

module.exports = (dbManager) => {
  const router = express.Router();

  const normalizeMatchJson = (matchJson) => {
    if (!matchJson || typeof matchJson !== "object" || Array.isArray(matchJson)) return matchJson;
    const hasEventKey = Boolean(matchJson.event_key || matchJson.eventKey);
    const rawSource = String(matchJson.source || "").toLowerCase().trim();
    const source = rawSource === "events" || rawSource === "logs"
      ? rawSource
      : hasEventKey
        ? "events"
        : "logs";
    return { ...matchJson, source };
  };

  router.get("/", async (_req, res) => {
    try {
      const items = await dbManager.getAllAlertingRules();
      return res.json({ ok: true, items });
    } catch (err) {
      console.error("[GET /alerting-rules] Error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante la lettura delle regole" });
    }
  });

  router.get("/:id", async (req, res) => {
    const { id } = req.params;
    try {
      const item = await dbManager.getAlertingRuleById(id);
      if (!item) return res.status(404).json({ ok: false, error: "Regola non trovata" });
      return res.json({ ok: true, item });
    } catch (err) {
      console.error("[GET /alerting-rules/:id] Error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante la lettura della regola" });
    }
  });

  router.post("/", async (req, res) => {
    const body = req.body || {};
    const match_json = normalizeMatchJson(body.match_json);
    const { name, actions_json } = body;
    if (!name || !match_json || !actions_json) {
      return res.status(400).json({ ok: false, error: "name, match_json, actions_json sono obbligatori" });
    }
    try {
      const result = await dbManager.createAlertingRule({ ...body, match_json });
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[POST /alerting-rules] Error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante la creazione della regola" });
    }
  });

  router.put("/:id", async (req, res) => {
    const { id } = req.params;
    const body = req.body || {};
    const match_json = normalizeMatchJson(body.match_json);
    const { name, actions_json } = body;
    if (!name || !match_json || !actions_json) {
      return res.status(400).json({ ok: false, error: "name, match_json, actions_json sono obbligatori" });
    }
    try {
      const result = await dbManager.updateAlertingRule(id, { ...body, match_json });
      if (!result.updated) return res.status(404).json({ ok: false, error: "Regola non trovata" });
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[PUT /alerting-rules/:id] Error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante l'aggiornamento della regola" });
    }
  });

  router.delete("/:id", async (req, res) => {
    const { id } = req.params;
    try {
      const result = await dbManager.deleteAlertingRule(id);
      if (!result.deleted) return res.status(404).json({ ok: false, error: "Regola non trovata" });
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[DELETE /alerting-rules/:id] Error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante la cancellazione della regola" });
    }
  });

  return router;
};
