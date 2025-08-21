// modules/simul_orders.js

const { getDbConnection, formatDateForMySQL, safe, sanitizeData } = require('./core');
const createLogger = require('../../shared/logger');
const cache = require('../../shared/cache');

const MICROSERVICE = 'DBManager';
const MODULE_NAME = 'simulOrder';
const MODULE_VERSION = '2.0';

let intervalId = null;

const OPEN_STATES = new Set(['new', 'partially_filled', 'accepted','pending_now','pending_replace']);
const CLOSED_STATE = new Set(['expired','cancelled','filled']);

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

async function simul_getAllOrdersAsJson() {
  const keys = await cache.keys('simul_orders:*');
  const records = [];

  for (const key of keys) {
    const data = await cache.get(key);
    //const cleaned = sanitizeData('simul_positions',JSON.parse(data));

    /*if(OPEN_STATES.has(data.status))*/ records.push(JSON.parse(data));
  }

  // Se ho record da Redis li ritorno
  return records;
}

async function simul_updateOrder(orderUpdate) {
  if (!orderUpdate.id) {
    logger.error('[simul_updateOrder] ID mancante');
    return { success: false, error: 'Campo id obbligatorio' };
  }

  const redisKey = `simul_orders:${orderUpdate.id}`;
  const existingRaw = await cache.get(redisKey);
  

  if (!existingRaw) {
    logger.warning('[simul_updateOrder] Nessun ordine trovato su Redis');
    return { success: false, error: 'Ordine non trovato' };
  }

  const existing = JSON.parse(existingRaw);
  const cleaned = sanitizeData('Orders',existing);

  const updated = { ...cleaned };

  for (const key of Object.keys(orderUpdate)) {
    if (key === 'id' || orderUpdate[key] === undefined) continue;

    const value = orderUpdate[key];

    if (typeof value === 'boolean') {
      updated[key] = value ? 1 : 0;
    } else if (typeof value === 'object' && key === 'legs') {
      updated[key] = JSON.stringify(value);
    } else if (key.endsWith('_at') && value) {
      updated[key] = new Date(value).toISOString();
    } else if (typeof value === 'string' && !isNaN(value)) {
      updated[key] = parseFloat(value);
    } else {
      updated[key] = value;
    }
  }

  await cache.setp(redisKey, JSON.stringify(updated));
  logger.info(`[simul_updateOrder] Ordine ${orderUpdate.id} aggiornato su Redis`);
  return { success: true };
}

async function simul_insertOrder(order) {
  logger.log(`[simul_insertOrder] Ordine ricevuto da inserire in Redis: ${JSON.stringify(order)}`);

  // Usa l'id se presente, altrimenti generane uno
  const orderId = order.id || uuidv4();
  const redisKey = `simul_orders:${orderId}`;
  const orderToStore = sanitizeData('Orders',order);
  try {
    await cache.setp(redisKey, JSON.stringify(orderToStore));
    logger.info(`[simul_insertOrder] Ordine ${orderId} inserito in Redis. Symbol ${order.symbol}`);
    return orderId;
  } catch (err) {
    logger.error(`[simul_insertOrder] Errore inserimento ordine in Redis: ${err.message}`);
    throw err;
  }
}

async function simul_deleteAllOrders() {
  logger.warning(`[simul_deleteAllOrders] Eliminazione di tutti gli ordini da simul`);
  try {
    const keys = await cache.keys('simul_orders:*');
    if (keys.length === 0) {
      logger.info('[simul_deleteAllOrders] Nessuna chiave da eliminare');
      return;
    }

    await cache.del(...keys);
    logger.info(`[simul_deleteAllOrders] Eliminate ${keys.length} chiavi simul_orders`);
  } catch (err) {
    logger.error(`[simul_deleteAllOrders] Errore: ${err.message}`);
    throw err;
  }
}

async function simul_deleteOrderById(orderId) {
  const key = `simul_orders:${orderId}`;
  logger.warning(`[simul_deleteOrderById] Eliminazione ordine con ID: ${orderId}`);

  try {
    const result = await cache.del(key);
    if (result === 1) {
      logger.info(`[simul_deleteOrderById] Ordine ${orderId} eliminato correttamente`);
    } else {
      logger.info(`[simul_deleteOrderById] Nessun ordine trovato con ID: ${orderId}`);
    }
  } catch (err) {
    logger.error(`[simul_deleteOrderById] Errore eliminazione ordine ${orderId}: ${err.message}`);
    throw err;
  }
}



async function syncOrdersOnce() {
  let numRecord=0, orderClosed=0;
  try {
    const keys = await cache.keys('simul_orders:*');
    if (keys.length === 0) return;

    numRecord = keys.length;
    const connection = await getDbConnection();
    
    for (const key of keys) {
      const raw = await cache.get(key);
      if (!raw) continue;

      const order = JSON.parse(raw);
      const clean = sanitizeData('Orders', order);
      const fields = Object.keys(clean);
      const placeholders = fields.map(() => '?').join(', ');
      const sql = `REPLACE INTO Simul.Orders (${fields.join(',')}) VALUES (${placeholders})`;
      const values = fields.map(f => clean[f]);

      await connection.execute(sql, values);

      if (CLOSED_STATE.has(clean.status)) {
        orderClosed++;
        logger.log(`[syncOrders] Elimino ordine ${key} da Redis`);
        await cache.del(key);
      }
    }

    logger.info(`[syncOrders] Sincronizzati ${keys.length} ordini da Redis`);
  } catch (err) {
    logger.error(`[syncOrders] Errore sincronizzazione: ${err.message}`);
  }

  return({success:true, ordersSynconDB:numRecord, ordersClosed:orderClosed})
}

function startSyncOrders() {
  if (intervalId) {
    logger.warning('[startSyncOrders] Sync già attivo');
    return;
  }
  intervalId = setInterval(syncOrdersOnce, 30000);
  logger.info('[startSyncOrders] Sync attivato (ogni 30s)');
}

function stopSyncOrders() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('[stopSyncOrders] Sync fermato');
  } else {
    logger.warning('[stopSyncOrders] Sync non attivo');
  }
}

async function getOpenOrdersBySymbol(symbol) {
  const keys = await cache.keys('simul_orders:*');

  const results = [];

  for (const key of keys) {
    const raw = await cache.get(key);
    if (!raw) continue;

    let order;
    try {
      order = JSON.parse(raw);
    } catch (err) {
      continue;
    }

    if (OPEN_STATES.has(order.status) && order.symbol === symbol) {
      results.push(order);
    }
  }

  return results.length;
}

if(!process.env.FAST_SIMUL)
  startSyncOrders()

module.exports = {
  simul_getAllOrdersAsJson,
  simul_updateOrder,
  simul_insertOrder,
  simul_deleteAllOrders,
  syncOrdersOnce,
  startSyncOrders,
  stopSyncOrders,
  getOpenOrdersBySymbol,
  simul_deleteOrderById

};
