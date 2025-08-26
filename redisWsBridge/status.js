const { Router } = require('express');

module.exports = ({ cfg, hub, bus }) => {
  const r = Router();
  r.get('/health', (_req, res) => res.json({ ok: true, service: 'redis-ws-bridge', env: cfg.env, ts: new Date().toISOString() }));
  r.get('/clients', (_req, res) => res.json(hub.getClientsSnapshot()));
  r.get('/metrics', (_req, res) => res.json(hub.getMetrics()));
  r.get('/bus',     (_req, res) => res.json(bus.status()));
  return r;
};
