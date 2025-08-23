// logger.js
const axios = require('axios');
// opzionale: se ti serve la type ref
// const { RedisBus } = require("./redisBus");

const levels = ['trace', 'log', 'info', 'warning', 'error'];
const dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
const enableDbLog = process.env.ENABLE_DB_LOG === 'true';

// ANSI color codes
const COLORS = {
  trace: '\x1b[35m',
  log: '\x1b[36m',
  info: '\x1b[32m',
  error: '\x1b[31m',
  warning: '\x1b[33m',
  reset: '\x1b[0m'
};

// Funzione per generare timestamp
function getTimestamp() { 
  const now = new Date();
  const date = now.toISOString().replace('T', ' ').replace('Z', '');
  // const millis = String(now.getMilliseconds()).padStart(3, '0');
  return `${date}`;
}

// Coda per log asincroni verso DB
let logQueue = [];

// Flush asincrono verso DB
setInterval(async () => {
  if (!enableDbLog || logQueue.length === 0) return;

  const batch = logQueue;
  logQueue = [];

  try {
    await axios.post(`${dbManagerUrl}/logs`, batch);
  } catch (err) {
    // Se fallisce, re-inserisci i log in testa alla coda
    logQueue = [...batch, ...logQueue];
    console.error('[logger] Failed to send logs:', err.message);
  }
}, 1000);

/**
 * Crea un logger.
 * @param {string} microservice 
 * @param {string} moduleName 
 * @param {string} moduleVersion 
 * @param {('trace'|'log'|'info'|'warning'|'error')} level 
 * @param {object} [opts]
 * @param {object} [opts.bus]                Istanza RedisBus (facoltativa)
 * @param {string} [opts.busTopicPrefix]     Prefisso topic (es. process.env.ENV o "ENV.marketListener")
 * @param {boolean} [opts.console=true]      Stampa su console
 * @param {boolean} [opts.enqueueDb=true]    Accoda su DB (oltre all’ENV ENABLE_DB_LOG)
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

  let bus = opts.bus || null;
  const consoleEnabled = opts.console !== false;
  const enqueueDb = opts.enqueueDb !== false;
  const prefixBase = (opts.busTopicPrefix || process.env.BUS_TOPIC_PREFIX || '').trim();

  // topic builder: <prefix>.<microservice>.<moduleName>.logs.<level>
  const buildBusTopic = (lvl) => {
    const parts = [];
    if (prefixBase) parts.push(prefixBase);
    if (microservice) parts.push(microservice);
    if (moduleName) parts.push(moduleName);
    parts.push('logs', lvl); // <-- "logs" è il segmento di controllo
    return parts.join('.');
  };

  const logToConsoleAndQueue = async (levelKey, color, ...args) => {
    const timestamp = getTimestamp();
    const prefix = `[${timestamp}][${microservice}][${moduleName}][${moduleVersion}][${levelKey.toUpperCase()}]`;

    // --------------- FIX skipBus parsing ---------------
    let skipBus = false;
    if (args.length) {
      const last = args[args.length - 1];
      if (last && typeof last === 'object' && last.__opts) {
        skipBus = !!last.__opts.skipBus;
        args.pop(); // rimuovi SOLO il sentinella
      }
    }
    // ---------------------------------------------------
    const fullMessage = args.join(' ');
    

    // 1) Console
    if (consoleEnabled) {
      const output = `${color}${prefix} ${fullMessage}${COLORS.reset}`;
      if (levelKey === 'error') console.error(output);
      else if (levelKey === 'warning') console.warn(output);
      else console.log(output);
    }

    // 2) Parsing campi funzione e JSON "pipe" per DB payload
    const funcMatch = fullMessage.match(/^\s*\[([^\]]+)\]\s*/);
    const functionName = funcMatch ? funcMatch[1] : null;
    let message = fullMessage.replace(/^\[[^\]]+\]\s*/, '');

    let jsonDetails = null;
    const pipeIndex = message.lastIndexOf('|');
    if (pipeIndex !== -1) {
      const maybeJson = message.slice(pipeIndex + 1).trim();
      message = message.slice(0, pipeIndex).trim();
      try {
        jsonDetails = JSON.parse(maybeJson);
      } catch (_) { /* ignore */ }
    }

    // 3) Enqueue verso DB (se abilitato)
    if (enqueueDb) {
      logQueue.push({
        timestamp,
        level: levelKey,
        functionName,
        message,
        jsonDetails,
        microservice,
        moduleName,
        moduleVersion
      });
    }

    // 4) Publish su RedisBus (se presente)
    if (bus && !skipBus) {
      try {
        const topic = buildBusTopic(levelKey);
        await bus.publish(topic, {
          ts: timestamp,
          level: levelKey,
          microservice, moduleName, moduleVersion,
          functionName,
          message,
          details: jsonDetails || undefined,
        });
      } catch (e) {
        // log locale SENZA bus per non rientrare
        await logToConsoleAndQueue(
          'warning',
          COLORS.warning,
          `[logger] bus publish failed: ${e && e.message ? e.message : e}`,
          { __opts: { skipBus: true } }
        );
      }
    }

  };

  const logger =  {
    trace: (...args) => currentIndex <= 0 && logToConsoleAndQueue('trace', COLORS.trace, ...args),
    log:   (...args) => currentIndex <= 1 && logToConsoleAndQueue('log',   COLORS.log,   ...args),
    info:  (...args) => currentIndex <= 2 && logToConsoleAndQueue('info',  COLORS.info,  ...args),
    warning: (...args) => currentIndex <= 3 && logToConsoleAndQueue('warning', COLORS.warning, ...args),
    error: (...args) => currentIndex <= 4 && logToConsoleAndQueue('error', COLORS.error, ...args),

    setLevel: (newLevel) => {
      if (!levels.includes(newLevel)) {
        console.warn(`[logger] Livello "${newLevel}" non valido`);
        return;
      }
      const currentLevel = newLevel;
      currentIndex = levels.indexOf(currentLevel);
      console.log(`[logger] Livello di log aggiornato a: ${newLevel}`);
    },
    attachBus: (newBus) => { bus = newBus || null; }

  };

  return logger;
}

module.exports = createLogger;
