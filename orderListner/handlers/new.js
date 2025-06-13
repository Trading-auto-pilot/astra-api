

module.exports = async (data,event_type,AlpacaEnv) => {
  const axios = require('axios');
  const createLogger = require('../../shared/logger');
  const MICROSERVICE = 'OrderListner'
  const MODULE_NAME = 'NEW';
  const MODULE_VERSION = '1.0';
  const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');


  logger.trace('[NEW] New Order |', JSON.stringify(data));

  const dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
  const alertingUrl = process.env.ALERTINGMANAGER_URL || 'http://localhost:3008';
  let retData, myStrategy;

  // Recupero scenario id
  logger.trace(`[NEW] Recupero ScenarioId con  ${dbManagerUrl}/transactions/scenarioIdByOrderId/${data.order.id}`);
  try {
    retData = await axios.get(`${dbManagerUrl}/transactions/scenarioIdByOrderId/${data.order.id}`);
  }
  catch (error) {
    logger.error(`[NEW] Errore durante il recupero della strategy id ${error.message}`);
    return null;
  }
  
    // Recupero i dettagli della strategia da modificare
    logger.trace(`[NEW] Recupero i dettagli della strategia da modificare ${dbManagerUrl}/strategies`);
try {
    const strategyDetails = await axios.get(`${dbManagerUrl}/strategies`);
    myStrategy = strategyDetails.data.filter( s => s.id === Number(retData.data.ScenarioID));
} catch (error) {
    logger.error(`[NEW] Errore durante recupero dettagli strategia ${error.message}`);
    return null;
}

logger.trace(`[NEW] Strategy details | ${JSON.stringify(myStrategy)}`)
  // Aggiorno la tabella transazioni
  const now = new Date();
  retData.data.operationDate = now.toISOString().slice(0, 19).replace('T', ' ');
  if(data.order.side === 'buy') 
    retData.data.operation = 'BUY NEW';
  else
    retData.data.operation = 'SELL NEW';
  logger.trace(`[NEW] Aggiorno tabella transazioni PUT ${dbManagerUrl}/transactions/${retData.data.id} | ${JSON.stringify(retData.data)}`);
  try{
    const rc = await axios.put(`${dbManagerUrl}/transactions/${retData.data.id}`, retData.data);
  } catch (error) {
    logger.error(`[NEW] Errore durante aggiornamento tabella transazioni ${error.message}`);
    return null;
  }

  // Aggiorno la tabella Ordini
  try{
    logger.trace(`[NEW] Aggiorno Tabella Ordini PUT ${dbManagerUrl}/orders/${data.order.id}`);
    const ret = await axios.put(`${dbManagerUrl}/orders/${data.order.id}`, data.order);
  } catch (error) {
    logger.trace(`[NEW] Errore nell'aggiornamento della tabella Ordini ${error.message}`);
    return null;
  }


  // Invio comunicazione di Ordine eseguito
  try{
    // Invio cominicazione via email
    logger.trace(`[NEW] Invio email richiamando ${alertingUrl}/email/send Ordine New ${data.order.id}`);
    await axios.post(`${alertingUrl}/email/send`, {
        to: 'expovin@gmail.com',
        subject: `Ordine ${data.order.id} Cancellato`,
        body: `Ordine ${data.order.id} New. Simpolo ${data.order.symbol} q.ta ${data.order.qty}`
    });
  } catch (err) {
    logger.error(`[invioComunicazione] Errore durante invio email `, err.message);
    return null;
  }
};