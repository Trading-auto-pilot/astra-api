// routes/fundamentalsCompat.js
// DBManager-compatible /fundamentals/* endpoints used by tickerScanner and other services.
// Mounted at /fundamentals in datahub/server.js.
"use strict";

module.exports = function ({ logger, schemaReader }) {
  const express = require("express");
  const router = express.Router();

  // GET /fundamentals/user-filters/:userId?pipeId=...
  router.get("/user-filters/:userId", async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      if (!Number.isFinite(userId)) {
        return res.status(400).json({ ok: false, error: "userId non valido" });
      }
      const pipeId = req.query.pipeId !== undefined ? req.query.pipeId : null;
      let sql =
        "SELECT id, user_id, pipe_id, filter_name, value, comparator, enabled, created_at, updated_at FROM user_filters WHERE user_id = ?";
      const params = [userId];
      if (pipeId !== null && pipeId !== undefined && pipeId !== "") {
        sql += " AND pipe_id <=> ?";
        params.push(Number(pipeId));
      }
      const [rows] = await schemaReader.query(sql, params);
      return res.json({ ok: true, data: rows });
    } catch (err) {
      logger?.error?.(`[GET /fundamentals/user-filters] ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura user_filters" });
    }
  });

  // GET /fundamentals/user-order/:userId?pipeId=...
  router.get("/user-order/:userId", async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      if (!Number.isFinite(userId)) {
        return res.status(400).json({ ok: false, error: "userId non valido" });
      }
      const pipeId = req.query.pipeId !== undefined ? req.query.pipeId : null;
      let sql = "SELECT * FROM user_order_by WHERE user_id = ?";
      const params = [userId];
      if (pipeId !== null && pipeId !== undefined && pipeId !== "") {
        sql += " AND pipe_id <=> ?";
        params.push(Number(pipeId));
      }
      sql += " ORDER BY order_id ASC, id ASC";
      const [rows] = await schemaReader.query(sql, params);
      return res.json({ ok: true, data: rows });
    } catch (err) {
      logger?.error?.(`[GET /fundamentals/user-order] ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura user_order_by" });
    }
  });

  // GET /fundamentals/scores-daily/by-user?user_id=&pipe_id=&score_date=
  router.get("/scores-daily/by-user", async (req, res) => {
    try {
      const userId = Number(req.query.user_id);
      const pipeId = Number(req.query.pipe_id);
      const scoreDate = req.query.score_date ?? req.query.scoreDate ?? null;
      if (!Number.isFinite(userId) || !Number.isFinite(pipeId) || !scoreDate) {
        return res.status(400).json({ ok: false, error: "user_id, pipe_id, score_date obbligatori" });
      }
      const sql = `
        SELECT *
          FROM scores_daily
         WHERE user_id = ?
           AND pipe_id = ?
           AND score_date = ?
         ORDER BY symbol ASC
      `;
      const [rows] = await schemaReader.query(sql, [userId, pipeId, scoreDate]);
      return res.json({ ok: true, data: rows });
    } catch (err) {
      logger?.error?.(`[GET /fundamentals/scores-daily/by-user] ${err?.message || String(err)}`);
      return res.status(500).json({ ok: false, error: "Errore lettura scores_daily by-user" });
    }
  });

  return router;
};
