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

  //Navigazione client

// LIST – tutte le pagine client per utente
router.get("/users/:id/client-nav", async (req, res) => {
  const userId = Number(req.params.id);

  if (!userId) {
    return res.status(400).json({ error: "ID non valido" });
  }

  try {
    const rows = await dbManager.getUserClientNavigation(userId);
    return res.json(rows);
  } catch (err) {
    console.error(
      "[GET /auth/users/:id/client-nav] Errore:",
      err.message || err
    );
    return res
      .status(500)
      .json({ error: "Errore durante la lettura della navigazione client" });
  }
});

// CREATE – aggiunge una pagina per l’utente
router.post("/users/:id/client-nav", async (req, res) => {
  const userId = Number(req.params.id);
  const { page } = req.body || {};

  if (!userId) {
    return res.status(400).json({ error: "ID non valido" });
  }
  if (!page) {
    return res.status(400).json({ error: "Campo 'page' obbligatorio" });
  }

  try {
    const result = await dbManager.addUserClientNavigation(userId, page);
    return res.json(result);
  } catch (err) {
    console.error(
      "[POST /auth/users/:id/client-nav] Errore:",
      err.message || err
    );
    return res
      .status(500)
      .json({ error: "Errore durante l'inserimento della navigazione client" });
  }
});

// UPDATE – modifica una pagina esistente
router.put("/users/:id/client-nav/:navId", async (req, res) => {
  const userId = Number(req.params.id);
  const navId = Number(req.params.navId);
  const { page } = req.body || {};

  if (!userId || !navId) {
    return res.status(400).json({ error: "ID non valido" });
  }
  if (!page) {
    return res.status(400).json({ error: "Campo 'page' obbligatorio" });
  }

  try {
    const result = await dbManager.updateUserClientNavigation(userId, navId, page);
    return res.json(result);
  } catch (err) {
    console.error(
      "[PUT /auth/users/:id/client-nav/:navId] Errore:",
      err.message || err
    );
    return res
      .status(500)
      .json({ error: "Errore durante l'aggiornamento della navigazione client" });
  }
});

