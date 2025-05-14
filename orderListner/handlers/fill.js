

module.exports = async (data) => {
  const axios = require('axios');
  const createLogger = require('../../shared/logger');
  const MODULE_NAME = 'OrderListener Fill';
  const MODULE_VERSION = '1.0';
  const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL);
  logger.trace('[FILL] Order completely filled:', JSON.stringify(data));

  const dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
  const alertingUrl = process.env.ALERTINGMANAGER_URL || 'http://localhost:3008';
  let retData, myStrategy, dettOrder;

  // Recupero scenario id
  try {
    logger.trace(`[FILL] Recupero ScenarioId con  ${dbManagerUrl}/getScenarioIdByOrderId/${data.order.id}`);
    retData = await axios.get(`${dbManagerUrl}/getScenarioIdByOrderId/${data.order.id}`);
  }
  catch (error) {
    logger.error(`[FILL] Errore durante il recupero della strategy id ${error.message}`);
    return null;
  }

  logger.trace(`[FILL] Recupero Indirizzo Alpaca ${dbManagerUrl}/getSetting/ALPACA-${process.env.ENV_ORDER}-BASE`);
  const alpacaServer = await axios.get(`${dbManagerUrl}/getSetting/ALPACA-${process.env.ENV_ORDER}-BASE`);
  const apiKey = await axios.get(`${dbManagerUrl}/getSetting/APCA-API-KEY-ID`);
  const apiSecret = await axios.get(`${dbManagerUrl}/getSetting/APCA-API-SECRET-KEY`);
  let openOrders;
  // Recupero gli ordini ancora aperti
  try {
    logger.trace(`[FILL] Recupero Ordini ancora aperti ${alpacaServer.data.value}/v2/orders`);
    openOrders = await axios.get(`${alpacaServer.data.value}/v2/orders`,  {
      params : {
        status : 'open',
        side : 'buy'
      },
      headers: {
        'APCA-API-KEY-ID': apiKey.data.value,
        'APCA-API-SECRET-KEY': apiSecret.data.value
      }
    });
  } catch (error) {
    logger.error(`[FILL] Errore durante il recupero degli ordini acora aperti ${error.message}`);
    return null;
  }
  const ids = openOrders.data.map(order => order.id);

  //Verifico quanti degli ordini aperti appartengono allo stesso scenario
  try{
    logger.trace(`[FILL] Verifico quanti degli ordini aperti appartengono allo stesso scenario ${dbManagerUrl}/getTransactionCount`);
    openOrders = await axios.post(`${dbManagerUrl}/getTransactionCount`,  
      {
        strategyId : data.order.id,
        orderIds : ids
      });
  }  catch (error) {
    logger.error(`[FILL] Errore durante la verifica di ordini aperti con scenario  ${data.order.id} ${error.message}`);
    return null;
  }

  //Recupero il dettaglio dell'ordine
  try{
    logger.trace(`[FILL] Recupero il dettaglio dell'ordine ${dbManagerUrl}/order/${data.order.id}`);
    dettOrder = await axios.post(`${dbManagerUrl}//order/${data.order.id}`);
  }  catch (error) {
    logger.error(`[FILL] Errore durante il recupero il dettaglio dell'ordine  ${data.order.id} ${error.message}`);
    return null;
  }

    // Recupero i dettagli della strategia da modificare
  try {
    logger.trace(`[FILL] Recupero i dettagli della strategia da modificare ${dbManagerUrl}/strategies`);
    const strategyDetails = await axios.get(`${dbManagerUrl}/strategies`);
    myStrategy = strategyDetails.data.filter( s => s.id === Number(retData.data.ScenarioID));
  } catch (error) {
    logger.error(`[FILL] Errore durante recupero dettagli strategia ${error.message}`);
    return null;
  }

  if(myStrategy.side === buy) {
    if(openOrders > 0) {
      //Se esistono altri ordini sottraggo semplicemente il capitale da openOrders
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
    } else {
      //Se NON esistono altri ordini imposto OpenOrders = 0 sottraendo la quantita' attuale.
      try {
        let body = {id :retData.data.ScenarioID,
          openOrders:myStrategy[0].OpenOrders *-1,
          capitaleInvestito:data.order.filled_qty * data.order.filled_avg_price};
  
        logger.trace(`[FILL] Aggiorno la tabella Strategies con i capitali utilizzati ${dbManagerUrl}/updateStrategyCapitalAndOrders con body ${JSON.stringify(body)}`);
        await axios.post(`${dbManagerUrl}/updateStrategyCapitalAndOrders`, body);
      }
      catch (error) {
          logger.error(`[FILL] Errore durante update capitale nella tabella strategies ${error.message}`);
          return null;
      }
    }
  } else {

  }


  // Aggiorno la tabella transazioni
  try{
    const now = new Date();
    retData.data.operationDate = now.toISOString().slice(0, 19).replace('T', ' ');
    retData.data.operation = myStrategy.side;
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

  // Invio comunicazione di Ordine eseguito
  try{
    // Invio cominicazione via email
    logger.trace(`[FILL] Invio email richiamando ${alertingUrl}/email/send Eseguito FILL prezzo ${retData.data.Price} numero contratti ${retData.data.NumAzioni} totale capitale ${data.order.filled_qty * data.order.filled_avg_price}`);
    await axios.post(`${alertingUrl}/email/send`, {
        to: 'expovin@gmail.com',
        subject: `Ordine ${myStrategy.side} ${retData.data.orderId} completamente Eseguito`,
        body: `Eseguito ordine ${myStrategy.side} ${retData.data.orderId} prezzo ${retData.data.Price} numero contratti ${retData.data.NumAzioni} totale capitale ${data.order.filled_qty * data.order.filled_avg_price}`
    });
  } catch (err) {
    logger.error(`[invioComunicazione] Errore durante invio email `, err.message);
    return null;
  }

};