// routes/auth.js
"use strict";

/**
 * Legacy DBManager-compatible /auth endpoints
 *
 * This provides backward compatibility with DBManager's auth endpoints
 * so that authService can migrate transparently to datahub.
 *
 * These endpoints proxy to the appropriate database tables:
 * - users
 * - user_score_weights
 * - user_client_navigation
 * - roles
 * - permissions
 * - api_keys
 */

module.exports = function({ logger, schemaReader }) {
  const express = require("express");
  const router = express.Router();

  // ======================
  // USERS
  // ======================

  /**
   * GET /auth/users
   * List all users
   */
  router.get("/users", async (req, res) => {
    try {
      const [rows] = await schemaReader.query(
        "SELECT * FROM users ORDER BY id"
      );
      return res.json(rows);
    } catch (err) {
      logger.error(`[GET /auth/users] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  /**
   * GET /auth/users/:id
   * Get a specific user by ID
   */
  router.get("/users/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const [rows] = await schemaReader.query(
        "SELECT * FROM users WHERE id = ? LIMIT 1",
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          error: `User with id ${id} not found`,
        });
      }

      return res.json(rows[0]);
    } catch (err) {
      logger.error(`[GET /auth/users/:id] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  /**
   * POST /auth/users
   * Create a new user
   */
  router.post("/users", async (req, res) => {
    try {
      const userData = req.body;
      const [result] = await schemaReader.query(
        "INSERT INTO users SET ?",
        [userData]
      );

      return res.json({
        ok: true,
        id: result.insertId,
        ...userData,
      });
    } catch (err) {
      logger.error(`[POST /auth/users] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  /**
   * PUT /auth/users/:id
   * Update a user
   */
  router.put("/users/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const userData = req.body;

      const [result] = await schemaReader.query(
        "UPDATE users SET ? WHERE id = ?",
        [userData, id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          error: `User with id ${id} not found`,
        });
      }

      return res.json({
        ok: true,
        id,
        ...userData,
      });
    } catch (err) {
      logger.error(`[PUT /auth/users/:id] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  /**
   * DELETE /auth/users/:id
   * Delete a user
   */
  router.delete("/users/:id", async (req, res) => {
    try {
      const { id } = req.params;

      const [result] = await schemaReader.query(
        "DELETE FROM users WHERE id = ?",
        [id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          error: `User with id ${id} not found`,
        });
      }

      return res.json({
        ok: true,
        deleted: id,
      });
    } catch (err) {
      logger.error(`[DELETE /auth/users/:id] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  // ======================
  // USER SCORE WEIGHTS
  // ======================

  /**
   * GET /auth/users/:id/score-weights
   * Get score weights for a user (all pipes)
   */
  router.get("/users/:id/score-weights", async (req, res) => {
    try {
      const { id } = req.params;
      const [rows] = await schemaReader.query(
        "SELECT * FROM user_score_weights WHERE user_id = ?",
        [id]
      );

      return res.json(rows);
    } catch (err) {
      logger.error(`[GET /auth/users/:id/score-weights] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  /**
   * GET /auth/users/:id/score-weights/:pipeId
   * Get score weights for a user for a specific pipe
   */
  router.get("/users/:id/score-weights/:pipeId", async (req, res) => {
    try {
      const { id, pipeId } = req.params;
      const [rows] = await schemaReader.query(
        "SELECT * FROM user_score_weights WHERE user_id = ? AND pipe_id = ? LIMIT 1",
        [id, pipeId]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          error: `Score weights not found for user ${id} and pipe ${pipeId}`,
        });
      }

      return res.json(rows[0]);
    } catch (err) {
      logger.error(`[GET /auth/users/:id/score-weights/:pipeId] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  /**
   * PUT /auth/users/:id/score-weights
   * Update score weights for a user
   */
  router.put("/users/:id/score-weights", async (req, res) => {
    try {
      const { id } = req.params;
      const weightsData = req.body;

      // Update or insert
      const [result] = await schemaReader.query(
        `INSERT INTO user_score_weights SET user_id = ?, ?
         ON DUPLICATE KEY UPDATE ?`,
        [id, weightsData, weightsData]
      );

      return res.json({
        ok: true,
        user_id: id,
        ...weightsData,
      });
    } catch (err) {
      logger.error(`[PUT /auth/users/:id/score-weights] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  /**
   * POST /auth/users/:id/last-login
   * Update last login timestamp
   */
  router.post("/users/:id/last-login", async (req, res) => {
    try {
      const { id } = req.params;
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

      const [result] = await schemaReader.query(
        "UPDATE users SET last_login_at = ? WHERE id = ?",
        [now, id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          error: `User with id ${id} not found`,
        });
      }

      return res.json({
        ok: true,
        id,
        last_login_at: now,
      });
    } catch (err) {
      logger.error(`[POST /auth/users/:id/last-login] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  // ======================
  // USER CLIENT NAVIGATION
  // ======================

  /**
   * GET /auth/users/:id/client-nav
   * Get all client navigation entries for a user
   */
  router.get("/users/:id/client-nav", async (req, res) => {
    try {
      const { id } = req.params;
      const [rows] = await schemaReader.query(
        "SELECT * FROM user_client_navigation WHERE user_id = ? ORDER BY id",
        [id]
      );

      return res.json(rows);
    } catch (err) {
      logger.error(`[GET /auth/users/:id/client-nav] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  /**
   * POST /auth/users/:id/client-nav
   * Add a client navigation entry for a user
   */
  router.post("/users/:id/client-nav", async (req, res) => {
    try {
      const { id } = req.params;
      const navData = { ...req.body, user_id: id };

      const [result] = await schemaReader.query(
        "INSERT INTO user_client_navigation SET ?",
        [navData]
      );

      return res.json({
        ok: true,
        id: result.insertId,
        ...navData,
      });
    } catch (err) {
      logger.error(`[POST /auth/users/:id/client-nav] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  /**
   * PUT /auth/users/:userId/client-nav/:navId
   * Update a client navigation entry
   */
  router.put("/users/:userId/client-nav/:navId", async (req, res) => {
    try {
      const { userId, navId } = req.params;
      const navData = req.body;

      const [result] = await schemaReader.query(
        "UPDATE user_client_navigation SET ? WHERE id = ? AND user_id = ?",
        [navData, navId, userId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          error: `Navigation entry ${navId} not found for user ${userId}`,
        });
      }

      return res.json({
        ok: true,
        id: navId,
        user_id: userId,
        ...navData,
      });
    } catch (err) {
      logger.error(`[PUT /auth/users/:userId/client-nav/:navId] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  /**
   * DELETE /auth/users/:userId/client-nav/:navId
   * Delete a client navigation entry
   */
  router.delete("/users/:userId/client-nav/:navId", async (req, res) => {
    try {
      const { userId, navId } = req.params;

      const [result] = await schemaReader.query(
        "DELETE FROM user_client_navigation WHERE id = ? AND user_id = ?",
        [navId, userId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          error: `Navigation entry ${navId} not found for user ${userId}`,
        });
      }

      return res.json({
        ok: true,
        deleted: navId,
      });
    } catch (err) {
      logger.error(`[DELETE /auth/users/:userId/client-nav/:navId] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  // ======================
  // ROLES
  // ======================

  /**
   * GET /auth/roles
   * List all roles
   */
  router.get("/roles", async (req, res) => {
    try {
      const [rows] = await schemaReader.query(
        "SELECT * FROM roles ORDER BY id"
      );
      return res.json(rows);
    } catch (err) {
      logger.error(`[GET /auth/roles] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  /**
   * GET /auth/roles/:id
   * Get a specific role by ID
   */
  router.get("/roles/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const [rows] = await schemaReader.query(
        "SELECT * FROM roles WHERE id = ? LIMIT 1",
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          error: `Role with id ${id} not found`,
        });
      }

      return res.json(rows[0]);
    } catch (err) {
      logger.error(`[GET /auth/roles/:id] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  // ======================
  // USER PERMISSIONS (per user)
  // ======================

  /**
   * GET /auth/users/:userId/permissions
   * Get all permissions for a specific user
   */
  router.get("/users/:userId/permissions", async (req, res) => {
    try {
      const { userId } = req.params;
      const [rows] = await schemaReader.query(
        "SELECT * FROM user_permissions WHERE user_id = ? ORDER BY id",
        [userId]
      );

      return res.json(rows);
    } catch (err) {
      logger.error(`[GET /auth/users/:userId/permissions] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  /**
   * POST /auth/users/:userId/permissions
   * Add a permission for a user
   */
  router.post("/users/:userId/permissions", async (req, res) => {
    try {
      const { userId } = req.params;
      const permData = { ...req.body, user_id: userId };

      const [result] = await schemaReader.query(
        "INSERT INTO user_permissions SET ?",
        [permData]
      );

      return res.json({
        ok: true,
        id: result.insertId,
        ...permData,
      });
    } catch (err) {
      logger.error(`[POST /auth/users/:userId/permissions] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  /**
   * PUT /auth/users/:userId/permissions/:permId
   * Update a permission for a user
   */
  router.put("/users/:userId/permissions/:permId", async (req, res) => {
    try {
      const { userId, permId } = req.params;
      const permData = req.body;

      const [result] = await schemaReader.query(
        "UPDATE user_permissions SET ? WHERE id = ? AND user_id = ?",
        [permData, permId, userId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          error: `Permission ${permId} not found for user ${userId}`,
        });
      }

      return res.json({
        ok: true,
        id: permId,
        user_id: userId,
        ...permData,
      });
    } catch (err) {
      logger.error(`[PUT /auth/users/:userId/permissions/:permId] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  /**
   * DELETE /auth/users/:userId/permissions/:permId
   * Delete a permission for a user
   */
  router.delete("/users/:userId/permissions/:permId", async (req, res) => {
    try {
      const { userId, permId } = req.params;

      const [result] = await schemaReader.query(
        "DELETE FROM user_permissionss WHERE id = ? AND user_id = ?",
        [permId, userId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          error: `Permission ${permId} not found for user ${userId}`,
        });
      }

      return res.json({
        ok: true,
        deleted: permId,
      });
    } catch (err) {
      logger.error(`[DELETE /auth/users/:userId/permissions/:permId] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  // ======================
  // PERMISSIONS (global)
  // ======================

  /**
   * GET /auth/permissions
   * List all permissions
   */
  router.get("/permissions", async (req, res) => {
    try {
      const [rows] = await schemaReader.query(
        "SELECT * FROM user_permissions ORDER BY id"
      );
      return res.json(rows);
    } catch (err) {
      logger.error(`[GET /auth/permissions] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  /**
   * GET /auth/permissions/user/:userId
   * Get all permissions for a specific user
   */
  router.get("/permissions/user/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const [rows] = await schemaReader.query(
        "SELECT * FROM user_permissions WHERE user_id = ? ORDER BY id",
        [userId]
      );

      return res.json(rows);
    } catch (err) {
      logger.error(`[GET /auth/permissions/user/:userId] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  // ======================
  // API KEYS
  // ======================

  /**
   * GET /auth/api-keys
   * List all API keys
   */
  router.get("/api-keys", async (req, res) => {
    try {
      const [rows] = await schemaReader.query(
        "SELECT * FROM api_keys ORDER BY id"
      );
      return res.json(rows);
    } catch (err) {
      logger.error(`[GET /auth/api-keys] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  /**
   * GET /auth/api-keys/user/:userId
   * Get all API keys for a specific user
   */
  router.get("/api-keys/user/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const [rows] = await schemaReader.query(
        "SELECT * FROM api_keys WHERE user_id = ? ORDER BY id",
        [userId]
      );

      return res.json(rows);
    } catch (err) {
      logger.error(`[GET /auth/api-keys/user/:userId] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  /**
   * GET /auth/api-keys/:key
   * Get API key by key value
   */
  router.get("/api-keys/:key", async (req, res) => {
    try {
      const { key } = req.params;
      const [rows] = await schemaReader.query(
        "SELECT * FROM api_keys WHERE api_key = ? LIMIT 1",
        [key]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          error: `API key not found`,
        });
      }

      return res.json(rows[0]);
    } catch (err) {
      logger.error(`[GET /auth/api-keys/:key] Error: ${err?.message || String(err)}`);
      return res.status(500).json({
        error: err?.message || String(err),
      });
    }
  });

  return router;
};
