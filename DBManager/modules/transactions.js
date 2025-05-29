// modules/transactions.js

const { getDbConnection, formatDateForMySQL } = require('./core');
const logger = require('../../shared/logger')('Transactions');
const { publishCommand } = require('../../shared/redisPublisher');

async function insertBuyTransaction(body) {
  const { scenarioId, element, capitaleInvestito, prezzo, operation = 'BUY', MA, orderId, NumAzioni } = body;
  const connection = await getDbConnection();
  try {
    await connection.query(
      `INSERT INTO transazioni 
       (ScenarioID, operation, operationDate, Price, capitale, MA, orderId, NumAzioni)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [scenarioId, operation, formatDateForMySQL(element.t), prezzo, capitaleInvestito, MA, orderId, NumAzioni]
    );
    logger.trace(`[insertBuyTransaction] Spedizione messaggio su canale transaction_update: ${JSON.stringify(body)}`);
    await publishCommand(body,'transaction_update' );

  } catch (err) {
    logger.error(`[insertBuyTransaction] Errore insert:`, err.message);
    throw err;
  } finally {
    await connection.end();
  }
}

async function insertSellTransaction(scenarioId, element, result, state) {
  const connection = await getDbConnection();
  try {
    await connection.query(
      `INSERT INTO transazioni 
       (ScenarioID, operationDate, operation, Price, capitale, profitLoss, NumAzioni, PLPerc)
       VALUES (?, ?, 'SELL', ?, ?, ?, ?, ?)`,
      [scenarioId, formatDateForMySQL(element.t), result.prezzo, state.capitaleLibero, result.current_price, result.market_value, result.unrealized_pl, result.qty, result.unrealized_plpc]
    );
    logger.trace(`[insertSellTransaction] Spedizione messaggio su canale transaction_update: ${JSON.stringify({scenarioId, element, result, state})}`);
    await publishCommand({scenarioId, element, result, state},'transaction_update' );
  } catch (err) {
    logger.error(`[insertSellTransaction] Errore insert:`, err.message);
    throw err;
  } finally {
    await connection.end();
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
    await connection.end();
  }
}

async function getTransaction(orderId) {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.execute(
      `SELECT * FROM transazioni WHERE orderId = ?`,
      [orderId]
    );
    return rows;
  } catch (error) {
    logger.error('[getTransaction] Errore:', error.message);
    return [];
  } finally {
    await connection.end();
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
    await connection.end();
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
    return 0;
  } finally {
    await connection.end();
  }
}

module.exports = {
  insertBuyTransaction,
  insertSellTransaction,
  getLastTransactionByScenario,
  getTransaction,
  getScenarioIdByOrderId,
  countTransactionsByStrategyAndOrders
};