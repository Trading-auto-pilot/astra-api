// modules/simul_orders.js

const { getDbConnection, formatDateForMySQL, safe } = require('./core');
const createLogger = require('../../shared/logger');

const MICROSERVICE = 'DBManager';
const MODULE_NAME = 'simulOrder';
const MODULE_VERSION = '2.0';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

async function simul_getAllOrdersAsJson() {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.execute('SELECT * FROM Simul.Orders where status="accepted"');
    return rows.map(row => ({
      id: row.id,
      client_order_id: row.client_order_id,
      created_at: row.created_at?.toISOString(),
      updated_at: row.updated_at?.toISOString(),
      submitted_at: row.submitted_at?.toISOString(),
      filled_at: row.filled_at?.toISOString(),
      expired_at: row.expired_at?.toISOString(),
      canceled_at: row.canceled_at?.toISOString(),
      failed_at: row.failed_at?.toISOString(),
      replaced_at: row.replaced_at?.toISOString(),
      replaced_by: row.replaced_by,
      replaces: row.replaces,
      asset_id: row.asset_id,
      symbol: row.symbol,
      asset_class: row.asset_class,
      notional: row.notional?.toString(),
      qty: row.qty?.toString(),
      filled_qty: row.filled_qty?.toString(),
      filled_avg_price: row.filled_avg_price?.toString(),
      order_class: row.order_class,
      order_type: row.order_type,
      type: row.type,
      side: row.side,
      time_in_force: row.time_in_force,
      limit_price: row.limit_price?.toString(),
      stop_price: row.stop_price?.toString(),
      status: row.status,
      extended_hours: !!row.extended_hours,
      legs: row.legs ? JSON.parse(row.legs) : null,
      trail_percent: row.trail_percent?.toString(),
      trail_price: row.trail_price?.toString(),
      hwm: row.hwm,
      subtag: row.subtag,
      source: row.source
    }));
  } catch (error) {
    logger.error(`[simul_getAllOrdersAsJson] Errore: ${error.message}`);
    throw error;
  } finally {
      connection.release();
  }
}

async function simul_updateOrder(orderUpdate) {
  const connection = await getDbConnection();
  if (!orderUpdate.id) {
    logger.error('[simul_updateOrder] ID mancante');
    return { success: false, error: 'Campo id obbligatorio' };
  }

  const fields = Object.keys(orderUpdate).filter(
    key => key !== 'id' && orderUpdate[key] !== undefined
  );

  if (fields.length === 0) {
    logger.warning('[simul_updateOrder] Nessun campo da aggiornare');
    return { success: false, error: 'Nessun campo da aggiornare' };
  }

  const setClause = fields.map(field => `${field} = ?`).join(', ');
  const values = fields.map(field => {
    const value = orderUpdate[field];
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'object' && field === 'legs') return JSON.stringify(value);
    if (field.endsWith('_at') && value) return new Date(value);
    if (typeof value === 'string' && !isNaN(value)) return parseFloat(value);
    return value;
  });

  const sql = `UPDATE Simul.Orders SET ${setClause} WHERE id = ?`;

  try {
    
    await connection.execute(sql, [...values, orderUpdate.id]);
    logger.info(`[simul_updateOrder] Ordine ${orderUpdate.id} aggiornato`);
    return { success: true };
  } catch (error) {
    logger.error(`[simul_updateOrder] Errore: ${error.message}`);
    throw error;
  } finally {
      connection.release();
  }
}

async function simul_insertOrder(order) {
  logger.log(`[simul_insertOrder] Ordine ricevuto da inserire nel DB : ${JSON.stringify(order)}`);
  const connection = await getDbConnection();
  try {
    const query = `
      INSERT INTO Simul.Orders (
        id, client_order_id, created_at, updated_at, submitted_at, filled_at, expired_at,
        canceled_at, failed_at, replaced_at, replaced_by, replaces, asset_id, symbol,
        asset_class, notional, qty, filled_qty, filled_avg_price, order_class, order_type,
        type, side, time_in_force, limit_price, stop_price, status, extended_hours, legs,
        trail_percent, trail_price, hwm, subtag, source
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )`;

    const values = [
      safe(order.id),
      safe(order.client_order_id),
      safe(formatDateForMySQL(order.created_at)),
      safe(formatDateForMySQL(order.updated_at)),
      safe(formatDateForMySQL(order.submitted_at)),
      safe(formatDateForMySQL(order.filled_at)),
      safe(formatDateForMySQL(order.expired_at)),
      safe(formatDateForMySQL(order.canceled_at)),
      safe(formatDateForMySQL(order.failed_at)),
      safe(formatDateForMySQL(order.replaced_at)),
      safe(order.replaced_by),
      safe(order.replaces),
      safe(order.asset_id),
      safe(order.symbol),
      safe(order.asset_class),
      safe(order.notional),
      safe(order.qty),
      safe(order.filled_qty),
      safe(order.filled_avg_price),
      safe(order.order_class),
      safe(order.order_type),
      safe(order.type),
      safe(order.side),
      safe(order.time_in_force),
      safe(order.limit_price),
      safe(order.stop_price),
      safe(order.status),
      order.extended_hours ? 1 : 0,
      order.legs ? JSON.stringify(order.legs) : null,
      safe(order.trail_percent),
      safe(order.trail_price),
      safe(order.hwm),
      safe(order.subtag),
      safe(order.source)
    ];

    await connection.execute(query, values);
    logger.info(`[simul_insertOrder] Ordine ${order.id} inserito con successo. Symbol ${order.symbol}`);
    return order.id;
  } catch (err) {
    logger.error(`[simul_insertOrder] Errore inserimento ordine: ${err.message}`);
    throw err;
  } finally {
      connection.release();
  }
}

async function simul_deleteAllOrders() {
  const connection = await getDbConnection();
  try {
    await connection.execute('DELETE FROM Simul.Orders');
    logger.info('[simul_deleteAllOrders] Tutti gli ordini eliminati');
    return { success: true };
  } catch (err) {
    logger.error('[simul_deleteAllOrders] Errore:', err.message);
    throw err;
  } finally {
    connection.release(); // Fondamentale se usi un pool
  }
}

module.exports = {
  simul_getAllOrdersAsJson,
  simul_updateOrder,
  simul_insertOrder,
  simul_deleteAllOrders
};
