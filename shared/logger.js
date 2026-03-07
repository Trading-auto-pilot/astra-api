// logger.js
const path = require('path');
const axios = require('axios');

// livelli supportati (ordine di severità)
const levels = ['trace', 'log', 'info', 'warning', 'error'];

// Support both DATAHUB_URL (preferred) and DBMANAGER_URL (backward compat)
const dbManagerUrl = process.env.DATAHUB_URL || process.env.DBMANAGER_URL || 'http://datahub:3000';
const serviceRelease = (() => {
  try {
    const rel = require(path.resolve(process.cwd(), "release.json"));
    return rel?.version || rel?.Version || rel?.VERSION || null;
  } catch {
    return null;
  }
})();
let enableDbLog = process.env.ENABLE_DB_LOG === 'true';

// ANSI color codes
const COLORS = {
  trace: '\x1b[35m',
  log: '\x1b[36m',
  info: '\x1b[32m',
  error: '\x1b[31m',
  warning: '\x1b[33m',
  reset: '\x1b[0m'
};

// timestamp ISO (senza 'T'/'Z')
function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').replace('Z', '');
}

// Coda per log asincroni verso DB
let logQueue = [];

// Flush asincrono verso DB ogni 1s
setInterval(async () => {
  if (!enableDbLog || logQueue.length === 0) return;

  let batch = logQueue;
  logQueue = [];

  try {
    // Evita payload troppo grandi: tronca il batch se supera 50MB
    const maxBytesRaw = Number(process.env.LOG_BATCH_MAX_BYTES);
    const maxBytes =
      Number.isFinite(maxBytesRaw) && maxBytesRaw > 0
        ? Math.floor(maxBytesRaw)
        : 50 * 1024 * 1024;
    const payloadSize = Buffer.byteLength(JSON.stringify(batch));
    if (payloadSize > maxBytes) {
      let left = 0;
      let right = batch.length;
      let best = 0;
      // binary search su numero di elementi
      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const size = Buffer.byteLength(JSON.stringify(batch.slice(0, mid)));
        if (size <= maxBytes) {
          best = mid;
          left = mid + 1;
        } else {
          right = mid - 1;
        }
      }
      if (best < batch.length) {
        const dropped = batch.length - best;
        batch = batch.slice(0, best);
        console.warn(`[logger] Batch too large (${payloadSize} bytes). Dropping ${dropped} logs to fit ${maxBytes} bytes`);
      }
    }

    await axios.post(`${dbManagerUrl}/logs`, batch, {
      headers: {
        "User-Agent": `${process.env.MICROSERVICE_NAME || "service"}/${serviceRelease || "unknown"}`,
      },
    });
  } catch (err) {
    // Se fallisce, re-inserisci i log in testa alla coda
    logQueue = [...batch, ...logQueue];
    console.error('[logger] Failed to send logs:', err.message);
  }
}, 1000);

/**
 * Crea un logger.
 * @param {string} microservice
 * @param {string} moduleName       Nome modulo di default (retrocompat)
 * @param {string} moduleVersion
 * @param {'trace'|'log'|'info'|'warning'|'error'} level
 * @param {object} [opts]
 * @param {object} [opts.bus]                Istanza bus con .publish(topic, payload)
 * @param {string} [opts.busTopicPrefix]     Prefisso topic (es. ENV o "ENV.marketListener")
 * @param {boolean} [opts.console=true]      Stampa su console
 * @param {boolean} [opts.enqueueDb=true]    Accoda su DB (oltre all’ENV ENABLE_DB_LOG)
 * @param {boolean} [opts.autoModule=false]  Se true, rileva automaticamente il modulo chiamante
 */
