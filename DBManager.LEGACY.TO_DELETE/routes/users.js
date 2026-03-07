// routes/users.js
"use strict";

const express = require("express");

module.exports = (dbManager) => {
  const router = express.Router();

  // GET /users/:userId/pipes
  router.get("/:userId/pipes", async (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) return res.status(400).json({ ok: false, error: "userId non valido" });
    try {
      const items = await dbManager.getUserPipes(userId);
      return res.json({ ok: true, data: items });
    } catch (err) {
      console.error("[GET /users/:userId/pipes] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore lettura user_pipes" });
    }
  });

  // GET /users/:userId/pipes/:id
  router.get("/:userId/pipes/:id", async (req, res) => {
    const userId = Number(req.params.userId);
    const id = Number(req.params.id);
    if (!Number.isFinite(userId) || !Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: "userId e id obbligatori" });
    }
    try {
      const item = await dbManager.getUserPipeById({ id, userId });
      if (!item) return res.status(404).json({ ok: false, error: "Pipe non trovata" });
      return res.json({ ok: true, data: item });
    } catch (err) {
      console.error("[GET /users/:userId/pipes/:id] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore lettura pipe" });
    }
  });

  // POST /users/:userId/pipes
  router.post("/:userId/pipes", async (req, res) => {
    const userId = Number(req.params.userId);
    const { name, description = null, enabled = true } = req.body || {};
    if (!Number.isFinite(userId) || !name) {
      return res.status(400).json({ ok: false, error: "userId e name sono obbligatori" });
    }
    try {
      const result = await dbManager.createUserPipe({ userId, name, description, enabled });
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error("[POST /users/:userId/pipes] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore creazione pipe" });
    }
  });

  // PUT /users/:userId/pipes/:id
  router.put("/:userId/pipes/:id", async (req, res) => {
    const userId = Number(req.params.userId);
    const id = Number(req.params.id);
    const { name, description = null, enabled = true } = req.body || {};
    if (!Number.isFinite(userId) || !Number.isFinite(id) || !name) {
      return res.status(400).json({ ok: false, error: "userId, id e name sono obbligatori" });
    }
    try {
      const result = await dbManager.updateUserPipe({ id, userId, name, description, enabled });
      if (!result.affectedRows) return res.status(404).json({ ok: false, error: "Pipe non trovata" });
      return res.json({ ok: true });
    } catch (err) {
      console.error("[PUT /users/:userId/pipes/:id] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore aggiornamento pipe" });
    }
  });

  // DELETE /users/:userId/pipes/:id
  router.delete("/:userId/pipes/:id", async (req, res) => {
    const userId = Number(req.params.userId);
    const id = Number(req.params.id);
    if (!Number.isFinite(userId) || !Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: "userId e id obbligatori" });
    }
    try {
      const result = await dbManager.deleteUserPipe({ id, userId });
      if (!result.affectedRows) return res.status(404).json({ ok: false, error: "Pipe non trovata" });
      return res.json({ ok: true });
    } catch (err) {
      console.error("[DELETE /users/:userId/pipes/:id] Errore:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Errore cancellazione pipe" });
    }
  });

  return router;
};
