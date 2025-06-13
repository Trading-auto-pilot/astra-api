// modules/settings.js

const { getDbConnection } = require('./core');
const createLogger = require('../../shared/logger');

const MICROSERVICE = 'DBManager';
const MODULE_NAME = 'settings';
const MODULE_VERSION = '2.0';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

async function getSettingValue(key) {
  logger.log(`[getSettingValue] Recupero setting attivo per chiave: ${key}`);
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.query(
      `SELECT param_value FROM settings WHERE param_key = ? AND active = true LIMIT 1`,
      [key]
    );
    if (rows.length === 0) {
      logger.warning(`[getSettingValue] Nessun valore attivo trovato per chiave: ${key}`);
      return null;
    }
    return rows[0].param_value;
  } catch (err) {
    logger.error(`[getSettingValue] Errore select:`, err.message);
    throw err;
  } finally {
      connection.release();
  }
}


async function getAllSetting() {
  logger.log(`[getSettingValue] Recupero setting attivo per tutte le chiavi`);
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.query(`SELECT * FROM settings WHERE active=1`);
    if (rows.length === 0) {
      logger.warning(`[getSettingValue] Nessun valore attivo trovato per chiave: ${key}`);
      return null;
    }
    return rows;
  } catch (err) {
    logger.error(`[getSettingValue] Errore select:`, err.message);
    throw err;
  } finally {
      connection.release();
  }
}

module.exports = {
  getAllSetting,
  getSettingValue
};
