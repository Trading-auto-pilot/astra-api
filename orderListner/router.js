const redis = require('redis');
const axios = require('axios');
const { publishCommand } = require('../shared/redisPublisher');
const newOrder = require('./handlers/new');
const fill = require('./handlers/fill');
const canceled = require('./handlers/cancelled');
const expired = require('./handlers/expired');
const defaultHandler = require('./handlers/defaultHandler');
const createLogger = require('../shared/logger');


const MICROSERVICE= "OrderListener"
const MODULE_NAME = 'Router';
const MODULE_VERSION = '1.0';
const REDIS_POSITIONS_KEY = 'alpaca:positions';
const REDIS_ORDERS_KEY = 'alpaca:orders';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');
const dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
//const redisUrl = process.env.REDIS_URL || 'redis://redis:6379'
const liveMarketlsnrUrl = process.env.LIVEMARKETMANAGER_URL || 'http://localhost:3012';

//let publisher = null;

// (async () => {
//   publisher = redis.createClient({ url: redisUrl });
//   await publisher.connect();
// })();


const eventHandlers = {
  "new": newOrder,
  "fill": fill,                                      // Ordine completamente eseguito.
  "partial_fill": fill,                              // Ordine parzialmente eseguito, parte della quantità è stata riempita
  // "done_for_day": done_for_day,                   // Ordine sospeso fino alla prossima sessione di trading (es. fine giornata di trading).
  "canceled": canceled,                              // Ordine cancellato da te o da Alpaca.
  "expired": expired,                                // Ordine scaduto secondo la policy del time_in_force.
  // "replaced": replaced,                           // Ordine sostituito da un nuovo ordine (modificato).
  // "stopped": stopped,                             // Ordine fermato da uno stop condition (come uno stop-loss).
  // "rejected": rejected,                           // Ordine rifiutato, non sarà eseguito.
  // "suspended": suspended,                         // Ordine sospeso da Alpaca per motivi regolamentari o di rischio.
  // "calculated": calculated,                       // Evento di aggiornamento non operativo (raro, legato a ordini complessi).
  // "order_cancel_rejected":order_cancel_rejected,  // Richiesta di cancellazione rifiutata.
  // Altri eventi
};

const updateDateFild = {
  "new": "updated_at",
  fill : "filled_at",
  partial_fill:"filled_at",
  expired: "expired_at",
  canceled:"canceled_at",
  rejected:"failed_at",
  order_cancel_rejected:"failed_at",
  replaced:"replaced_at"
}


async function routeEvent(eventType, data, AlpacaEnv, AlpacaApi) {
  logger.trace(`Ricevuto evento ${eventType} | ${JSON.stringify(data)}`);
  const handler = eventHandlers[eventType] || defaultHandler;

  if (typeof handler === 'function') {
    await handler(data,eventType, AlpacaEnv, AlpacaApi);
  } else {
    logger.warning(`Nessun handler definito per il tipo di evento: ${eventType}`);
  }

    // Aggiorno la tabella Ordini in modo centrale anziche ripetere
    // questo codice per ogni router
    
    if(!process.env.FAST_SIMUL){
      const now = new Date();
      data.order[updateDateFild[eventType]]= now.toISOString().slice(0, 19).replace('T', ' ');
      logger.trace(`Campo data da aggiornare ${updateDateFild[eventType]} =  ${data.order[updateDateFild[eventType]]}`);
      try{
        logger.log(`[ROUTER] Aggiorno la tabella Ordini PUT ${dbManagerUrl}/orders/${data.order.id} con body ${JSON.stringify(data.order)}`);
        await axios.put(`${dbManagerUrl}/orders/${data.order.id}`, data.order);
      } catch (error) {
        logger.error(`[ROUTER] Errore durante update tabella ordini ${error.message}`);
        return null;
      }
    }


    // Forzo il ricarico degli ordini in tutte le strategie
    //await publishCommand({ action: 'loadActiveOrders' });

    //publisher.publish('commands',JSON.stringify({ "action" : "loadActiveOrders"}));

    //Rimuovo i simbols dagli ordini attivi 
    if (eventType !== 'new' && data.order.symbol) {
      await axios.put(`${liveMarketlsnrUrl}/orderActive/remove`, {
        symbol: data.order.symbol
      });
    }

    await AlpacaApi.refreshCacheActiveOrders();
    await AlpacaApi.refreshCacheActivePositions();
    logger.trace(`[ROUTER] Invio messaggi su ${REDIS_POSITIONS_KEY} e ${REDIS_ORDERS_KEY} `);
    await publishCommand({type:"orderEvent",event:data.order},REDIS_POSITIONS_KEY );
    await publishCommand({type:"orderEvent",event:data.order},REDIS_ORDERS_KEY );
}
module.exports = routeEvent;
