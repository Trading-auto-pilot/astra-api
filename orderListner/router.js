//const newOrder = require('./handlers/new');
const fill = require('./handlers/fill');
const partialFill = require('./handlers/partial_fill');
const canceled = require('./handlers/cancelled');
const expired = require('./handlers/expired');
const defaultHandler = require('./handlers/defaultHandler');
const createLogger = require('../shared/logger');

const axios = require('axios');

const MODULE_NAME = 'OrderListener Router';
const MODULE_VERSION = '1.0';
const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL);
const dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';

const eventHandlers = {
  //"new": newOrder,
  "fill": fill,                                      // Ordine completamente eseguito.
  "partial_fill": partialFill,                       // Ordine parzialmente eseguito, parte della quantità è stata riempita
  // "done_for_day": done_for_day,                   // Ordine sospeso fino alla prossima sessione di trading (es. fine giornata di trading).
  "canceled": canceled,                              // Ordine cancellato da te o da Alpaca.
  "expired": expired,                             // Ordine scaduto secondo la policy del time_in_force.
  // "replaced": replaced,                           // Ordine sostituito da un nuovo ordine (modificato).
  // "stopped": stopped,                             // Ordine fermato da uno stop condition (come uno stop-loss).
  // "rejected": rejected,                           // Ordine rifiutato, non sarà eseguito.
  // "suspended": suspended,                         // Ordine sospeso da Alpaca per motivi regolamentari o di rischio.
  // "calculated": calculated,                       // Evento di aggiornamento non operativo (raro, legato a ordini complessi).
  // "order_cancel_rejected":order_cancel_rejected,  // Richiesta di cancellazione rifiutata.
  // Altri eventi
};

const updateDateFild = {
  fill : "filled_at",
  partial_fill:"filled_at",
  expired: "expired_at",
  canceled:"canceled_at",
  rejected:"failed_at",
  order_cancel_rejected:"failed_at",
  replaced:"replaced_at"
}


async function routeEvent(eventType, data) {
  logger.trace(`Ricevuto evento ${eventType}:`, data);
  const handler = eventHandlers[eventType] || defaultHandler;

  if (typeof handler === 'function') {
    await handler(data);
  } else {
    logger.warning(`Nessun handler definito per il tipo di evento: ${eventType}`);
  }

    // Aggiorno la tabella Ordini in modo centrale anziche ripetere
    // questo codice per ogni router
    
    const now = new Date();
    data.order[updateDateFild[eventType]]= now.toISOString().slice(0, 19).replace('T', ' ');
    logger.trace(`Campo data da aggiornare ${updateDateFild[eventType]} =  ${data.order[updateDateFild[eventType]]}`);
    try{
      logger.trace(`[FILL] Aggiorno la tabella Ordini ${dbManagerUrl}/updateOrder con body ${JSON.stringify(data.order)}`);
      await axios.post(`${dbManagerUrl}/updateOrder`, data.order);
    } catch (error) {
      logger.error(`[FILL] Errore durante update tabella ordini ${error.message}`);
      return null;
    }

}
module.exports = routeEvent;
