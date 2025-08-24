// status.js
const { Router } = require('express');

const maxInterval = parseInt(process.env.MAX_RETRY_DELAY, 10) || 60000;

// opzionale: whitelist host separati da virgola (es. "localhost,stream.data.alpaca.markets")
const ALLOWED_WS_HOSTS = (process.env.ALLOWED_WS_HOSTS || 'localhost,marketsimulator,stream.data.alpaca.markets,stream.data.sandbox.alpaca.markets,data.alpaca.markets,paper.api.alpaca.markets')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// util: valida e normalizza un URL ws/wss
  function validateAndNormalizeWsUrl(input) {
    if (typeof input !== 'string') throw new Error('url deve essere una stringa');
    const raw = input.trim();
    if (!raw) throw new Error('url vuoto');

    let u;
    try { u = new URL(raw); }
    catch { throw new Error('url non valido'); }

    if (!['ws:', 'wss:'].includes(u.protocol)) {
      throw new Error('protocollo non valido (usa ws:// o wss://)');
    }
    if (!u.hostname) throw new Error('hostname assente');
    if (u.port && (isNaN(+u.port) || +u.port < 1 || +u.port > 65535)) {
      throw new Error('porta non valida');
    }

    // --- 🔑 whitelist case-insensitive + senza porta ---
    const host = u.hostname.toLowerCase(); // solo hostname
    if (ALLOWED_WS_HOSTS.length && !ALLOWED_WS_HOSTS.includes(host)) {
      throw new Error(`hostname non ammesso: ${u.hostname}`);
    }

    // normalizza path senza slash finali multipli
    u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString();
  }



