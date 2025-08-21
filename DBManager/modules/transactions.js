// modules/transactions.js

const { getDbConnection, formatDateForMySQL , safe} = require('./core');
const createLogger = require('../../shared/logger');
const { publishCommand } = require('../../shared/redisPublisher');

const MICROSERVICE = 'DBManager';
const MODULE_NAME = 'transactions';
const MODULE_VERSION = '2.0';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

async function insertBuyTransaction(body) {
  const { ScenarioID, operationDate, capitale, Price, operation, MA, orderId, NumAzioni } = body;
  const connection = await getDbConnection();
  try {
    await connection.query(
      `INSERT INTO transazioni 
       (ScenarioID, operation, operationDate, Price, capitale, MA, orderId, NumAzioni)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [ScenarioID, safe(operation), safe(formatDateForMySQL(operationDate)), safe(Price), safe(capitale), safe(MA), safe(orderId), safe(NumAzioni)]
    );
    logger.trace(`[insertBuyTransaction] Spedizione messaggio su canale transaction_update: ${JSON.stringify(body)}`);
    await publishCommand(body,'transactions:update' );

  } catch (err) {
    logger.error(`[insertBuyTransaction] Errore insert: ${err.message} body | ${JSON.stringify(body)}`);
    throw err;
  } finally {
      connection.release();
  }
  return ({status:"success"});
}

async function insertSellTransaction(scenarioId, element, result, state) {
  const connection = await getDbConnection();
  try {
    await connection.query(
      `INSERT INTO transazioni 
       (ScenarioID, operationDate, operation, Price, capitale, profitLoss, NumAzioni, PLPerc)
       VALUES (?, ?, 'SELL', ?, ?, ?, ?, ?)`,
      [scenarioId, safe(formatDateForMySQL(element.t)), safe(result.prezzo), safe(state.capitaleLibero), safe(result.current_price), safe(result.market_value), safe(result.unrealized_pl), safe(result.qty), safe(result.unrealized_plpc)]
    );
    logger.trace(`[insertSellTransaction] Spedizione messaggio su canale transaction_update: ${JSON.stringify({scenarioId, element, result, state})}`);
    await publishCommand({scenarioId, element, result, state},'transaction_update' );
  } catch (err) {
    logger.error(`[insertSellTransaction] Errore insert:`, err.message);
    throw err;
  } finally {
      connection.release();
  }
  return ({status:"success"});
}

async function updateTransaction(id, transaction) {
  const fields = Object.keys(transaction);
  if (fields.length === 0) return { success: false, error: 'No fields to update' };

  const setClause = fields.map(f => `${f} = ?`).join(', ');

  const values = fields.map(f => {
    const val = transaction[f];
    if (val === undefined) return null; 
    if (f.toLowerCase().includes('date')) {
      return safe(formatDateForMySQL(val));
    }
    return safe(val);
  });

  values.push(id);

  const sql = `UPDATE transazioni SET ${setClause} WHERE id = ?`;
  const conn = await getDbConnection();
  try {
    await conn.execute(sql, values);
    logger.trace(`[updateTransaction] Spedizione messaggio su canale transaction_update: ${JSON.stringify(transaction)}`);
    await publishCommand(transaction,'transactions:update' );
    return { success: true };
  } catch (err) {
    console.error('[updateTransaction]', err.message);
    throw err;
  } finally {
      conn.release();
  }
}

async function getLastTransactionByScenario(scenarioId) {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.query(
      `SELECT * FROM transazioni 
       WHERE ScenarioID = ? 
       ORDER BY id DESC 
       LIMIT 1`,
      [scenarioId]
    );
    return rows.length > 0 ? rows[0] : null;
  } catch (err) {
    logger.error(`[getLastTransactionByScenario] Errore select:`, err.message);
    throw err;
  } finally {
     connection.release();
  }
}

async function getOpenTransactions() {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.query(
      `SELECT * FROM transazioni 
       WHERE operation = 'BUY NEW'
       ORDER BY id DESC`
    );
    return rows;
  } catch (err) {
    logger.error(`[getOpenTransactions] Errore select:`, err.message);
    throw err;
  } finally {
    connection.release();
  }
}

async function getTransaction(orderId = null) {
  const connection = await getDbConnection();
  try {
    let query = 'SELECT * FROM transazioni';
    const params = [];

    if (orderId) {
      query += ' WHERE orderId = ?';
      params.push(orderId);
    }

    const [rows] = await connection.execute(query, params);
    return rows;
  } catch (error) {
    logger.error('[getTransaction] Errore:', error.message);
    return [];
  } finally {
    connection.release();
  }
}

async function deleteTransaction(id) {
  const connection = await getDbConnection();
  try {
    const [result] = await connection.execute(
      'DELETE FROM transazioni WHERE id = ?',
      [id]
    );

    if (result.affectedRows > 0) {
      logger.info(`[deleteTransaction] Transazione ${id} eliminata con successo`);
      return true;
    } else {
      logger.info(`[deleteTransaction] Nessuna transazione trovata con ID ${id}`);
      return false;
    }
  } catch (error) {
    logger.error(`[deleteTransaction] Errore eliminazione transazione ${id}: ${error.message}`);
    throw error;
  } finally {
    connection.release();
  }
}




async function getScenarioIdByOrderId(orderId) {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.query(
      `SELECT * FROM transazioni WHERE orderId = ? ORDER BY id DESC LIMIT 1`,
      [orderId]
    );
    return rows.length > 0 ? rows[0] : null;
  } catch (err) {
    logger.error(`[getScenarioIdByOrderId] Errore select:`, err.message);
    throw err;
  } finally {
      connection.release();
  }
}

async function countTransactionsByStrategyAndOrders(body) {
  const { scenarioId, orderIds } = body;
  logger.info(`[countTransactionsByStrategyAndOrders] scenarioId: ${scenarioId}, orderIds: ${JSON.stringify(orderIds)}`);
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.execute(
      `SELECT COUNT(*) AS count FROM transazioni WHERE scenarioId = ? AND orderId IN (${orderIds.map(() => '?').join(',')})`,
      [scenarioId, ...orderIds]
    );
    return rows[0].count;
  } catch (error) {
    logger.error('[countTransactionsByStrategyAndOrders] Errore:', error.message);
    throw err;
  } finally {
      connection.release();
  }
}

async function deleteAllTransactions() {
  const connection = await getDbConnection();
  try {
    await connection.execute('DELETE FROM Trading.transazioni');
    logger.info('[deleteAllTransactions] Tutte le transazioni eliminate');
    logger.trace(`[deleteAllTransactions] Spedizione messaggio su canale transaction_update`);
    await publishCommand({command:"Delete All"},'transactions:update' );
    return { success: true };
  } catch (err) {
    logger.error('[deleteAllTransactions] Errore:', err.message);
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = {
  insertBuyTransaction,
  insertSellTransaction,
  updateTransaction,
  getLastTransactionByScenario,
  getTransaction,
  getScenarioIdByOrderId,
  countTransactionsByStrategyAndOrders,
  deleteAllTransactions,
  getOpenTransactions,
  deleteTransaction
};