// modules/strategy_stats.js

const { getDbConnection } = require('./core');
const logger = require('../../shared/logger')('StrategyStats');

function parseParamsInRows(rows) {
  return rows.map(row => {
    if (row.params) {
      try {
        row.params = JSON.parse(row.params);
      } catch (err) {
        logger.warn(`[parseParamsInRows] Errore nel parsing JSON per ID ${row.id}: ${err.message}`);
      }
    }
    return row;
  });
}

async function getTotalActiveCapital() {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.query(`
      SELECT SUM(CapitaleInvestito) + SUM(OpenOrders) AS totalCapital 
      FROM strategies 
      WHERE status = 'active'`
    );
    return rows[0].totalCapital || 0;
  } catch (err) {
    logger.error(`[getTotalActiveCapital] Errore SELECT:`, err.message);
    throw err;
  } finally {
    await connection.end();
  }
}

async function updateStrategyCapitalAndOrders({ id, capitaleInvestito, openOrders }) {
  const connection = await getDbConnection();
  try {
    if (!id) throw new Error('ID strategia mancante');

    const updates = [];
    const values = [];

    if (capitaleInvestito !== undefined && capitaleInvestito !== null) {
      updates.push('capitaleInvestito = CapitaleInvestito + ?');
      values.push(capitaleInvestito);
    }

    if (openOrders !== undefined && openOrders !== null) {
      updates.push('OpenOrders = OpenOrders + ?');
      values.push(openOrders);
    }

    if (updates.length === 0) throw new Error('Nessun campo da aggiornare');

    const query = `
      UPDATE strategies SET ${updates.join(', ')} WHERE id = ?
    `;
    values.push(id);

    await connection.query(query, values);
  } catch (err) {
    logger.error(`[updateStrategyCapitalAndOrders] Errore UPDATE:`, err.message);
    throw err;
  } finally {
    await connection.end();
  }
}

async function getStrategyCapitalAndOrders(id) {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.query(
      `SELECT * FROM vstrategies WHERE status = 'active'`
    );

    const totalCommitted = rows.reduce((acc, row) => {
      const capitale = Number(row.CapitaleInvestito) || 0;
      const ordini = Number(row.OpenOrders) || 0;
      return acc + capitale + ordini;
    }, 0);

    const filtered = rows.filter(row => Number(row.id) === Number(id)).map(row => ({
      ...row,
      TotalCommitted: totalCommitted
    }));

    if (filtered.length === 0) {
      logger.warn(`[getStrategyCapitalAndOrders] Nessuna strategia trovata con id: ${id}`);
      throw new Error(`Nessuna strategia trovata con id: ${id}`);
    }

    return parseParamsInRows(filtered);
  } catch (err) {
    logger.error(`[getStrategyCapitalAndOrders] Errore SELECT:`, err.message);
    throw err;
  } finally {
    await connection.end();
  }
}

module.exports = {
  parseParamsInRows,
  getTotalActiveCapital,
  updateStrategyCapitalAndOrders,
  getStrategyCapitalAndOrders
};
