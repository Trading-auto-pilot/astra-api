const axios = require('axios');
const createLogger = require('./logger');
const { withRetry, asInt } = require('./helpers'); 

let settingsCache = null;

const MICROSERVICE = 'Shared';
const MODULE_NAME = 'loadSettings';
const MODULE_VERSION = '1.0';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

/**
 * Carica i settings da dbManager con retry + backoff esponenziale.
 * @param {string} dbManagerUrl - Base URL del microservizio dbManager (es. http://db:3000)
 * @param {object} options
 * @param {number} options.retries      - tentativi totali (default: env SETTINGS_RETRIES || 5)
 * @param {number} options.baseDelayMs  - ritardo iniziale ms (default: env SETTINGS_BASE_DELAY_MS || 1000)
 * @param {number} options.factor       - moltiplicatore backoff (default: 2)
 * @param {number} options.jitterRatio  - jitter 0..1 (default: 0.2)
 * @param {number} options.timeoutMs    - timeout axios ms (default: env SETTINGS_TIMEOUT_MS || 5000)
 * @returns {Promise<object|null>} Dizionario chiave->valore oppure null se fallisce
 */

async function initializeSettings(dbManagerUrl, options = {}) {
  // Evita ricarichi inutili
  if (settingsCache) return settingsCache;

  const retries     = asInt(process.env.SETTINGS_RETRIES, 5);
  const baseDelayMs = asInt(process.env.SETTINGS_BASE_DELAY_MS, 1000);
  const timeoutMs   = asInt(process.env.SETTINGS_TIMEOUT_MS, 5000);

  const {
    retries: optRetries       = retries,
    baseDelayMs: optBaseDelay = baseDelayMs,
    factor                    = 2,
    jitterRatio               = 0.2,
    timeoutMs: optTimeout     = timeoutMs,
  } = options;

  logger.log(`[initializeSettings] tentativo di connessione a ${dbManagerUrl}/settings`)
  try {
    const res = await withRetry(
      async () => {
        // singolo tentativo con timeout; eventuale throw viene gestito da withRetry
        return axios.get(`${dbManagerUrl}/settings`, { timeout: optTimeout });
      },
      logger,
      { retries: optRetries, baseDelayMs: optBaseDelay, factor, jitterRatio }
    );

    // Normalizza payload (accetta sia array diretto che {data:[...]} )
    const rows = Array.isArray(res.data) ? res.data
               : Array.isArray(res.data?.data) ? res.data.data
               : [];

    // Costruzione dizionario da array
    const map = {};
    for (const entry of rows) {
      if (entry && entry.active && entry.param_key != null) {
        map[String(entry.param_key)] = entry.param_value ?? '';
      }
    }

    settingsCache = map;

    const keysCount = Object.keys(settingsCache).length;
    logger.log(`[initializeSettings] Cache caricata con ${keysCount} parametri attivi`);

    if (keysCount === 0) {
      logger.warning('[initializeSettings] Nessun parametro attivo ricevuto da dbManager');
    } else {
      logger.trace(`[initializeSettings] Chiavi caricate: ${JSON.stringify(settingsCache)}`);
    }

    return settingsCache;
  } catch (err) {
    logger.error(`[initializeSettings] Errore caricamento settings dopo i retry: ${err && err.message ? err.message : err}`);
    settingsCache = null; // lascia in stato noto
    return null;
  }
}

 
function getSetting(key) {
  if (
    !settingsCache ||
    typeof settingsCache !== 'object' ||
    Array.isArray(settingsCache) ||
    Object.keys(settingsCache).length === 0
  ) {
    throw new Error(`[getSetting] settingsCache non valido. Tipo: ${typeof settingsCache}, Contenuto: ${JSON.stringify(settingsCache)}`);
  }

  logger.trace(`[getSetting] Recupero chiave: ${key}`);
  return settingsCache[key] ?? null;
}

/**
 * Forza un reload dei settings dal DB azzerando la cache interna.
 */
async function reloadSettings(dbManagerUrl, options = {}) {
  settingsCache = null;
  logger.info("[reloadSettings] Cache invalidata, ricarico impostazioni dal DB");
  return initializeSettings(dbManagerUrl, options);
}


module.exports = {
  initializeSettings,
  getSetting,
  reloadSettings
};
