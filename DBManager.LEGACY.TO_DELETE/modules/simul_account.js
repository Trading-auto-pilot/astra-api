// modules/simul_account.js

const axios = require('axios');
const { getDbConnection, sanitizeData } = require('./core');
const createLogger = require('../../shared/logger');
const cache = require('../../shared/cache');

const MICROSERVICE = 'DBManager';
const MODULE_NAME = 'simulAccount';
const MODULE_VERSION = '2.0';


const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

ALPACA_URL = "https://paper-api.alpaca.markets";


async function simul_updateAccount(accountUpdate) {
  if (!accountUpdate.id) {
    logger.error('[simul_updateAccount] ID mancante');
    return { success: false, error: 'ID obbligatorio per aggiornare l\'account' };
  }

  try {
    // Leggi l'account corrente da Redis
    const raw = await cache.get('account');
    if (!raw) {
      logger.error('[simul_updateAccount] Nessun account presente in Redis');
      return { success: false, error: 'Nessun account presente in Redis' };
    }

    const current = JSON.parse(raw);

    // Applica l'update solo ai campi validi
    for (const [key, val] of Object.entries(accountUpdate)) {
      if (val !== undefined && key !== 'id') {
        current[key] = typeof val === 'boolean'
          ? val
          : (typeof val === 'string' && !isNaN(val))
            ? parseFloat(val)
            : val;
      }
    }

    await cache.setp('account', JSON.stringify(current));
    logger.info(`[simul_updateAccount] Account ${accountUpdate.id} aggiornato in Redis`);

    return { success: true };
  } catch (error) {
    logger.error(`[simul_updateAccount] Errore: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function simul_getAccountAsJson() {
  let account;

  try {
    const raw = await cache.get('account');
    if (raw) {
      account = JSON.parse(raw);
      logger.info('[simul_getAccountAsJson] Dati letti da Redis');
    } else {
      logger.warning('[simul_getAccountAsJson] Nessun dato trovato in Redis, fallback su Alpaca');
      const response = await axios.get(`${ALPACA_URL}/v2/account`, {
        headers: {
          'APCA-API-KEY-ID': process.env.APCA_API_KEY_ID,
          'APCA-API-SECRET-KEY': process.env.APCA_API_SECRET_KEY
        }
      });
      account = response.data;
    }
    const cleaned = sanitizeData('Account',account)
    await cache.setp('account', JSON.stringify(cleaned));
    logger.info('[simul_getAccountAsJson] Dati Alpaca salvati in Redis');
    return(cleaned);

  } catch (error) {
    logger.error(`[simul_getAccountAsJson] Errore: ${error.message}`);
    throw error;
  }
}


async function syncAccountFromAlpaca() {
  try {
    const response = await axios.get(`${ALPACA_URL}/v2/account`, {
      headers: {
        'APCA-API-KEY-ID': process.env.APCA_API_KEY_ID,
        'APCA-API-SECRET-KEY': process.env.APCA_API_SECRET_KEY
      }
    });

    const account = response.data;
    const cleaned = sanitizeData('Account',account);

    const result = await simul_updateAccount(cleaned);
    return cleaned;

  } catch (error) {
    logger.error(`[syncAccountFromAlpaca] Errore chiamata API Alpaca: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function deleteAccountCache() {

    const result = await cache.del('account');
    try {
      logger.info('[deleteAccountCache] Chiave "account" eliminata da Redis ');
      const raw = await cache.get('account');
      return { success: true , raw : raw};
    } catch (error) {
      logger.warning('[deleteAccountCache] Chiave "account" non presente in Redis '+ error.message);
      const raw = await cache.get('account');
      return { success: false, message: 'Chiave non trovata', raw : raw };
    }
}

module.exports = {
  simul_updateAccount,
  simul_getAccountAsJson,
  syncAccountFromAlpaca,
  deleteAccountCache
};
