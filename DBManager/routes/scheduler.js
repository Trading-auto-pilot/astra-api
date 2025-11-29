// routes/scheduler.js
"use strict";

const express = require("express");
const router = express.Router();

/**
 * Router Scheduler.
 * Path base: /scheduler
 */
module.exports = (dbManager) => {

  // ---------------------------------------------------------------------
  // GET /scheduler/jobs
  // Ritorna i job pronti per lo Scheduler microservizio
  // ---------------------------------------------------------------------
  router.get("/jobs", async (_req, res) => {
    try {
      const items = await dbManager.getSchedulerJobsForScheduler(true);
      return res.json({ ok: true, items });
    } catch (err) {
      console.error("[GET /scheduler/jobs] Errore:", err.message);
      return res.status(500).json({
        ok: false,
        error: "Errore durante la lettura degli scheduler jobs",
        module: "[GET /scheduler/jobs]"
      });
    }
  });

  // ---------------------------------------------------------------------
  // GET /scheduler/jobs/:id
  // ---------------------------------------------------------------------
  router.get("/jobs/:id", async (req, res) => {
    const { id } = req.params;

    try {
      const job = await dbManager.getSchedulerJobById(id);
      if (!job) {
        return res.status(404).json({
          ok: false,
          error: "Job non trovato"
        });
      }

      return res.json({ ok: true, item: job });

    } catch (err) {
      console.error(`[GET /scheduler/jobs/${id}] Errore:`, err.message);
      return res.status(500).json({
        ok: false,
        error: "Errore durante la lettura del job",
        module: "[GET /scheduler/jobs/:id]"
      });
    }
  });

  // ---------------------------------------------------------------------
  // POST /scheduler/jobs
  // body: { job: {...}, rules: [...] }
  // ---------------------------------------------------------------------
  router.post("/jobs", async (req, res) => {
    const job = req.body?.job;
    const rules = req.body?.rules;

    if (!job || !Array.isArray(rules)) {
      return res.status(400).json({
        ok: false,
        error: "Serve { job: {...}, rules: [...] }"
      });
    }

    try {
      const result = await dbManager.createSchedulerJobWithRules({
        ...job,
        rules
      });

      return res.json({ ok: true, ...result });

    } catch (err) {
      console.error("[POST /scheduler/jobs] Errore:", err.message);
      return res.status(500).json({
        ok: false,
        error: "Errore durante la creazione del job",
        module: "[POST /scheduler/jobs]"
      });
    }
  });

  // ---------------------------------------------------------------------
  // PUT /scheduler/jobs/:id
  // Sostituisce job + tutte le regole
  // ---------------------------------------------------------------------
  router.put("/jobs/:id", async (req, res) => {
    const { id } = req.params;
    const job = req.body?.job;
    const rules = req.body?.rules;

    if (!job || !Array.isArray(rules)) {
      return res.status(400).json({
        ok: false,
        error: "Serve { job: {...}, rules: [...] }"
      });
    }

    try {
      const result = await dbManager.updateSchedulerJobWithRules(id, {
        ...job,
        rules
      });

      if (result.notFound) {
        return res.status(404).json({
          ok: false,
          error: "Job non trovato"
        });
      }

      return res.json({ ok: true, ...result });

    } catch (err) {
      console.error("[PUT /scheduler/jobs/:id] Errore:", err.message);
      return res.status(500).json({
        ok: false,
        error: "Errore durante l'aggiornamento del job",
        module: "[PUT /scheduler/jobs/:id]"
      });
    }
  });

  // ---------------------------------------------------------------------
  // DELETE /scheduler/jobs/:id
  // ---------------------------------------------------------------------
  router.delete("/jobs/:id", async (req, res) => {
    const { id } = req.params;

    try {
      const result = await dbManager.deleteSchedulerJob(id);

      if (!result.affectedRows) {
        return res.status(404).json({
          ok: false,
          error: "Job non trovato",
          module: "[DELETE /scheduler/jobs/:id]"
        });
      }

      return res.json({ ok: true, ...result });

    } catch (err) {
      console.error("[DELETE /scheduler/jobs/:id] Errore:", err.message);
      return res.status(500).json({
        ok: false,
        error: "Errore durante la cancellazione del job",
        module: "[DELETE /scheduler/jobs/:id]"
      });
    }
  });

  return router;
};