module.exports = function buildStatusRouter({ marketListener, logger, moduleName }) {
  const router = Router();

  // /status/health
  router.get('/health', (_req, res) => {
    res.json({ status: 'OK', module: moduleName, uptime: process.uptime() });
  });

  // /status/info
  router.get('/info', (_req, res) => {
    try {
      res.json(marketListener.getInfo());
    } catch (e) {
      logger.error(`[status/info] ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/alpacaMarketServer', (_req, res) => {
    try {
      res.json({url : marketListener.state.alpacaMarketServer});
    } catch (e) {
      logger.error(`[status/info] [GET] /alpacaMarketServer ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

router.put('/alpacaMarketServer', async (req, res) => {
  try {
    // accetta sia { "url": "ws://..." } sia "ws://..." (se qualcuno manda raw)
    const candidate = typeof req.body === 'string' ? req.body : req.body?.url;

    const normalized = validateAndNormalizeWsUrl(candidate);

    // idempotente: se è uguale, ritorna 200 senza side-effect
    if (marketListener.state.alpacaMarketServer === normalized) {
      return res.status(200).json({
        url: normalized,
        changed: false
      });
    }

    // aggiorna lo stato
    const previous = marketListener.state.alpacaMarketServer;
    marketListener.state.alpacaMarketServer = normalized;

    return res.status(200).json({
      url: marketListener.state.alpacaMarketServer,
      previousUrl: previous || null,
      changed: true
    });
  } catch (e) {
    logger.error(`[status/info] [PUT] /alpacaMarketServer ${e.message}`);
    return res.status(400).json({ error: e.message });
  }
});

  router.get('/feed', (_req, res) => {
    try {
      res.json({url : marketListener.state.feed});
    } catch (e) {
      logger.error(`[status/info] [GET] /feed ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/feed', (req, res) => {
    try {
      const candidate = req.body?.feed;
      if (typeof candidate !== 'string') {
        return res.status(400).json({ error: 'campo "feed" mancante o non stringa' });
      }

      const normalized = candidate.trim().toLowerCase();

      // valori ammessi
      const allowedFeeds = ['iex', 'sip','test'];
      if (!allowedFeeds.includes(normalized)) {
        return res.status(400).json({
          error: `feed non valido. Valori ammessi: ${allowedFeeds.join(', ')}`
        });
      }

      const prev = marketListener.state.feed;
      if (prev === normalized) {
        logger.info(`[${moduleName}] PUT /feed: unchanged -> ${normalized}`);
        return res.status(200).json({ feed: normalized, changed: false });
      }

      // assegna (serve setter in StateManager!)
      marketListener.state.feed = normalized;

      logger.info(`[${moduleName}] PUT /feed: aggiornato ${prev || '(none)'} -> ${normalized}`);

      return res.status(200).json({
        feed: marketListener.state.feed,
        previousFeed: prev || null,
        changed: true
      });
    } catch (e) {
      logger.error(`[${moduleName}] [PUT] /feed ${e.message}`);
      return res.status(500).json({ error: e.message });
    }
  });

  router.get('/alpacaRetryDelay', (_req, res) => {
    try {
      res.json({retrayDelay : marketListener.state.alpacaRetryDelay});
    } catch (e) {
      logger.error(`[status/info] [GET] /alpacaRetryDelay ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

router.put('/alpacaRetryDelay', (req, res) => {
  try {
    const candidate = req.body?.retrayDelay;

    if (typeof candidate !== 'number' || !Number.isInteger(candidate) || candidate <= 0) {
      return res.status(400).json({ error: 'delay deve essere un intero positivo (millisecondi)' });
    }

    const normalized = Math.min(candidate, maxInterval);

    const prev = marketListener.state.alpacaRetryDelay;
    if (prev === normalized) {
      logger.info(`[${moduleName}] PUT /alpacaRetryDelay: unchanged -> ${normalized}`);
      return res.status(200).json({ delay: normalized, changed: false, maxAllowed: maxInterval });
    }

    // assegna (serve setter in StateManager!)
    marketListener.state.alpacaRetryDelay = normalized;

    logger.info(`[${moduleName}] PUT /alpacaRetryDelay: aggiornato ${prev || '(none)'} -> ${normalized}`);

    return res.status(200).json({
      delay: marketListener.state.alpacaRetryDelay,
      previousDelay: prev || null,
      changed: true,
      maxAllowed: maxInterval
    });
  } catch (e) {
    logger.error(`[${moduleName}] [PUT] /alpacaRetryDelay ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

  router.get('/symbolStrategyMap', (_req, res) => {
    try {
      res.json({symbols : marketListener.state.symbolStrategyMap});
    } catch (e) {
      logger.error(`[status/info] [GET] /symbolStrategyMap ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/alpacaMaxRetry', (_req, res) => {
    try {
      res.json({maxRetry : marketListener.state.alpacaMaxRetry});
    } catch (e) {
      logger.error(`[status/info] [GET] /alpacaMaxRetry ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/alpacaMaxRetry', (req, res) => {
    try {
      const candidate = req.body?.maxRetry;

      if (typeof candidate !== 'number' || !Number.isInteger(candidate) || candidate <= 0) {
        return res.status(400).json({ error: 'max deve essere un intero positivo' });
      }

      const normalized = candidate;
      const prev = marketListener.state.alpacaMaxRetry;

      if (prev === normalized) {
        logger.info(`[${moduleName}] PUT /alpacaMaxRetry: unchanged -> ${normalized}`);
        return res.status(200).json({ maxRetry: normalized, changed: false });
      }

      // assegna (serve setter in StateManager!)
      marketListener.state.alpacaMaxRetry = normalized;

      logger.info(`[${moduleName}] PUT /alpacaMaxRetry: aggiornato ${prev || '(none)'} -> ${normalized}`);

      return res.status(200).json({
        maxRetry: marketListener.state.alpacaMaxRetry,
        previousMax: prev || null,
        changed: true
      });
    } catch (e) {
      logger.error(`[${moduleName}] [PUT] /alpacaMaxRetry ${e.message}`);
      return res.status(500).json({ error: e.message });
    }
  });

  router.get('/moduleActive', (_req, res) => {
    try {
      res.json({moduleActive : marketListener.state.moduleActive});
    } catch (e) {
      logger.error(`[status/info] [GET] /moduleActive ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/moduleActive', (req, res) => {
    try {
      const candidate = req.body?.moduleActive;

      // Validazione: solo true/false booleano
      if (typeof candidate !== 'boolean') {
        return res.status(400).json({
          error: 'active deve essere booleano (true o false)'
        });
      }

      const prev = marketListener.state.moduleActive;
      if (prev === candidate) {
        logger.info(`[${moduleName}] PUT /moduleActive: unchanged -> ${candidate}`);
        return res.status(200).json({ moduleActive: candidate, changed: false });
      }

      // assegna (serve setter in StateManager!)
      marketListener.state.moduleActive = candidate;

      logger.info(`[${moduleName}] PUT /moduleActive: aggiornato ${prev} -> ${candidate}`);

      return res.status(200).json({
        moduleActive: marketListener.state.moduleActive,
        previousActive: prev,
        changed: true
      });
    } catch (e) {
      logger.error(`[${moduleName}] [PUT] /moduleActive ${e.message}`);
      return res.status(500).json({ error: e.message });
    }
  });

  router.get('/communicationChannels', (_req, res) => {
    try {
      res.json({communicationChannels : marketListener.state.communicationChannels});
    } catch (e) {
      logger.error(`[status/info] [GET] /communicationChannels ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });


  router.put('/communicationChannels', async (req, res) => {
    const allowedKeys = ['telemetry', 'tick', 'candle', 'logs'];

    try {
      // accetta sia { channels: {...} } sia direttamente {...}
      const input = (req.body && (req.body.communicationChannels || req.body)) || {};
      if (typeof input !== 'object' || Array.isArray(input)) {
        return res.status(400).json({ error: 'payload non valido: atteso oggetto di configurazione' });
      }

      const prev = marketListener.state.communicationChannels || {};
      const normalized = {};
      const details = {};
      let anyChanged = false;

      for (const key of allowedKeys) {
        const cfg = input[key];

        if (!cfg || typeof cfg !== 'object') {
          // mantieni il precedente (o default)
          const prevCfg = prev[key] || { on: false, params: { intervalsMs: 500 } };
          normalized[key] = prevCfg;
          details[key] = { changed: false, reason: 'mancante: mantenuto valore precedente' };
          continue;
        }

        // on boolean
        if (typeof cfg.on !== 'boolean') {
          return res.status(400).json({ error: `chiave "${key}": "on" deve essere booleano` });
        }

        // params.intervalsMs intero positivo, clamp a MAX
        const ms = cfg?.params?.intervalsMs;
        if (typeof ms !== 'number' || !Number.isInteger(ms) || ms <= 0) {
          return res.status(400).json({ error: `chiave "${key}": "params.intervalsMs" deve essere intero positivo` });
        }
        const clamped = Math.min(ms, maxInterval);

        const nowCfg = { on: cfg.on, params: { intervalsMs: clamped } };
        normalized[key] = nowCfg;

        const p = prev[key] || {};
        const changed =
          p.on !== nowCfg.on ||
          !p.params || p.params.intervalsMs !== nowCfg.params.intervalsMs;

        details[key] = { changed, previous: p.on === undefined ? null : p, current: nowCfg };
        anyChanged = anyChanged || changed;
      }

      // 1) aggiorna solo lo state
      marketListener.state.communicationChannels = normalized;

      // 2) delega al main l’aggiornamento del RedisBus (se definito)
      if (typeof marketListener.applyCommunicationChannels === 'function') {
        try {
          await marketListener.applyCommunicationChannels(normalized);
        } catch (e) {
          // NON falliamo l’endpoint se il main fallisce l’applicazione runtime;
          // restituiamo comunque 200 ma segnaliamo l’errore in details.
          details.applyError = e?.message || String(e);
          logger.warning(`[${moduleName}] applyCommunicationChannels error: ${details.applyError}`);
        }
      }

      return res.status(200).json({
        communicationChannels: normalized,
        changed: anyChanged,
        details,
        maxAllowedIntervalMs: maxInterval
      });
    } catch (e) {
      logger.error(`[${moduleName}] [PUT] /communicationChannels ${e.message}`);
      return res.status(500).json({ error: e.message });
    }
  });

  return router;
};
