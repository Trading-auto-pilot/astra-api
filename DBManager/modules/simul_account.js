// modules/simul_account.js

const { getDbConnection } = require('./core');
const createLogger = require('../../shared/logger');

const MICROSERVICE = 'DBManager';
const MODULE_NAME = 'simulAccount';
const MODULE_VERSION = '2.0';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

async function simul_updateAccount(accountUpdate) {
  const connection = await getDbConnection();
  if (!accountUpdate.id) {
    logger.error('[simul_updateAccount] ID mancante');
    return { success: false, error: 'ID obbligatorio per aggiornare l\'account' };
  }

  const fields = Object.keys(accountUpdate).filter(
    key => key !== 'id' && accountUpdate[key] !== undefined
  );

  if (fields.length === 0) {
    logger.warning('[simul_updateAccount] Nessun campo da aggiornare');
    return { success: false, error: 'Nessun campo da aggiornare' };
  }

  const setClause = fields.map(field => `${field} = ?`).join(', ');
  const values = fields.map(field => {
    const value = accountUpdate[field];
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'string' && !isNaN(value)) return parseFloat(value);
    if (field.endsWith('_at') && value) return new Date(value);
    return value;
  });

  const sql = `UPDATE Simul.Account SET ${setClause} WHERE id = ?`;

  try {
    await connection.execute(sql, [...values, accountUpdate.id]);
    logger.info(`[simul_updateAccount] Account ${accountUpdate.id} aggiornato`);
    return { success: true };
  } catch (error) {
    logger.error(`[simul_updateAccount] Errore: ${error.message}`);
    throw error;
  } finally {
      connection.release();
  }
}

async function simul_getAccountAsJson() {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.execute('SELECT * FROM Simul.Account LIMIT 1');
    if (rows.length === 0) return null;
    const row = rows[0];

    return {
      id: row.id,
      account_number: row.account_number,
      status: row.status,
      currency: row.currency,
      buying_power: row.buying_power?.toString(),
      cash: row.cash?.toString(),
      cash_withdrawable: row.cash_withdrawable?.toString(),
      cash_transferable: row.cash_transferable?.toString(),
      portfolio_value: row.portfolio_value?.toString(),
      pattern_day_trader: !!row.pattern_day_trader,
      trading_blocked: !!row.trading_blocked,
      transfers_blocked: !!row.transfers_blocked,
      account_blocked: !!row.account_blocked,
      created_at: row.created_at?.toISOString(),
      trade_suspended_by_user: !!row.trade_suspended_by_user,
      multiplier: row.multiplier,
      shorting_enabled: !!row.shorting_enabled,
      equity: row.equity?.toString(),
      last_equity: row.last_equity?.toString(),
      long_market_value: row.long_market_value?.toString(),
      short_market_value: row.short_market_value?.toString(),
      initial_margin: row.initial_margin?.toString(),
      maintenance_margin: row.maintenance_margin?.toString(),
      last_maintenance_margin: row.last_maintenance_margin?.toString(),
      sma: row.sma?.toString(),
      daytrade_count: row.daytrade_count
    };
  } catch (error) {
    logger.error(`[simul_getAccountAsJson] Errore durante la lettura: ${error.message}`);
    throw error;
  } finally {
      connection.release();
  }
}

module.exports = {
  simul_updateAccount,
  simul_getAccountAsJson
};