function createLogger(
  microservice = '',
  moduleName = '',
  moduleVersion = '',
  level = 'info',
  opts = {}
) {
  let currentIndex = levels.indexOf(level);
  if (currentIndex < 0) currentIndex = levels.indexOf('info');

  const consoleEnabled = opts.console !== false;
  const enqueueDb = opts.enqueueDb !== false;
  const prefixBase = (opts.busTopicPrefix || process.env.BUS_TOPIC_PREFIX || '').trim();
  const autoModule = opts.autoModule === true;

  // bus può essere collegato/aggiornato dopo
  let bus = opts.bus || null;

  // costruisce il topic: <prefix>.<microservice>.<module>.logs.<level>
  const buildBusTopic = (lvl, moduleForLog) => {
    const parts = [];
    if (prefixBase) parts.push(prefixBase);
    if (microservice) parts.push(microservice);
    if (moduleForLog) parts.push(moduleForLog);
    parts.push('logs', lvl);
    return parts.join('.');
  };

  // normalizza nome modulo (path → basename senza estensione)
  const normModule = (m) => {
    if (!m) return '';
    if (m.includes('/') || m.includes('\\')) {
      const base = path.basename(m);
      return base.replace(/\.[^.]+$/, '');
    }
    return m;
  };

  // estrae il file chiamante dallo stack (primo frame fuori da logger.js)
  const getCallerModule = () => {
    const err = new Error();
    Error.captureStackTrace?.(err, getCallerModule);
    const lines = String(err.stack || '').split('\n').slice(1);
    for (const ln of lines) {
      const m = ln.match(/\((.*?):\d+:\d+\)|at (\/.*?):\d+:\d+/);
      const file = m?.[1] || m?.[2];
      if (!file) continue;
      if (!file.endsWith('logger.js')) {
        return normModule(file);
      }
    }
    return normModule(moduleName);
  };

  const formatArg = (arg) => {
    if (arg === null || arg === undefined) return String(arg);
    if (arg instanceof Error) return arg.stack || arg.message || String(arg);
    if (typeof arg === 'string') return arg;
    if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
    try {
      return JSON.stringify(arg);
    } catch (_) {
      return String(arg);
    }
  };

  // core logging (console + enqueue DB + publish bus)
  const logToConsoleAndQueue = async (levelKey, color, moduleForLog, ...args) => {
    const _moduleName = moduleForLog
      ? normModule(moduleForLog)
      : (autoModule ? getCallerModule() : normModule(moduleName));

    const timestamp = getTimestamp();
    const prefix = `[${timestamp}][${microservice}][${_moduleName}][${moduleVersion}][${levelKey.toUpperCase()}]`;

    // --- gestisci sentinella { __opts:{ skipBus:true } } come ultimo arg ---
    let skipBus = false;
    if (args.length) {
      const last = args[args.length - 1];
      if (last && typeof last === 'object' && last.__opts) {
        skipBus = !!last.__opts.skipBus;
        args.pop(); // rimuovi sentinella
      }
    }
    // ----------------------------------------------------------------------

    const fullMessage = args.map(formatArg).join(' ');

    // 1) Console
    if (consoleEnabled) {
      const output = `${color}${prefix} ${fullMessage}${COLORS.reset}`;
      if (levelKey === 'error') console.error(output);
      else if (levelKey === 'warning') console.warn(output);
      else console.log(output);
    }

    // 2) Parsing funzione e JSON
    const funcMatch = fullMessage.match(/^\s*\[([^\]]+)\]\s*/);
    const functionName = funcMatch ? funcMatch[1] : null;
    let message = fullMessage.replace(/^\[[^\]]+\]\s*/, '');

    let jsonDetails = null;

    // 2a) Prova pipe-separated JSON: "testo | {json}"
    const pipeIndex = message.lastIndexOf('|');
    if (pipeIndex !== -1) {
      const maybeJson = message.slice(pipeIndex + 1).trim();
      try {
        jsonDetails = JSON.parse(maybeJson);
        message = message.slice(0, pipeIndex).trim();
      } catch (_) { /* pipe trovato ma non è JSON valido, continua */ }
    }

    // 2b) Fallback: JSON embedded nel messaggio (es. "testo {json}" o "testo [{json}]")
    if (jsonDetails === null) {
      const trimmed = message.trimEnd();
      const endCh = trimmed[trimmed.length - 1];
      if (endCh === '}' || endCh === ']') {
        const startCh = endCh === '}' ? '{' : '[';
        let idx = trimmed.lastIndexOf(startCh);
        let attempts = 0;
        while (idx >= 0 && attempts < 5) {
          try {
            const candidate = trimmed.slice(idx);
            jsonDetails = JSON.parse(candidate);
            message = trimmed.slice(0, idx).trim();
            break;
          } catch (_) {
            idx = trimmed.lastIndexOf(startCh, idx - 1);
            attempts++;
          }
        }
      }
    }

    // 3) Enqueue verso DB (se abilitato)
    //    jsonDetails va stringificato per evitare che mysql2 riceva un Object
    //    (causerebbe il fallimento dell'intero batch INSERT)
    if (enqueueDb) {
      let jsonDetailsStr = null;
      if (jsonDetails !== null && jsonDetails !== undefined) {
        jsonDetailsStr = typeof jsonDetails === 'string' ? jsonDetails : JSON.stringify(jsonDetails);
      }
      logQueue.push({
        timestamp,
        level: levelKey,
        functionName,
        message,
        jsonDetails: jsonDetailsStr,
        microservice,
        moduleName: _moduleName,
        moduleVersion
      });
    }

    // 4) Publish su bus (se presente e non skippato)
    if (bus && !skipBus) {
      try {
        const topic = buildBusTopic(levelKey, _moduleName);
        await bus.publish(topic, {
          ts: timestamp,
          level: levelKey,
          microservice,
          moduleName: _moduleName,
          moduleVersion,
          functionName,
          message,
          details: jsonDetails || undefined,
        });
      } catch (e) {
        // log locale SENZA bus per non rientrare
        await logToConsoleAndQueue(
          'warning',
          COLORS.warning,
          _moduleName,
          `[logger] bus publish failed: ${e && e.message ? e.message : e}`,
          { __opts: { skipBus: true } }
        );
      }
    }
  };

  // API logger (retrocompat: nessun cambio chiamate)
  const logger = {
    trace: (...args) => currentIndex <= 0 && logToConsoleAndQueue('trace', COLORS.trace, null, ...args),
    log:   (...args) => currentIndex <= 1 && logToConsoleAndQueue('log',   COLORS.log,   null, ...args),
    info:  (...args) => currentIndex <= 2 && logToConsoleAndQueue('info',  COLORS.info,  null, ...args),
    warning: (...args) => currentIndex <= 3 && logToConsoleAndQueue('warning', COLORS.warning, null, ...args),
    error: (...args) => currentIndex <= 4 && logToConsoleAndQueue('error', COLORS.error, null, ...args),

    setLevel: (newLevel) => {
      if (!levels.includes(newLevel)) {
        console.warn(`[logger] Livello "${newLevel}" non valido`);
        return;
      }
      currentIndex = levels.indexOf(newLevel);
      console.log(`[logger] Livello di log aggiornato a: ${newLevel}`);
    },

    getLevel() { return levels[currentIndex]},

    getDbLogStatus: () => enableDbLog,
    setDbLogStatus: (status) => {
      enableDbLog = !!status;
      return { success: true, setDbLogStatus: enableDbLog };
    },

    attachBus: (newBus) => { bus = newBus || null; },

    // Child logger esplicito per modulo
    forModule: (modulePathOrName) => {
      const m = normModule(modulePathOrName);
      return {
        trace: (...args) => currentIndex <= 0 && logToConsoleAndQueue('trace', COLORS.trace, m, ...args),
        log:   (...args) => currentIndex <= 1 && logToConsoleAndQueue('log',   COLORS.log,   m, ...args),
        info:  (...args) => currentIndex <= 2 && logToConsoleAndQueue('info',  COLORS.info,  m, ...args),
        warning: (...args) => currentIndex <= 3 && logToConsoleAndQueue('warning', COLORS.warning, m, ...args),
        error: (...args) => currentIndex <= 4 && logToConsoleAndQueue('error', COLORS.error, m, ...args),
        setLevel: logger.setLevel,
        getLevel: logger.getLevel,
        getDbLogStatus: logger.getDbLogStatus,
        setDbLogStatus: logger.setDbLogStatus,
        attachBus: logger.attachBus,
      };
    }
  };

  return logger;
}

module.exports = createLogger;
