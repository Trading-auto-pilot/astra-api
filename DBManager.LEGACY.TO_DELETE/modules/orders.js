const { getDbConnection, formatDateForMySQL, safe } = require('./core');
const createLogger = require('../../shared/logger');
const { publishCommand } = require('../../shared/redisPublisher');



const MICROSERVICE = 'DBManager';
const MODULE_NAME = 'orders';
const MODULE_VERSION = '2.0';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');


async function insertOrder(order) {
  const connection = await getDbConnection();
  const fields = Object.keys(order);
  const placeholders = fields.map(() => '?').join(', ');
  const values = fields.map(f => {
    const val = order[f];
    return f.endsWith('_at') ? safe(formatDateForMySQL(val)) : safe(val);
  });

  const sql = `INSERT INTO orders (${fields.join(', ')}) VALUES (${placeholders})`;

  try {
    await connection.execute(sql, values);
    await publishCommand(order,'orders:update' );
    return { success: true };
  } catch (err) {
    logger.error('[insertOrder] ', err.message);
    throw err;;
  } finally {
      connection.release();
  }
}


async function updateOrder(id, updates) {
  const connection = await getDbConnection();
  const fields = Object.keys(updates);
  const setClause = fields.map(f => `${f} = ?`).join(', ');

  const values = fields.map(k => {
    const value = updates[k];
    if (k === 'pnl_snapshot') return safe(JSON.stringify(value));
    if (k.endsWith('_at')) return safe(formatDateForMySQL(value));
    return safe(value);
  });

  values.push(id);

  const sql = `UPDATE Trading.orders SET ${setClause} WHERE id = ?`;

  try {  
    await connection.execute(sql, values);
    await publishCommand(updates,'orders:update' );
    logger.info(`[updateOrder] Aggiornato ordine ID ${id}`);
    return { success: true };
  } catch (err) {
    logger.error(`[updateOrder] ${err.message}`);
    throw err;
  } finally {
      connection.release();
  }
}

async function getAllOrders() {
  const connection = await getDbConnection();
  const sql = 'SELECT * FROM Trading.orders';
  try {
    const [rows] = await connection.execute(sql, [id]);
    return rows || null;
  } catch (err) {
    logger.error(`[getAllOrders] ${err.message}`);
    throw err;
  } finally {
      connection.release();
  }
}

async function deleteAllOrdini() {
  const connection = await getDbConnection();
  try {
    await connection.execute('DELETE FROM Trading.orders');
    logger.info('[deleteAllOrdini] Tutti gli ordini eliminati');
    logger.trace(`[deleteAllPosizioni] Spedizione messaggio su canale transaction_update`);
    await publishCommand({command:"Delete All"},'orders:update' );
    return { success: true };
  } catch (err) {
    logger.error('[deleteAllOrdini] Errore:', err.message);
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = {
  insertOrder,
  updateOrder,
  getAllOrders,
  deleteAllOrdini
};
