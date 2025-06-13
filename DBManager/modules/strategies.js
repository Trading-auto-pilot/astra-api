// modules/strategies.js

const { getDbConnection, formatDateForMySQL } = require('./core');
const { resolveBotIdByName } = require('./bots');
const { resolveSymbolIdByName } = require('./symbols');
const createLogger = require('../../shared/logger');
const { publishCommand } = require('../../shared/redisPublisher');

const MICROSERVICE = 'DBManager';
const MODULE_NAME = 'strategies';
const MODULE_VERSION = '2.0';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

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
      .filter(row => !symbol || row.idSymbol === symbol);
  } catch (err) {
    logger.error(`[getActiveStrategies] Errore select:`, err.message);
    throw err;
  } finally {
     conn.release();
  }
}

async function updateStrategies(id, update) {
  if (!id) {
    logger.error('[updateStrategies] ID mancante');
    return null;
  }

  if (!update || typeof update !== 'object') {
    logger.error('[updateStrategies] Parametro update non valido');
    return null;
  }

  const excluded = ['id', 'TotalCommitted'];
  const fields = Object.keys(update).filter(f => !excluded.includes(f));
  if (fields.length === 0) {
    logger.warn('[updateStrategies] Nessun campo valido da aggiornare');
    return { success: false, reason: 'Nessun campo aggiornabile' };
  }

  const values = fields.map(f => (f === 'params' ? JSON.stringify(update[f]) : update[f]));
  const sql = `UPDATE strategies SET ${fields.map(f => `${f} = ?`).join(', ')} WHERE id = ?`;
  logger.trace(`[updateStrategies] sql ${sql}`);

  const conn = await getDbConnection();
  try {
    await conn.execute(sql, [...values, id]);
    logger.info(`[updateStrategies] Strategia ${id} aggiornata`);
    logger.info(`[updateStrategies] Invio messaggio update: ${JSON.stringify(update)}`);
    await publishCommand(update, 'strategies:update');
    return { success: true, id:id };
  } catch (error) {
    logger.error(`[updateStrategies] Errore: ${error.message}`);
    throw error;
  } finally {
    conn.release();
  }
}

async function getStrategiesRun() {
  const conn = await getDbConnection();
  try {
    let sql = `SELECT * FROM strategy_runs`;
    const params = [];

    const [rows] = await conn.execute(sql, params);
    return rows;
  } catch (err) {
    logger.error(`[getStrategiesRun] Errore select: ${err.message}`);
    throw err;
  } finally {
    conn.release();
  }
}

async function insertStrategyRun(strategyRun) {
  const conn = await getDbConnection();
  try {
    const extraFields = ['strategy_id', 'strategy_runs_id', 'open_date'];
    const strategyFields = Object.keys(strategyRun).filter(f => !extraFields.includes(f));
    const fields = [...extraFields, ...strategyFields];

    const values = [
      strategyRun.strategy_id,
      strategyRun.strategy_runs_id,
      formatDateForMySQL(strategyRun.open_date), // open_date impostata alla data corrente
      ...strategyFields.map(f => strategyRun[f] === undefined ? null : strategyRun[f])
    ];

    const placeholders = fields.map(() => '?').join(', ');
    const sql = `INSERT INTO strategy_runs (${fields.join(', ')}) VALUES (${placeholders})`;

    await conn.execute(sql, values);
    logger.info('[insertStrategyRun] Inserito strategy_run con successo');
    return { success: true };
  } catch (err) {
    logger.error('[insertStrategyRun] Errore insert:', err.message);
    throw err;
  } finally {
    conn.release();
  }
}


async function updateStrategyRun(strategy_runs_id, updates) {
  if (!strategy_runs_id) {
    logger.error('[updateStrategyRun] strategy_runs_id mancante');
    return { success: false, error: 'strategy_runs_id richiesto' };
  }

  const fields = Object.keys(updates).filter(f => updates[f] !== undefined);
  let setClause = fields.map(f => `${f} = ?`).join(', ');

  const values = fields.map(f => {
    if (f === 'close_date') return formatDateForMySQL(updates[f]);
    if (f === 'update_date') return formatDateForMySQL(updates[f]);
    return updates[f] === undefined ? null : updates[f];
  });

  // Aggiunge update_date con timestamp corrente formattata
  // setClause += setClause ? ', update_date = ?' : 'update_date = ?';
  // values.push(formatDateForMySQL(new Date()));

  const sql = `UPDATE strategy_runs SET ${setClause} WHERE strategy_runs_id = ?`;

  const conn = await getDbConnection();
  try {
    await conn.execute(sql, [...values, strategy_runs_id]);
    logger.info(`[updateStrategyRun] strategy_run ${strategy_runs_id} aggiornato`);
    return { success: true };
  } catch (err) {
    logger.error('[updateStrategyRun] Errore update:', err.message);
    throw err;
  } finally {
    conn.release();
  }
}





module.exports = {
  getActiveStrategies,
  updateStrategies,
  getStrategiesRun,
  insertStrategyRun,
  updateStrategyRun
};
