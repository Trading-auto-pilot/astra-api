

module.exports = async (data) => {
  const axios = require('axios');
  const createLogger = require('../../shared/logger');
  const MODULE_NAME = 'OrderListener Fill';
  const MODULE_VERSION = '1.0';
  const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL);
  logger.trace('[FILL] Order completely filled:', JSON.stringify(data));


  const dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
  const alertingUrl = process.env.ALERTINGMANAGER_URL || 'http://localhost:3008';
  let retData;

  // Recupero scenario id
  try {
    logger.trace(`[FILL] Recupero ScenarioId con  ${dbManagerUrl}/getScenarioIdByOrderId/${data.order.id}`);
    retData = await axios.get(`${dbManagerUrl}/getScenarioIdByOrderId/${data.order.id}`);
  }
  catch (error) {
    logger.error(`[FILL] Errore durante il recupero della strategy id ${error.message}`);
    return null;
  }
  
  //Aggiorno con il capitale impegnato per questo ordine
  try {
      let body = {id :retData.data.ScenarioID, 
        openOrders:data.order.filled_qty * data.order.filled_avg_price * -1, 
        capitaleInvestito:data.order.filled_qty * data.order.filled_avg_price};

      logger.trace(`[FILL] Aggiorno la tabella Strategies con i capitali utilizzati ${dbManagerUrl}/updateStrategyCapitalAndOrders con body ${JSON.stringify(body)}`);
      await axios.post(`${dbManagerUrl}/updateStrategyCapitalAndOrders`, body);
    }
    catch (error) {
        logger.error(`[FILL] Errore durante update capitale nella tabella strategies ${error.message}`);
        return null;
    }

  // Aggiorno la tabella transazioni
  try{
    const now = new Date();
    retData.data.operationDate = now.toISOString().slice(0, 19).replace('T', ' ');
    retData.data.operation = ' BUY PARTIAL';
    retData.data.Price = data.order.filled_avg_price;
    retData.data.capitale = data.order.filled_qty * data.order.filled_avg_price;
    retData.data.NumAzioni = data.order.filled_qty;
    logger.trace(`[FILL] Aggiorno tabella transazioni ${dbManagerUrl}/updateTransaction ${JSON.stringify(retData.data)}`);
    const rc = await axios.post(`${dbManagerUrl}/updateTransaction`, retData.data);
    logger.log(`[FILL] Aggiornata tabella transazioni ${JSON.stringify(rc.data)}`);

  } catch (error) {
    logger.error(`[FILL] Errore durante aggiornamento tabella transazioni ${error.message}`);
    return null;
  }
};