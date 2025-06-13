const { getDbConnection, formatDateForMySQL, safe } = require('./core');
const createLogger = require('../../shared/logger');
const { publishCommand } = require('../../shared/redisPublisher');



const MICROSERVICE = 'DBManager';
const MODULE_NAME = 'orders';
const MODULE_VERSION = '2.0';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

async function insertPositions(orderData) {
  const conn = await getDbConnection();
  const sql = `
    INSERT INTO Trading.posizioni (
      strategy_id, asset_id, symbol, asset_class, side, qty, filled_avg_price,
      avg_entry_price, market_value, cost_basis, unrealized_pl, unrealized_plpc,
      current_price, lastday_price, change_today, order_id, client_order_id,
      created_at, filled_at, note, realized_pl, cumulative_equity,
      equity_after_trade, pnl_snapshot
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    safe(orderData.strategy_id),
    safe(orderData.asset_id),
    safe(orderData.symbol),
    safe(orderData.asset_class),
    safe(orderData.side),
    safe(orderData.qty),
    safe(orderData.filled_avg_price),
    safe(orderData.avg_entry_price),
    safe(orderData.market_value),
    safe(orderData.cost_basis),
    safe(orderData.unrealized_pl),
    safe(orderData.unrealized_plpc),
    safe(orderData.current_price),
    safe(orderData.lastday_price),
    safe(orderData.change_today),
    safe(orderData.order_id),
    safe(orderData.client_order_id),
    safe(formatDateForMySQL(orderData.created_at)),
    safe(formatDateForMySQL(orderData.filled_at)),
    safe(orderData.note),
    safe(orderData.realized_pl),
    safe(orderData.cumulative_equity),
    safe(orderData.equity_after_trade),
    safe(JSON.stringify(orderData.pnl_snapshot || {}))
  ];

  try {
    const [res] = await conn.execute(sql, values);
    logger.trace(`[insertPositions] Spedizione messaggio su canale transaction_update: ${JSON.stringify(values)}`);
    await publishCommand(values,'positions:update' );
    logger.info(`[insertPositions] Inserito ordine ID ${res.insertId}`);
    return { success: true, id: res.insertId };
  } catch (err) {
    logger.error(`[insertPositions] ${err.message}`);
    throw err;
  } finally {
      conn.release();
  }
}

async function getAllPositions() {
  const conn = await getDbConnection();
  const sql = 'SELECT * FROM Trading.posizioni';
  try {
    const [rows] = await conn.execute(sql, [id]);
    return rows || null;
  } catch (err) {
    logger.error(`[getAllPositions] ${err.message}`);
    throw err;
  } finally {
      conn.release();
  }
}

async function deleteAllPosizioni() {
  const conn = await getDbConnection();
  try {
    await conn.execute('DELETE FROM Trading.posizioni');
    logger.info('[deleteAllPosizioni] Tutte le posizioni eliminate');
    logger.trace(`[deleteAllPosizioni] Spedizione messaggio su canale transaction_update`);
    await publishCommand({command:"Delete All"},'positions:update' );
    return { success: true };
  } catch (err) {
    logger.error('[deleteAllPosizioni] Errore:', err.message);
    throw err;
  } finally {
    conn.release();
  }
}


module.exports = {
  insertPositions,
  getAllPositions,
  deleteAllPosizioni
};
