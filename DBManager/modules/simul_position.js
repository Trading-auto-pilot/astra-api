// modules/simul_position.js

const { v4: uuidv4 } = require('uuid');
const { getDbConnection, sanitizeData } = require('./core');
const createLogger = require('../../shared/logger');
const cache = require('../../shared/cache');

const MICROSERVICE = 'DBManager';
const MODULE_NAME = 'simulOrder';
const MODULE_VERSION = '2.0';
let intervalId = null;

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

async function simul_getAllPositionsAsJson() {
  const keys = await cache.keys('simul_positions:*');
  const records = [];

  for (const key of keys) {
    const data = await cache.get(key);
    //const cleaned = sanitizeData('simul_positions',JSON.parse(data));
    records.push(JSON.parse(data));
  }

  // Se ho record da Redis li ritorno
  return records;
}

async function simul_insertPosition(position) {
  const id = uuidv4();
  position.position_id=id;
  const key = `simul_positions:${position.symbol}`;
  position.position_id = id;
  position.market_value = parseFloat(position.qty) * parseFloat(position.avg_entry_price);
  const cleaned = sanitizeData('Positions',position);
  await cache.setp(key, JSON.stringify(cleaned));
  const positions = await simul_getAllPositionsAsJson();
  return positions.find(pos => pos.symbol === position.symbol);
}

async function simul_updatePosition(positionUpdate) {
  logger.trace('[simul_updatePosition] Update con position | ' + JSON.stringify(positionUpdate));

  if (!positionUpdate.symbol) {
    logger.error('[simul_updatePosition] asset_id mancante');
    return { success: false, error: 'Chiavi primarie mancanti' };
  }

  const sanitizedPosition = sanitizeData('Positions', positionUpdate);
  const redisKey = `simul_positions:${sanitizedPosition.symbol}`;

  try {
    const existingRaw = await cache.get(redisKey);
    if (!existingRaw) {
      logger.warning('[simul_updatePosition] Nessuna posizione trovata su Redis');
      return { success: false, error: 'Posizione non trovata' };
    }

    const existing = JSON.parse(existingRaw);
    //const sanitizedExisting = sanitizeData(existing);

    const existingQty = existing.qty;
    const newQty = sanitizedPosition.qty;
    const totalQty = existingQty + newQty;
    logger.trace(`[simul_updatePosition] existingQty: ${existingQty} newQty: ${newQty} totalQty: ${totalQty}`);

    const weightedAvg = (oldVal, newVal) => {
      const oldNum = parseFloat(oldVal || 0);
      const newNum = parseFloat(newVal || 0);
      return totalQty === 0 ? 0 : ((existingQty * oldNum + newQty * newNum) / totalQty);
    };

    const updated = {
      ...existing,
      ...sanitizedPosition,
      qty: totalQty,
      avg_entry_price: weightedAvg(existing.avg_entry_price, sanitizedPosition.avg_entry_price),
    };

    await cache.setp(redisKey, JSON.stringify(updated));

    logger.info(`[simul_updatePosition] Posizione ${updated.symbol} aggiornata su Redis`);
    const positions = await simul_getAllPositionsAsJson();
    return positions.find(pos => pos.symbol === positions.symbol);
  } catch (error) {
    logger.error(`[simul_updatePosition] Errore: ${error.message}`);
    throw error;
  }
}

async function simul_closePosition(symbol) {
  logger.info(`[simul_closePosition] cancello posizione con symbol: ${symbol}`);
  await cache.del(`simul_positions:${symbol}`);
}

async function simul_deleteAllPositions() {
  const keys = await cache.keys('simul_positions:*');
  logger.info(`[simul_deleteAllPositions] Eliminazione di ${keys.length} posizioni. keys | ${JSON.stringify(keys)}`);
  if (keys.length > 0) {
    const multi = cache.client.multi();
    keys.forEach(k => multi.del(k));
    await multi.exec();
  }
}

async function syncRedisToMySQLOnce() {
  let numPosizioni = 0;
  try {
    const keys = await cache.keys('simul_positions:*');
    if (!keys.length) return;
    numPosizioni = keys.length;

    const connection = await getDbConnection();

    for (const key of keys) {
      const value = await cache.get(key);
      if (!value) continue;

      const record = JSON.parse(value);
      const fields = Object.keys(record);
      const placeholders = fields.map(() => '?').join(', ');
      const sql = `REPLACE INTO Simul.Positions (${fields.join(',')}) VALUES (${placeholders})`;
      const values = fields.map(f => record[f]);

      await connection.execute(sql, values);
    }

    logger.info(`[syncRedisToMySQL] Sincronizzati ${keys.length} record`);
  } catch (err) {
    logger.error(`[syncRedisToMySQL] Errore: ${err.message}`);
  }

  return({success:true, posizioniSynctoDB:numPosizioni})
}

function startSyncRedisToMySQL() {
  if (intervalId) {
    logger.warning('[startSync] Sync già attivo');
    return;
  }
  intervalId = setInterval(syncRedisToMySQLOnce, 30000);
  logger.info('[startSync] Sync attivato (ogni 30s)');
}

function stopSyncRedisToMySQL() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('[stopSync] Sync fermato');
  } else {
    logger.warning('[stopSync] Sync non attivo');
  }
}

if(!process.env.FAST_SIMUL)
  startSyncRedisToMySQL();

module.exports = {
  simul_getAllPositionsAsJson,
  simul_insertPosition,
  simul_updatePosition,
  simul_closePosition,
  simul_deleteAllPositions,
  syncRedisToMySQLOnce,
  startSyncRedisToMySQL,
  stopSyncRedisToMySQL


};
