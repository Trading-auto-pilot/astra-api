const axios = require('axios');
const createLogger = require('./logger');
const { withRetry, asInt } = require('./helpers');

let settingsCache = null;
// Stored after initializeSettings — points to datahub (DATAHUB_URL) so persistSetting
// can call PUT /settings/:key on the same host that serves the settings table.
let _datahubUrl = null;

const MICROSERVICE = 'Shared';
const MODULE_NAME = 'loadSettings';
const MODULE_VERSION = '1.0';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

/**
 * Carica i settings da datahub con retry + backoff esponenziale.
 * @param {string} datahubUrl - Base URL di datahub (es. http://datahub:3000)
 * @param {object} options
 * @param {number} options.retries      - tentativi totali (default: env SETTINGS_RETRIES || 5)
 * @param {number} options.baseDelayMs  - ritardo iniziale ms (default: env SETTINGS_BASE_DELAY_MS || 1000)
 * @param {number} options.factor       - moltiplicatore backoff (default: 2)
 * @param {number} options.jitterRatio  - jitter 0..1 (default: 0.2)
 * @param {number} options.timeoutMs    - timeout axios ms (default: env SETTINGS_TIMEOUT_MS || 5000)
 * @returns {Promise<object|null>} Dizionario chiave->valore oppure null se fallisce
 */

async function initializeSettings(datahubUrl, options = {}) {
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

  logger.log(`[initializeSettings] tentativo di connessione a ${datahubUrl}/settings`)
  try {
    const res = await withRetry(
      async () => {
        // singolo tentativo con timeout; eventuale throw viene gestito da withRetry
        return axios.get(`${datahubUrl}/settings`, { timeout: optTimeout });
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

    _datahubUrl = datahubUrl;
    settingsCache = map;

    const keysCount = Object.keys(settingsCache).length;
    logger.log(`[initializeSettings] Cache caricata con ${keysCount} parametri attivi`);

    if (keysCount === 0) {
      logger.warning('[initializeSettings] Nessun parametro attivo ricevuto da datahub');
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

function getAllSettings() {
  if (
    !settingsCache ||
    typeof settingsCache !== 'object' ||
    Array.isArray(settingsCache) ||
    Object.keys(settingsCache).length === 0
  ) {
    throw new Error(`[getAllSettings] settingsCache non valido. Tipo: ${typeof settingsCache}, Contenuto: ${JSON.stringify(settingsCache)}`);
  }
  return { ...settingsCache };
}

/**
 * Forza un reload dei settings dal DB azzerando la cache interna.
 */
async function reloadSettings(datahubUrl, options = {}) {
  settingsCache = null;
  logger.info("[reloadSettings] Cache invalidata, ricarico impostazioni dal DB");
  return initializeSettings(datahubUrl, options);
}

/**
 * Aggiorna un setting solo in cache (non persistente su DB).
 * @param {string} key
 * @param {any} value
 * @returns {object} Copia aggiornata della cache
 */
function setSetting(key, value) {
  if (!settingsCache || typeof settingsCache !== "object" || Array.isArray(settingsCache)) {
    settingsCache = {};
  }
  settingsCache[String(key)] = value;
  return { ...settingsCache };
}

/**
 * Persiste un setting nel DB (tabella `settings`) tramite PUT /settings/:key su datahub,
 * e aggiorna anche la cache in-memoria.
 * Disponibile su tutti i microservizi via BaseService.persistSetting().
 * @param {string} key
 * @param {string|number} value
 * @returns {Promise<void>}
 */
async function persistSetting(key, value) {
  const strValue = String(value);
  setSetting(key, strValue); // aggiorna subito la cache in-memoria

  if (!_datahubUrl) {
    logger.warning(`[persistSetting] datahubUrl non disponibile — impossibile persistere ${key} nel DB`);
    return;
  }

  try {
    await axios.put(
      `${_datahubUrl}/settings/${encodeURIComponent(key)}`,
      { param_value: strValue },
      { timeout: 5000 }
    );
    logger.trace(`[persistSetting] ${key} = ${strValue} salvato nel DB`);
  } catch (err) {
    logger.warning(`[persistSetting] Errore nel persistere ${key} nel DB: ${err?.message || err}`);
  }
}


module.exports = {
  initializeSettings,
  getSetting,
  getAllSettings,
  reloadSettings,
  setSetting,
  persistSetting,
};
