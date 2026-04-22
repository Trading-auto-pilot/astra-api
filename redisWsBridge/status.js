const { Router } = require('express');
const { getConfigInt, getConfigString } = require('../shared/loadSettings');

module.exports = ({ cfg, hub, bus }) => {
  const r = Router();
  const allowedKeys = ['telemetry', 'metrics', 'data', 'logs', 'events'];
  const defaultIntervals = { telemetry: 1000, metrics: 1000, data: 0, logs: 0, events: 0 };
  r.get('/health', (_req, res) => res.json({ ok: true, service: 'redis-ws-bridge', env: cfg.env, ts: new Date().toISOString() }));
  r.get('/clients', (_req, res) => res.json(hub.getClientsSnapshot()));
  r.get('/metrics', (_req, res) => res.json(hub.getMetrics()));
  r.get('/bus',     (_req, res) => res.json(bus.status()));

  // /status/communicationChannels (GET)
  r.get('/communicationChannels', (_req, res) => {
    try {
      const channelsCfg = bus?.channelsCfg || {};
      const channels = {};
      for (const key of allowedKeys) {
        const cfgKey = channelsCfg[key] || {};
        const ms =
          typeof cfgKey?.params?.intervalsMs === 'number'
            ? cfgKey.params.intervalsMs
            : defaultIntervals[key];
        channels[key] = {
          on: typeof cfgKey?.on === 'boolean' ? cfgKey.on : true,
          params: { intervalsMs: ms },
        };
      }
      res.json({ communicationChannels: channels });
    } catch (e) {
      cfg?.logger?.error?.(`[redisWsBridge] [GET] /communicationChannels ${e?.message || e}`);
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // /status/communicationChannels (PUT)
  r.put('/communicationChannels', (req, res) => {
    const maxInterval = getConfigInt('MAX_RETRY_DELAY', 60000);
    try {
      const input = (req.body && (req.body.communicationChannels || req.body)) || {};
      if (typeof input !== 'object' || Array.isArray(input)) {
        return res.status(400).json({
          error: 'payload non valido: atteso oggetto di configurazione',
        });
      }

      const normalized = {};
      const details = {};

      for (const key of allowedKeys) {
        const cfgKey = input[key];
        if (!cfgKey || typeof cfgKey !== 'object') continue;

        if (typeof cfgKey.on !== 'boolean') {
          return res.status(400).json({
            error: `chiave "${key}": "on" deve essere booleano`,
          });
        }

        const ms = cfgKey?.params?.intervalsMs;
        if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 0) {
          return res.status(400).json({
            error: `chiave "${key}": "params.intervalsMs" deve essere intero >= 0`,
          });
        }

        const clamped = Math.min(ms, maxInterval);
        const nowCfg = { on: cfgKey.on, params: { intervalsMs: clamped } };
        normalized[key] = nowCfg;
        details[key] = { on: nowCfg.on, intervalsMs: nowCfg.params.intervalsMs };
        if (typeof bus?.setChannelConfig === 'function') {
          bus.setChannelConfig(key, nowCfg);
        }
      }

      return res.status(200).json({
        communicationChannels: normalized,
        details,
        maxAllowedIntervalMs: maxInterval,
      });
    } catch (e) {
      cfg?.logger?.error?.(`[redisWsBridge] [PUT] /communicationChannels ${e?.message || e}`);
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ---------- Log level ----------
  r.get('/logLevel', (_req, res) => {
    const current =
      cfg?.logger && typeof cfg.logger.getLevel === 'function'
        ? cfg.logger.getLevel()
        : getConfigString('LOG_LEVEL', 'info');
    res.status(200).json({ redisWsBridge: current });
  });

  r.put('/logLevel', (req, res) => {
    const { logLevel } = req.body || {};
    if (!logLevel || !cfg?.logger || typeof cfg.logger.setLevel !== 'function') {
      return res
        .status(400)
        .json({ success: false, error: 'Missing logLevel or setter not available' });
    }
    cfg.logger.setLevel(logLevel);
    const current =
      cfg?.logger && typeof cfg.logger.getLevel === 'function'
        ? cfg.logger.getLevel()
        : logLevel;
    res.status(200).json({ success: true, redisWsBridge: current });
  });
  return r;
};
