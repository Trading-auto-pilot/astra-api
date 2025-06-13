const axios = require('axios');
const createLogger = require('./logger');

let settingsCache = null;
let dbManagerUrl = null;

const MICROSERVICE = 'Shared';
const MODULE_NAME = 'loadSettings';
const MODULE_VERSION = '1.0';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

/**
 * Carica tutti i settings da dbManager e restituisce il valore associato alla chiave richiesta.
 * @param {string} dbManagerUrl - Base URL del microservizio dbManager
 * @param {string} key - Chiave da cercare (es. ALPACA-PAPER-BASE)
 * @returns {Promise<string|null>} - Valore della chiave oppure null
 */

async function initializeSettings(dbManagerUrl) {
  if (!settingsCache) {
    try {
      const res = await axios.get(`${dbManagerUrl}/settings`);
      // Costruzione dizionario da array
      settingsCache = {};
      for (const entry of res.data) {
        if (entry.active) {
          settingsCache[entry.param_key] = entry.param_value;
        }
      }
      logger.log(`[initializeSettings] Cache caricata con ${Object.keys(settingsCache).length} parametri attivi`);
      logger.trace(`[initializeSettings] Chiavi caricate: ${JSON.stringify(settingsCache)}`);
    } catch (err) {
      logger.error(`[initializeSettings] Errore caricamento settings: ${err.message}`);
      return null;
    }
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


module.exports = {
  initializeSettings,
  getSetting
};
