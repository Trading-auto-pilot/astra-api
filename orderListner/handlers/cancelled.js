

module.exports = async (data,event_type,AlpacaEnv) => {
  const axios = require('axios');
  const createLogger = require('../../shared/logger');
  const MODULE_NAME = 'OrderListener Cancelled';
  const MODULE_VERSION = '1.0';
  const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL);
  logger.trace('[CANCELLED] Order Cancelled:', JSON.stringify(data));


  const dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
  const alertingUrl = process.env.ALERTINGMANAGER_URL || 'http://localhost:3008';
  let retData, myStrategy;

  // Recupero scenario id
  try {
    logger.trace(`[CANCELLED] Recupero ScenarioId con  ${dbManagerUrl}/getScenarioIdByOrderId/${data.order.id}`);
    retData = await axios.get(`${dbManagerUrl}/getScenarioIdByOrderId/${data.order.id}`);
  }
  catch (error) {
    logger.error(`[CANCELLED] Errore durante il recupero della strategy id ${error.message}`);
    return null;
  }
  
    // Recupero i dettagli della strategia da modificare
try {
    logger.trace(`[CANCELLED] Recupero i dettagli della strategia da modificare ${dbManagerUrl}/strategies`);
    const strategyDetails = await axios.get(`${dbManagerUrl}/strategies`);
    myStrategy = strategyDetails.data.filter( s => s.id === Number(retData.data.ScenarioID));
} catch (error) {
    logger.error(`[CANCELLED] Errore durante recupero dettagli strategia ${error.message}`);
    return null;
}

logger.trace(`[CANCELLED] Strategy details : ${JSON.stringify(myStrategy)}`)
  //Aggiorno con il capitale impegnato per questo ordine
  try {
      let body = {id :retData.data.ScenarioID, 
        openOrders:myStrategy.OpenOrders *-1, 
        capitaleInvestito:data.order.filled_qty * data.order.filled_avg_price};

      logger.trace(`[CANCELLED] Aggiorno la tabella Strategies con i capitali utilizzati ${dbManagerUrl}/updateStrategyCapitalAndOrders con body ${JSON.stringify(body)}`);
      await axios.post(`${dbManagerUrl}/updateStrategyCapitalAndOrders`, body);
    }
    catch (error) {
        logger.error(`[CANCELLED] Errore durante update capitale nella tabella strategies ${error.message}`);
        return null;
    }

  // Aggiorno la tabella transazioni
  try{
    const now = new Date();
    retData.data.operationDate = now.toISOString().slice(0, 19).replace('T', ' ');
    retData.data.operation = 'CANCELLED';
    logger.trace(`[CANCELLED] Aggiorno tabella transazioni ${dbManagerUrl}/updateTransaction ${JSON.stringify(retData.data)}`);
    const rc = await axios.post(`${dbManagerUrl}/updateTransaction`, retData.data);
    logger.log(`[CANCELLED] Aggiornata tabella transazioni ${JSON.stringify(rc.data)}`);

  } catch (error) {
    logger.error(`[CANCELLED] Errore durante aggiornamento tabella transazioni ${error.message}`);
    return null;
  }

  // Invio comunicazione di Ordine eseguito
  try{
    // Invio cominicazione via email
    logger.trace(`[CANCELLED] Invio email richiamando ${alertingUrl}/email/send Ordine cancellato ${data.order.id}`);
    await axios.post(`${alertingUrl}/email/send`, {
        to: 'expovin@gmail.com',
        subject: `Ordine ${data.order.id} Cancellato`,
        body: `Ordine ${data.order.id} Cancellato. Simpobo ${data.order.symbol} q.ta ${data.order.qty}`
    });
  } catch (err) {
    logger.error(`[invioComunicazione] Errore durante invio email `, err.message);
    return null;
  }
};