

module.exports = async (data) => {
  const axios = require('axios');
  const createLogger = require('../../shared/logger');
  const fillCommClass = require('./fillCommon');
  const MODULE_NAME = 'OrderListener Fill';
  const MODULE_VERSION = '1.1';
  const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL);
  logger.trace('[FILL] Order completely filled:', JSON.stringify(data));

  const dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
  const alertingUrl = process.env.ALERTINGMANAGER_URL || 'http://localhost:3008';
  let transazioni, strategia, myStrategy, dettOrder, cache;

  /**  ***************************************************************************************** */
  // Recupero transazioni
  try {
    logger.trace(`[FILL] Recupero ScenarioId con  ${dbManagerUrl}/getScenarioIdByOrderId/${data.order.id}`);
    transazioni = await axios.get(`${dbManagerUrl}/getScenarioIdByOrderId/${data.order.id}`);
  }
  catch (error) {
    logger.error(`[FILL] Errore durante il recupero della strategy id ${error.message}`);
    return null;
  }
  /**  ***************************************************************************************** */

  /**  ***************************************************************************************** */
  // Recupero strategia
  try {
    logger.trace(`[FILL] Recupero ScenarioId con  ${dbManagerUrl}/getStrategyCapitalAndOrders/${transazioni.data[0].ScenarioID}`);
    strategia = await axios.get(`${dbManagerUrl}/getStrategyCapitalAndOrders/${transazioni.data[0].ScenarioID}`);
  }
  catch (error) {
    logger.error(`[FILL] Errore durante il recupero della strategy id ${error.message}`);
    return null;
  }
  /**  ***************************************************************************************** */


  /**  ***************************************************************************************** */
  // Recupero capitale totale disponibile
  logger.log(`[getAvailableCapital] Recupero capitale disponibile da Alpaca : ${this.env}/v2/account`);
  try {
    const res = await axios.get(this.env+'/v2/account', {
      headers: {
        'APCA-API-KEY-ID':  apiKey.data.value,
        'APCA-API-SECRET-KEY': apiSecret.data.value
      }
    });
    logger.log(`[getAvailableCapital] Recuperato capitale ${res.data.cash}`);
    cache = (parseFloat(res.data.cash));
  } catch (err) {
    logger.error(`[getAvailableCapital] Errore Alpaca:`, err.message);
    return null;
  }
  /**  ***************************************************************************************** */

  /**  ***************************************************************************************** */
  //Recupero il dettaglio dell'ordine
  try{
    logger.trace(`[FILL] Recupero il dettaglio dell'ordine ${dbManagerUrl}/order/${data.order.id}`);
    dettOrder = await axios.post(`${dbManagerUrl}/order/${data.order.id}`);
  }  catch (error) {
    logger.error(`[FILL] Errore durante il recupero il dettaglio dell'ordine  ${data.order.id} ${error.message}`);
    return null;
  }

   /**  ***************************************************************************************** */


  /**  ***************************************************************************************** */
  // Recupero gli ordini ancora aperti per verificare se esistono altri ordini su questo symbol
  logger.trace(`[FILL] Recupero Indirizzo Alpaca ${dbManagerUrl}/getSetting/ALPACA-${process.env.ENV_ORDER}-BASE`);
  const alpacaServer = await axios.get(`${dbManagerUrl}/getSetting/ALPACA-${process.env.ENV_ORDER}-BASE`);
  const apiKey = await axios.get(`${dbManagerUrl}/getSetting/APCA-API-KEY-ID`);
  const apiSecret = await axios.get(`${dbManagerUrl}/getSetting/APCA-API-SECRET-KEY`);
  let openOrders;

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

  /**  ***************************************************************************************** */

  /**  ***************************************************************************************** */
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
  /**  ***************************************************************************************** */


  // Istanzio la calsse comune e gli passo le transazioni e la strategia.
  const fillComm = new fillCommClass(MODULE_NAME, data, transazioni.data, strategia.data[0], dettOrder, cache, openOrders);

  fillComm.updateKPIs();

  // Aggiorno la tabella transazioni
  try {
    logger.trace(`[FILL] Aggiorno Tabella Transazioni ${dbManagerUrl}/updateTransaction`);
    const ret = await axios.post(`${dbManagerUrl}/updateTransaction`, fillComm.getTransazioni());
  } catch (error) {
    logger.trace(`[FILL] Errore nell'aggiornamento della tabella transazioni ${error.message}`);
    return null;
  }

  // Aggiorno la tabella Strategies
  try{
    logger.trace(`[FILL] Aggiorno Tabella Strategies ${dbManagerUrl}/updateStrategies`);
    const ret = await axios.post(`${dbManagerUrl}/updateStrategies`, fillComm.getStrategia());
  } catch (error) {
    logger.trace(`[FILL] Errore nell'aggiornamento della tabella strategies ${error.message}`);
    return null;
  }



  /**  ***************************************************************************************** */
  // Invio comunicazione di Ordine eseguito
  try{
    // Invio cominicazione via email
    logger.trace(`[FILL] Invio email richiamando ${alertingUrl}/email/send Eseguito FILL prezzo ${transazioni.data.Price} numero contratti ${transazioni.data.NumAzioni} totale capitale ${data.order.filled_qty * data.order.filled_avg_price}`);
    await axios.post(`${alertingUrl}/email/send`, {
        to: 'expovin@gmail.com',
        subject: `Ordine ${myStrategy.side} ${transazioni.data.orderId} completamente Eseguito`,
        body: `Eseguito ordine ${myStrategy.side} ${transazioni.data.orderId} prezzo ${transazioni.data.Price} numero contratti ${transazioni.data.NumAzioni} totale capitale ${data.order.filled_qty * data.order.filled_avg_price}`
    });
  } catch (err) {
    logger.error(`[invioComunicazione] Errore durante invio email `, err.message);
    return null;
  }
  /**  ***************************************************************************************** */
};