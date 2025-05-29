// modules/settings.js

const { getDbConnection } = require('./core');
const logger = require('../../shared/logger')('Settings');

async function getSettingValue(key) {
  logger.log(`[getSettingValue] Recupero setting attivo per chiave: ${key}`);
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.query(
      `SELECT param_value FROM settings WHERE param_key = ? AND active = true LIMIT 1`,
      [key]
    );
    if (rows.length === 0) {
      logger.warn(`[getSettingValue] Nessun valore attivo trovato per chiave: ${key}`);
      return null;
    }
    return rows[0].param_value;
  } catch (err) {
    logger.error(`[getSettingValue] Errore select:`, err.message);
    throw err;
  } finally {
    await connection.end();
  }
}

module.exports = {
  getSettingValue
};
