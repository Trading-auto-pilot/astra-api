// modules/simul_position.js

const { v4: uuidv4 } = require('uuid');
const { getDbConnection } = require('./core');
const createLogger = require('../../shared/logger');

const MICROSERVICE = 'DBManager';
const MODULE_NAME = 'simulOrder';
const MODULE_VERSION = '2.0';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

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
      connection.release();
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
        parseFloat(position.qty),
        parseFloat(position.avg_entry_price),
        position.side,
        parseFloat(position.qty) * parseFloat(position.avg_entry_price),
        parseFloat(position.avg_entry_price),
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
      logger.trace(`[simul_insertPosition]  posizione ${JSON.stringify(position)}`);
      return { success: true, inserted: true, symbol: position.symbol };
    } else {
      await simul_updatePosition(position);
      return { success: true, inserted: false, symbol: position.symbol };
    }
  } catch (error) {
    logger.error(`[simul_insertPosition] Errore: ${error.message}`);
    throw error;
  } finally {
      connection.release();
  }
}

async function simul_updatePosition(positionUpdate) {
  logger.trace('[simul_updatePosition] Update con position | '+JSON.stringify(positionUpdate));
  if (!positionUpdate.asset_id) {
    logger.error('[simul_updatePosition] asset_id mancante');
    return { success: false, error: 'Chiavi primarie mancanti' };
  }

  const connection = await getDbConnection();
  try {
    // Recupera la posizione esistente
    const [rows] = await connection.execute(
      'SELECT * FROM Simul.Positions WHERE asset_id = ? AND softDel != 1 LIMIT 1',
      [positionUpdate.asset_id]
    );

    if (rows.length === 0) {
      logger.warning('[simul_updatePosition] Nessuna posizione trovata');
      return { success: false, error: 'Posizione non trovata' };
    }

    const existing = rows[0];

    // Calcoli con media ponderata
    const existingQty = parseFloat(existing.qty);
    const newQty = parseFloat(positionUpdate.qty);
    const totalQty = existingQty + newQty;
    logger.trace(`[simul_updatePosition] existingQty: ${existingQty} newQty : ${newQty} totalQty:${totalQty}`);

    const weightedAvg = (oldVal, newVal) => {
      const oldNum = parseFloat(oldVal || 0);
      const newNum = parseFloat(newVal || 0);
      return totalQty === 0 ? 0 : ((existingQty * oldNum + newQty * newNum) / totalQty);
    };

    const updatedFields = {
      ...positionUpdate,
      qty: totalQty,
      avg_entry_price: weightedAvg(existing.avg_entry_price, positionUpdate.avg_entry_price),
      //market_value: existing.market_value
    };
    logger.trace(`[simul_updatePosition] updatedFields | ${JSON.stringify(updatedFields)}`);

    const fields = Object.keys(updatedFields).filter(
      key => key !== 'position_id' && updatedFields[key] !== undefined
    );

    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => updatedFields[f]);

    const sql = `UPDATE Simul.Positions SET ${setClause} WHERE asset_id = ?`;
    await connection.execute(sql, [...values, positionUpdate.asset_id]);

    logger.info(`[simul_updatePosition] Posizione ${positionUpdate.symbol} aggiornata`);
    return { success: true };
  } catch (error) {
    logger.error(`[simul_updatePosition] Errore: ${error.message}`);
    throw error;
  } finally {
    connection.release();
  }
}


async function simul_closePosition(symbol) {
  const connection = await getDbConnection();
  logger.trace(`[closePosition] Chiudo posizioni ${symbol}`);
  try {
    const [positions] = await connection.execute(
      'SELECT * FROM Simul.Positions WHERE symbol = ? AND softDel != 1',
      [symbol]
    );
    
    

    if (positions.length === 0) {
      logger.warning(`[simul_closePosition] Nessuna posizione attiva trovata per ${symbol}`);
      return { success: false, reason: 'Nessuna posizione attiva trovata' };
    } else {
      const market_value = positions[0].market_value
    }

    const totalReleased = positions.reduce((acc, pos) => acc + parseFloat(pos.market_value || 0), 0);
    logger.trace(`[simul_closePosition] Somma totale capitale rilasciata ${totalReleased}`);
    console.log(totalReleased);

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
    throw error;
  } finally {
      connection.release();
  }
}

async function simul_deleteAllPositions() {
  const connection = await getDbConnection();
  try {
    await connection.execute('DELETE FROM Simul.Positions');
    logger.info('[simul_deleteAllPositions] Tutte le posizioni eliminate');
    return { success: true };
  } catch (err) {
    logger.error('[simul_deleteAllPositions] Errore:', err.message);
    throw error;
  } finally {
    connection.release(); // Assicurati di usare un pool
  }
}

module.exports = {
  simul_getAllPositionsAsJson,
  simul_insertPosition,
  simul_updatePosition,
  simul_closePosition,
  simul_deleteAllPositions
};
