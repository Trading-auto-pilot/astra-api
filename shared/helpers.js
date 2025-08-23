// helpers.js

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// normalizza i metodi del logger: warn/warning, error/err
function normLogger(logger = console) {
  const warnFn  = logger.warn    || logger.warning || (logger.log ? (...a) => logger.log('[WARN]', ...a)  : (...a) => console.warn(...a));
  const errorFn = logger.error   || logger.err     || (logger.log ? (...a) => logger.log('[ERROR]', ...a) : (...a) => console.error(...a));
  return { warn: warnFn, error: errorFn };
}

/**
 * Esegue fn con retry + backoff esponenziale + jitter
 */
async function withRetry(fn, logger = console, opts = {}) {
  const { warn, error } = normLogger(logger);

  const {
    retries = 5,
    baseDelayMs = 1000,
    factor = 2,
    jitterRatio = 0.2,
  } = opts;

  let attempt = 0;
  let delay = baseDelayMs;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= retries) {
        error(`[retry] Fallito dopo ${attempt} tentativi: ${err && err.message ? err.message : err}`);
        throw err;
      }
      const jitter = 1 + (Math.random() * 2 - 1) * jitterRatio; // +/- jitter
      const wait = Math.max(100, Math.floor(delay * jitter));
      warn(`[retry] Tentativo ${attempt}/${retries - 1} fallito: ${err && err.message ? err.message : err}. Ritento tra ${wait}ms...`);
      await sleep(wait);
      delay = delay * factor;
    }
  }
}

function asBool(v, defVal = false) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s === 'on' || s === 'true' || s === '1' || s === 'yes';
  }
  if (typeof v === 'number') return v === 1;
  return defVal;
}

function asInt(v, defVal) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : defVal;
  }
  return defVal;
}

module.exports = {
  sleep,
  withRetry,
  asBool,
  asInt,
};
