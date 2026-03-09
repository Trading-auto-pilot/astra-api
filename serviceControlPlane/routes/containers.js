// routes/containers.js (mounted at /containers)
"use strict";

const { Router } = require("express");
const docker = require("../lib/dockerClient");

module.exports = function buildContainersRouter({ logger, getService }) {
  const router = Router();
  const CACHE_TTL_SECONDS = 10;

  // GET /containers — list all containers
  router.get("/", async (_req, res) => {
    try {
      const service = typeof getService === "function" ? getService() : null;
      const bus = service?.bus || null;
      const cacheKey = bus?.key
        ? bus.key("servicecontrolplane", "containers")
        : "servicecontrolplane:containers";

      // 1) Try Redis cache first
      if (bus?.get) {
        try {
          const cached = await bus.get(cacheKey);
          if (cached?.ok === true && Array.isArray(cached?.containers)) {
            return res.json({
              ...cached,
              cache: "HIT",
            });
          }
        } catch (cacheErr) {
          logger?.warning?.("[GET /containers] redis cache read failed:", cacheErr?.message || String(cacheErr));
        }
      }

      // 2) Fallback to Docker API
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

      const payload = { ok: true, containers };

      // 3) Persist cache in Redis with TTL 10 seconds
      if (bus?.set) {
        try {
          await bus.set(cacheKey, payload, { EX: CACHE_TTL_SECONDS });
        } catch (cacheErr) {
          logger?.warning?.("[GET /containers] redis cache write failed:", cacheErr?.message || String(cacheErr));
        }
      }

      return res.json({
        ...payload,
        cache: "MISS",
      });
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
