// /routes/auth.js

const express = require("express");
const cache = require("../../shared/cache");
const router = express.Router();

module.exports = (dbManager) => {

  // ============================
  // USERS
  // ============================

  // GET /auth/users
  router.get("/users", async (req, res) => {
    const cacheKey = "auth:users:all";

    let data = await cache.get(cacheKey);
    if (data) return res.json(data);

    try {
      const users = await dbManager.getAllUsers();
      await cache.set(cacheKey, users);
      return res.json(users);
    } catch (err) {
      console.error("[GET /auth/users] Errore:", err.message);
      res.status(500).json({ error: "Errore durante la lettura utenti" });
    }
  });

  // GET /auth/users/:id
  router.get("/users/:id", async (req, res) => {
    const userId = Number(req.params.id);
    if (!userId) return res.status(400).json({ error: "ID non valido" });

    try {
      const user = await dbManager.getUserById(userId);
      if (!user) return res.status(404).json({ error: "Utente non trovato" });

      return res.json(user);
    } catch (err) {
      console.error("[GET /auth/users/:id] Errore:", err.message);
      res.status(500).json({ error: "Errore durante la lettura utente" });
    }
  });

  // POST /auth/users (password_hash deve arrivare già hashato)
  router.post("/users", async (req, res) => {
    const payload = req.body || {};

    if (!payload.username || !payload.password_hash) {
      return res.status(400).json({
        error: "username e password_hash sono obbligatori",
      });
    }

    try {
      const result = await dbManager.createUser(payload);
      await cache.del("auth:users:all");
      return res.json(result);
    } catch (err) {
      console.error("[POST /auth/users] Errore:", err.message);
      res.status(500).json({ error: "Errore durante la creazione utente" });
    }
  });

  // PUT /auth/users/:id
  router.put("/users/:id", async (req, res) => {
    const userId = Number(req.params.id);
    if (!userId) return res.status(400).json({ error: "ID non valido" });

    const payload = req.body || {};

    try {
      const result = await dbManager.updateUser(userId, payload);
      await cache.del("auth:users:all");
      return res.json(result);
    } catch (err) {
      console.error("[PUT /auth/users/:id] Errore:", err.message);
      res.status(500).json({ error: "Errore durante l'aggiornamento utente" });
    }
  });

  // DELETE /auth/users/:id
  router.delete("/users/:id", async (req, res) => {
    const userId = Number(req.params.id);
    if (!userId) return res.status(400).json({ error: "ID non valido" });

    try {
      const result = await dbManager.deleteUser(userId);
      await cache.del("auth:users:all");
      return res.json(result);
    } catch (err) {
      console.error("[DELETE /auth/users/:id] Errore:", err.message);
      res.status(500).json({ error: "Errore durante la cancellazione utente" });
    }
  });

  // ============================
  // PERMISSIONS
  // ============================

  // GET /auth/users/:id/permissions
  router.get("/users/:id/permissions", async (req, res) => {
    const userId = Number(req.params.id);
    if (!userId) return res.status(400).json({ error: "ID non valido" });

    try {
      const perms = await dbManager.getUserPermissions(userId);
      return res.json(perms);
    } catch (err) {
      console.error("[GET /auth/users/:id/permissions] Errore:", err.message);
      res.status(500).json({ error: "Errore durante la lettura permessi" });
    }
  });

  // POST /auth/users/:id/permissions
  router.post("/users/:id/permissions", async (req, res) => {
    const userId = Number(req.params.id);
    const payload = req.body || {};

    if (!payload.permission_code) {
      return res.status(400).json({
        error: "permission_code è obbligatorio",
      });
    }

    try {
      const result = await dbManager.addUserPermission(userId, payload);
      return res.json(result);
    } catch (err) {
      console.error("[POST /auth/:id/permissions] Errore:", err.message);
      res.status(500).json({ error: "Errore durante la creazione del permesso" });
    }
  });

  // PUT /auth/users/:id/permissions/:permId
  router.put("/users/:id/permissions/:permId", async (req, res) => {
    const userId = Number(req.params.id);
    const permId = Number(req.params.permId);
    const payload = req.body || {};

    if (!userId || !permId) {
      return res.status(400).json({ error: "ID non valido" });
    }

    try {
      const result = await dbManager.updateUserPermission(userId, permId, payload);
      return res.json(result);
    } catch (err) {
      console.error("[PUT /auth/users/:id/permissions/:permId] Errore:", err.message);
      res.status(500).json({ error: "Errore durante l'aggiornamento permesso" });
    }
  });

  // DELETE /auth/users/:id/permissions/:permId
  router.delete("/users/:id/permissions/:permId", async (req, res) => {
    const userId = Number(req.params.id);
    const permId = Number(req.params.permId);

    if (!userId || !permId) {
      return res.status(400).json({ error: "ID non valido" });
    }

    try {
      const result = await dbManager.deleteUserPermission(userId, permId);
      return res.json(result);
    } catch (err) {
      console.error("[DELETE /auth/users/:id/permissions/:permId] Errore:", err.message);
      res.status(500).json({ error: "Errore durante la cancellazione permesso" });
    }
  });

  return router;
};
