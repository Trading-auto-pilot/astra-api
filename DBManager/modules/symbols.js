// modules/symbols.js

const { getDbConnection } = require('./core');
const logger = require('../../shared/logger')('Symbols');

async function getSymbolsList() {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.query('SELECT name FROM Symbols');
    return rows.map(row => row.name);
  } catch (err) {
    logger.error(`[getSymbolsList] Errore select:`, err.message);
    throw err;
  } finally {
    await connection.end();
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
    await connection.end();
  }
}

module.exports = {
  getSymbolsList,
  resolveSymbolIdByName
};
