// serviceFlags.js (mounted at /service-flags)
"use strict";

const express = require("express");
const { createServiceFlagsClient } = require("./modules/serviceFlags");

module.exports = (getService, logger) => {
  const router = express.Router();

  // Helper to get client lazily
  const getClient = () => {
    const service = getService();
    return createServiceFlagsClient(service.dbmanagerUrl, logger);
  };

  router.get("/", async (_req, res) => {
    try {
      const items = await getClient().list();
      return res.json({ ok: true, items });
    } catch (err) {
      logger.error("[GET /service-flags] error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante la lettura dei flag" });
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      const item = await getClient().get(req.params.id);
      if (!item) return res.status(404).json({ ok: false, error: "Flag non trovato" });
      return res.json({ ok: true, item });
    } catch (err) {
      logger.error("[GET /service-flags/:id] error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante la lettura del flag" });
    }
  });

  router.post("/", async (req, res) => {
    const { env, microservice, enabled = true, note = null } = req.body || {};
    if (!env || !microservice) {
      return res.status(400).json({ ok: false, error: "env e microservice sono obbligatori" });
    }
    try {
      const result = await getClient().create({ env, microservice, enabled, note });
      // restituiamo il record appena creato se disponibile
      if (result?.id) {
        const item = await getClient().get(result.id);
        return res.json({ ok: true, item, ...result });
      }
      return res.json(result);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 409) return res.status(409).json(err.response.data);
      logger.error("[POST /service-flags] error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante la creazione del flag" });
    }
  });

  router.put("/:id", async (req, res) => {
    const { env, microservice, enabled = true, note = null } = req.body || {};
    if (!env || !microservice) {
      return res.status(400).json({ ok: false, error: "env e microservice sono obbligatori" });
    }
    try {
      const result = await getClient().update(req.params.id, { env, microservice, enabled, note });
      // ritorna il record aggiornato se possibile
      const item = await getClient().get(req.params.id).catch(() => null);
      return res.json({ ok: true, item, ...result });
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404 || status === 409) return res.status(status).json(err.response.data);
      logger.error("[PUT /service-flags/:id] error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante l'aggiornamento del flag" });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      const result = await getClient().remove(req.params.id);
      return res.json(result);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) return res.status(404).json(err.response.data);
      logger.error("[DELETE /service-flags/:id] error:", err.message || err);
      return res.status(500).json({ ok: false, error: "Errore durante la cancellazione del flag" });
    }
  });

  return router;
};
