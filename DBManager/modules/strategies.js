// modules/strategies.js

const { getDbConnection, formatDateForMySQL } = require('./core');
const { resolveBotIdByName } = require('./bots');
const { resolveSymbolIdByName } = require('./symbols');
const logger = require('../../shared/logger')('Strategies');
const { publishCommand } = require('../../shared/redisPublisher');

async function getActiveStrategies(symbol = null) {
  const conn = await getDbConnection();
  try {
    const [rows] = await conn.query(`SELECT * FROM vstrategies WHERE status = 'active'`);
    return rows
      .map(row => {
        try {
          if (row.params) row.params = JSON.parse(row.params);
        } catch (err) {
          logger.error(`[getActiveStrategies] Errore parsing JSON su params per id ${row.id}:`, err.message);
          row.params = {};
        }
        return row;
      })
      .filter(row => !symbol || row.symbol === symbol);
  } catch (err) {
    logger.error(`[getActiveStrategies] Errore select:`, err.message);
    throw err;
  } finally {
    await conn.end();
  }
}

async function updateStrategies(update) {
  if (!update.id) {
    logger.error('[updateStrategies] ID mancante');
    return null;
  }

  if (update.idBotIn) update.idBotIn = await resolveBotIdByName(update.idBotIn);
  if (update.idBotOut) update.idBotOut = await resolveBotIdByName(update.idBotOut);
  if (update.idSymbol) update.idSymbol = await resolveSymbolIdByName(update.idSymbol);

  const excluded = ['id', 'TotalCommitted'];
  const fields = Object.keys(update).filter(f => !excluded.includes(f));
  const values = fields.map(f => (f === 'params' ? JSON.stringify(update[f]) : update[f]));
  const sql = `UPDATE strategies SET ${fields.map(f => `${f} = ?`).join(', ')} WHERE id = ?`;

  const conn = await getDbConnection();
  try {
    await conn.execute(sql, [...values, update.id]);
    logger.info(`[updateStrategies] Strategia ${update.id} aggiornata`);
    logger.info(`[updateStrategies] Invio messaggio ${update}`);
    await publishCommand(update,'strategies_update' );
    return { success: true, id: update.id };
  } catch (error) {
    logger.error(`[updateStrategies] Errore: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    await conn.end();
  }
}

module.exports = {
  getActiveStrategies,
  updateStrategies
};
