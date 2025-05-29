// modules/simul_position.js

const { v4: uuidv4 } = require('uuid');
const { getDbConnection } = require('./core');
const logger = require('../../shared/logger')('SimulPositions');

async function simul_getAllPositionsAsJson() {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.execute('SELECT * FROM Simul.Positions WHERE softDel=0');
    return rows.map(row => ({
      position_id: row.position_id,
      asset_id: row.asset_id,
      symbol: row.symbol,
      exchange: row.exchange,
      asset_class: row.asset_class,
      qty: row.qty.toString(),
      avg_entry_price: row.avg_entry_price.toString(),
      side: row.side,
      market_value: row.market_value.toString(),
      cost_basis: row.cost_basis.toString(),
      unrealized_pl: row.unrealized_pl.toString(),
      unrealized_plpc: row.unrealized_plpc.toString(),
      unrealized_intraday_pl: row.unrealized_intraday_pl.toString(),
      unrealized_intraday_plpc: row.unrealized_intraday_plpc.toString(),
      current_price: row.current_price.toString(),
      lastday_price: row.lastday_price.toString(),
      change_today: row.change_today.toString(),
      qty_available: row.qty_available.toString(),
      softDel: row.softDel.toString()
    }));
  } catch (error) {
    logger.error(`[simul_getAllPositionsAsJson] Errore: ${error.message}`);
    throw error;
  } finally {
    await connection.end();
  }
}

async function simul_insertPosition(position) {
  const connection = await getDbConnection();
  try {
    const [rows] = await connection.execute(
      'SELECT * FROM Simul.Positions WHERE symbol = ? AND softDel != 1 LIMIT 1',
      [position.symbol]
    );

    const newQty = parseFloat(position.qty);
    const newAvg = parseFloat(position.avg_entry_price);

    if (rows.length === 0) {
      const sql = `INSERT INTO Simul.Positions (
        position_id, asset_id, symbol, exchange, asset_class, qty, avg_entry_price, side,
        market_value, cost_basis, unrealized_pl, unrealized_plpc, unrealized_intraday_pl,
        unrealized_intraday_plpc, current_price, lastday_price, change_today, qty_available
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      const values = [
        uuidv4(),
        position.asset_id,
        position.symbol,
        position.exchange || null,
        position.asset_class || null,
        newQty,
        newAvg,
        position.side,
        newQty * newAvg,
        newQty * newAvg,
        parseFloat(position.unrealized_pl),
        parseFloat(position.unrealized_plpc),
        parseFloat(position.unrealized_intraday_pl),
        parseFloat(position.unrealized_intraday_plpc),
        parseFloat(position.current_price),
        parseFloat(position.lastday_price),
        parseFloat(position.change_today),
        parseFloat(position.qty_available)
      ];

      await connection.execute(sql, values);
      logger.info(`[simul_insertPosition] Nuova posizione ${position.symbol} inserita con successo`);
      return { success: true, inserted: true, symbol: position.symbol };
    } else {
      const existing = rows[0];
      const existingQty = parseFloat(existing.qty);
      const existingAvg = parseFloat(existing.avg_entry_price);
      const totalQty = existingQty + newQty;
      const weightedAvg = ((existingQty * existingAvg) + (newQty * newAvg)) / totalQty;

      await connection.execute(
        `UPDATE Simul.Positions SET qty = ?, avg_entry_price = ?, market_value = ?, cost_basis = ?,
         unrealized_pl = ?, unrealized_plpc = ?, unrealized_intraday_pl = ?, unrealized_intraday_plpc = ?,
         current_price = ?, lastday_price = ?, change_today = ?, qty_available = ?
         WHERE position_id = ?`,
        [
          totalQty,
          weightedAvg,
          parseFloat(position.market_value),
          parseFloat(position.cost_basis),
          parseFloat(position.unrealized_pl),
          parseFloat(position.unrealized_plpc),
          parseFloat(position.unrealized_intraday_pl),
          parseFloat(position.unrealized_intraday_plpc),
          parseFloat(position.current_price),
          parseFloat(position.lastday_price),
          parseFloat(position.change_today),
          parseFloat(position.qty_available),
          existing.position_id
        ]
      );

      logger.info(`[simul_insertPosition] Posizione ${position.symbol} aggiornata (qty: ${existingQty} → ${totalQty})`);
      return { success: true, inserted: false, symbol: position.symbol };
    }
  } catch (error) {
    logger.error(`[simul_insertPosition] Errore: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    await connection.end();
  }
}

async function simul_updatePosition(positionUpdate) {
  if (!positionUpdate.position_id) {
    logger.error('[simul_updatePosition] position_id mancante');
    return { success: false, error: 'Chiavi primarie mancanti' };
  }

  const fields = Object.keys(positionUpdate).filter(
    key => key !== 'position_id' && positionUpdate[key] !== undefined
  );

  if (fields.length === 0) {
    logger.warn('[simul_updatePosition] Nessun campo da aggiornare');
    return { success: false, error: 'Nessun campo da aggiornare' };
  }

  const setClause = fields.map(field => `${field} = ?`).join(', ');
  const values = fields.map(field => {
    let value = positionUpdate[field];
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (field.endsWith('_at') && value) return new Date(value);
    if (typeof value === 'object' && value !== null && field === 'legs') return JSON.stringify(value);
    if (typeof value === 'string' && !isNaN(value)) return parseFloat(value);
    return value;
  });

  const sql = `UPDATE Simul.Positions SET ${setClause} WHERE position_id = ?`;

  try {
    const connection = await getDbConnection();
    await connection.execute(sql, [...values, positionUpdate.position_id]);
    await connection.end();
    logger.info(`[simul_updatePosition] Posizione ${positionUpdate.symbol} aggiornata`);
    return { success: true };
  } catch (error) {
    logger.error(`[simul_updatePosition] Errore: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function simul_closePosition(symbol) {
  const connection = await getDbConnection();
  logger.trace(`[closePosition] Chiudo posizioni ${symbol}`);
  try {
    const [positions] = await connection.execute(
      'SELECT market_value FROM Simul.Positions WHERE symbol = ? AND softDel != 1',
      [symbol]
    );

    if (positions.length === 0) {
      logger.warning(`[simul_closePosition] Nessuna posizione attiva trovata per ${symbol}`);
      return { success: false, reason: 'Nessuna posizione attiva trovata' };
    }

    const totalReleased = positions.reduce((acc, pos) => acc + parseFloat(pos.market_value || 0), 0);
    logger.trace(`[simul_closePosition] Somma totale capitale rilasciata ${totalReleased}`);

    await connection.execute(
      'UPDATE Simul.Positions SET softDel = 1 WHERE symbol = ? AND softDel != 1',
      [symbol]
    );

    await connection.execute(
      'UPDATE Simul.Account SET cash = cash + ? WHERE id IS NOT NULL LIMIT 1',
      [totalReleased]
    );

    logger.info(`[simul_closePosition] ${positions.length} posizioni chiuse per ${symbol}. Cash incrementato di ${totalReleased.toFixed(2)}`);
    return { success: true, symbol, released: totalReleased, positions };
  } catch (error) {
    logger.error(`[simul_closePosition] Errore: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    await connection.end();
  }
}

module.exports = {
  simul_getAllPositionsAsJson,
  simul_insertPosition,
  simul_updatePosition,
  simul_closePosition
};
