// modules/bots.js

const { getDbConnection } = require('./core');
const logger = require('../../shared/logger')('Bots');

async function getActiveBots() {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.execute("SELECT * FROM bots WHERE status = 'active'");
    return rows;
  } catch (error) {
    logger.error('[getActiveBots] Errore durante il recupero dei bot attivi:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

async function insertOrUpdateBotByNameVer(name, ver) {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.query(
      `SELECT id FROM bots WHERE name = ? AND ver = ?`,
      [name, ver]
    );

    if (rows.length > 0) {
      const existingId = rows[0].id;
      await connection.query(
        `UPDATE bots SET date_release = NOW() WHERE id = ?`,
        [existingId]
      );
      logger.log(`[insertOrUpdateBotByNameVer] Bot esistente aggiornato (id=${existingId})`);
      return existingId;
    }

    const [result] = await connection.query(
      `INSERT INTO bots (name, ver, status, date_release, totalProfitLoss)
       VALUES (?, ?, 'inactive', NOW(), 0)`,
      [name, ver]
    );

    logger.log(`[insertOrUpdateBotByNameVer] Bot creato con id ${result.insertId}`);
    return result.insertId;
  } catch (err) {
    logger.error(`[insertOrUpdateBotByNameVer] Errore:`, err.message);
    throw err;
  } finally {
    await connection.end();
  }
}

async function resolveBotIdByName(name) {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.execute(
      'SELECT id FROM bots WHERE name = ? LIMIT 1',
      [name]
    );
    if (rows.length > 0) return rows[0].id;
    throw new Error(`Bot con nome "${name}" non trovato`);
  } finally {
    await connection.end();
  }
}

module.exports = {
  getActiveBots,
  insertOrUpdateBotByNameVer,
  resolveBotIdByName
};