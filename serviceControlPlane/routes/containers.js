// routes/containers.js (mounted at /containers)
"use strict";

const { Router } = require("express");
const docker = require("../lib/dockerClient");

module.exports = function buildContainersRouter({ logger }) {
  const router = Router();

  // GET /containers — list all containers
  router.get("/", async (_req, res) => {
    try {
      const { status, body } = await docker.listContainers();
      if (status !== 200) {
        return res.status(status).json({ ok: false, error: body?.message || "Docker error" });
      }
      const containers = body.map((c) => ({
        id: c.Id,
        name: (c.Names?.[0] || "").replace(/^\//, ""),
        image: c.Image,
        state: c.State,
        status: c.Status,
      }));
      return res.json({ ok: true, containers });
    } catch (err) {
      logger?.error?.("[GET /containers] error:", err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /containers/:name/start
  router.post("/:name/start", async (req, res) => {
    const { name } = req.params;
    try {
      const { status, body } = await docker.startContainer(name);
      // 204 = started, 304 = already running
      if (status === 204 || status === 304) return res.json({ ok: true });
      return res.status(status).json({ ok: false, error: body?.message || `Docker status ${status}` });
    } catch (err) {
      logger?.error?.(`[POST /containers/${name}/start] error:`, err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /containers/:name/stop
  router.post("/:name/stop", async (req, res) => {
    const { name } = req.params;
    try {
      const { status, body } = await docker.stopContainer(name);
      // 204 = stopped, 304 = already stopped
      if (status === 204 || status === 304) return res.json({ ok: true });
      return res.status(status).json({ ok: false, error: body?.message || `Docker status ${status}` });
    } catch (err) {
      logger?.error?.(`[POST /containers/${name}/stop] error:`, err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /containers/:name/restart
  router.post("/:name/restart", async (req, res) => {
    const { name } = req.params;
    try {
      const { status, body } = await docker.restartContainer(name);
      if (status === 204) return res.json({ ok: true });
      return res.status(status).json({ ok: false, error: body?.message || `Docker status ${status}` });
    } catch (err) {
      logger?.error?.(`[POST /containers/${name}/restart] error:`, err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
};
