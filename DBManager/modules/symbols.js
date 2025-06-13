// modules/symbols.js

const { getDbConnection } = require('./core');
const createLogger = require('../../shared/logger');

const MICROSERVICE = 'DBManager';
const MODULE_NAME = 'symbols';
const MODULE_VERSION = '2.0';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

async function getSymbolsList() {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.query('SELECT name FROM Symbols');
    return rows.map(row => row.name);
  } catch (err) {
    logger.error(`[getSymbolsList] Errore select:`, err.message);
    throw err;
  } finally {
    connection.release();
  }
}

async function resolveSymbolIdByName(name) {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.execute('SELECT id FROM Symbols WHERE name = ? LIMIT 1', [name]);
    if (rows.length > 0) {
      return rows[0].id;
    } else {
      throw new Error(`Simbolo con nome "${name}" non trovato`);
    }
  } finally {
    connection.release();
  }
}

module.exports = {
  getSymbolsList,
  resolveSymbolIdByName
};
