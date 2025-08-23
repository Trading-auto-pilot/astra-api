// status.js
const { Router } = require('express');

module.exports = function buildStatusRouter({ liveMarketListner, logger, moduleName }) {
  const router = Router();

  // /status/health
  router.get('/health', (_req, res) => {
    res.json({ status: 'OK', module: moduleName, uptime: process.uptime() });
  });

  // /status/info
  router.get('/info', (_req, res) => {
    try {
      res.json(liveMarketListner.getInfo());
    } catch (e) {
      logger.error(`[status/info] ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // /status/params
  router.get('/params', (_req, res) => {
    try {
      res.json(liveMarketListner.getModuleParams());
    } catch (e) {
      logger.error(`[status/params] ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // /status/connection
  router.get('/connection', (_req, res) => {
    try {
      res.json(liveMarketListner.getConnectionStatus());
    } catch (e) {
      logger.error(`[status/connection] ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // /status/loglevel (SOLO GET)
  router.get('/loglevel', (_req, res) => {
    try {
      res.json({
        liveMarketListner: liveMarketListner.getLogLevel(),
        alpacaSocket: liveMarketListner.getLogLevel('alpacaSocket'),
        RESTServer: 'managed-via-PUT-/loglevel/RESTServer'
      });
    } catch (e) {
      logger.error(`[status/loglevel] ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