// DELETE – rimuove una pagina dalla navigazione dell’utente
router.delete("/users/:id/client-nav/:navId", async (req, res) => {
  const userId = Number(req.params.id);
  const navId = Number(req.params.navId);

  if (!userId || !navId) {
    return res.status(400).json({ error: "ID non valido" });
  }

  try {
    const result = await dbManager.deleteUserClientNavigation(userId, navId);
    return res.json(result);
  } catch (err) {
    console.error(
      "[DELETE /auth/users/:id/client-nav/:navId] Errore:",
      err.message || err
    );
    return res
      .status(500)
      .json({ error: "Errore durante la cancellazione della navigazione client" });
  }
});



  // ================
  // API KEYS CRUD
  // ================

  router.get("/api-keys", async (req, res) => {
    try {
      const rows = await dbManager.getAllApiKeys();
      res.json(rows);
    } catch (err) {
      console.error("[GET /auth/api-keys] Error:", err.message || err);
      res
        .status(err.statusCode || 500)
        .json({ error: "Errore durante la lettura delle API keys" });
    }
  });

  router.get("/api-keys/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "ID non valido" });
    }

    try {
      const row = await dbManager.getApiKeyById(id);
      if (!row) {
        return res.status(404).json({ error: "API key non trovata" });
      }
      res.json(row);
    } catch (err) {
      console.error("[GET /auth/api-keys/:id] Error:", err.message || err);
      res
        .status(err.statusCode || 500)
        .json({ error: "Errore durante la lettura della API key" });
    }
  });

  router.post("/api-keys", async (req, res) => {
    try {
      const result = await dbManager.createApiKey(req.body || {});
      res.json(result);
    } catch (err) {
      console.error("[POST /auth/api-keys] Error:", err.message || err);
      res
        .status(err.statusCode || 500)
        .json({ error: err.message || "Errore durante la creazione API key" });
    }
  });

  router.put("/api-keys/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "ID non valido" });
    }

    try {
      const result = await dbManager.updateApiKey(id, req.body || {});
      res.json(result);
    } catch (err) {
      console.error("[PUT /auth/api-keys/:id] Error:", err.message || err);
      res
        .status(err.statusCode || 500)
        .json({ error: "Errore durante l'aggiornamento API key" });
    }
  });

  router.delete("/api-keys/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "ID non valido" });
    }

    try {
      const result = await dbManager.deleteApiKey(id);
      res.json(result);
    } catch (err) {
      console.error("[DELETE /auth/api-keys/:id] Error:", err.message || err);
      res
        .status(err.statusCode || 500)
        .json({ error: "Errore durante la cancellazione API key" });
    }
  });

  // ===========================
  // PERMISSIONS per API KEY
  // ===========================

  router.get("/api-keys/:id/permissions", async (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "ID non valido" });
    }

    try {
      const rows = await dbManager.getPermissionsForApiKey(id);
      res.json(rows);
    } catch (err) {
      console.error(
        "[GET /auth/api-keys/:id/permissions] Error:",
        err.message || err
      );
      res
        .status(err.statusCode || 500)
        .json({
          error: "Errore durante la lettura dei permessi API key",
        });
    }
  });

  router.post("/api-keys/:id/permissions", async (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "ID non valido" });
    }

    try {
      const result = await dbManager.addPermissionToApiKey(id, req.body || {});
      res.json(result);
    } catch (err) {
      console.error(
        "[POST /auth/api-keys/:id/permissions] Error:",
        err.message || err
      );
      res
        .status(err.statusCode || 500)
        .json({
          error: err.message || "Errore durante la creazione permesso API key",
        });
    }
  });

  router.put(
    "/api-keys/:id/permissions/:permId",
    async (req, res) => {
      const id = Number(req.params.id);
      const permId = Number(req.params.permId);
      if (!id || !permId) {
        return res.status(400).json({ error: "ID non valido" });
      }

      try {
        const result = await dbManager.updatePermissionForApiKey(
          id,
          permId,
          req.body || {}
        );
        res.json(result);
      } catch (err) {
        console.error(
          "[PUT /auth/api-keys/:id/permissions/:permId] Error:",
          err.message || err
        );
        res
          .status(err.statusCode || 500)
          .json({
            error:
              "Errore durante l'aggiornamento del permesso API key",
          });
      }
    }
  );

  router.delete(
    "/api-keys/:id/permissions/:permId",
    async (req, res) => {
      const id = Number(req.params.id);
      const permId = Number(req.params.permId);
      if (!id || !permId) {
        return res.status(400).json({ error: "ID non valido" });
      }

      try {
        const result = await dbManager.deletePermissionForApiKey(id, permId);
        res.json(result);
      } catch (err) {
        console.error(
          "[DELETE /auth/api-keys/:id/permissions/:permId] Error:",
          err.message || err
        );
        res
          .status(err.statusCode || 500)
          .json({
            error:
              "Errore durante la cancellazione del permesso API key",
          });
      }
    }
  );

  // GET /auth/api-keys/lookup?api_key=xxxx
  router.get("/api-keys/lookup", async (req, res) => {
    const apiKey = req.query.api_key;
    if (!apiKey) {
      return res.status(400).json({ error: "api_key è obbligatorio" });
    }

    try {
      const row = await auth.getApiKeyByValue(apiKey);
      if (!row) {
        return res.status(404).json({ error: "API key non trovata" });
      }
      res.json(row);
    } catch (err) {
      console.error("[GET /auth/api-keys/lookup] Error:", err.message || err);
      res
        .status(err.statusCode || 500)
        .json({ error: "Errore durante la ricerca API key" });
    }
  });

  return router;
};
