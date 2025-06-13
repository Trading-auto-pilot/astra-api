

module.exports = async (data, event_type, AlpacaEnv, AlpacaApi) => {
  const axios = require('axios');
  const createLogger = require('../../shared/logger');
  const fillOrder = require('./fillOrder');


  const MICROSERVICE = "OrderListner"
  const MODULE_NAME =  'Fill';
  const MODULE_VERSION = '1.1';
  const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');
  logger.trace('[FILL] Order completely filled:', JSON.stringify(data));

  const dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
  const alertingUrl = process.env.ALERTINGMANAGER_URL || 'http://localhost:3008';
  let transazioni, strategia, myStrategy, dettOrder, cache;

  /**  ***************************************************************************************** */
  // Recupero transazioni
  try {
    logger.trace(`[FILL] Recupero ScenarioId con  ${dbManagerUrl}/transactions/ScenarioIdByOrderId/${data.order.id}`);
    transazioni = await axios.get(`${dbManagerUrl}/transactions/ScenarioIdByOrderId/${data.order.id}`);
    logger.trace(`[FILL] trovata transazione ${JSON.stringify(transazioni.data)}`);
  }
  catch (error) {
    logger.error(`[FILL] Errore durante il recupero della transazione ${error.message}`);
    return null;
  }
  /**  ***************************************************************************************** */

  /**  ***************************************************************************************** */
  // Recupero strategia
  try {
    logger.trace(`[FILL] Recupero ScenarioId con GET ${dbManagerUrl}/strategies/symbol/${data.order.symbol}`);
    strategia = await axios.get(`${dbManagerUrl}/strategies/symbol/${data.order.symbol}`);
    logger.trace(`[FILL] Strategia recuperata  ${JSON.stringify(strategia.data[0])}`);
  }
  catch (error) {
    logger.error(`[FILL] Errore durante il recupero della strategy id ${error.message}`);
    return null;
  }
  /**  ***************************************************************************************** */

    /**  ***************************************************************************************** */
  // Recupero strategy_runs
  if(strategia.data[0].posizioneMercato !== "OFF") {
    try {
      logger.trace(`[FILL] Recupero strategy_runs con GET ${dbManagerUrl}/strategies/runs/strategy/${strategia.data[0].posizioneMercato}`);
      strategy_runs = await axios.get(`${dbManagerUrl}/strategies/runs/strategy/${strategia.data[0].posizioneMercato}`);
      strategy_runs = strategy_runs.data
      logger.trace(`[FILL] Strategy runs recuperata  ${JSON.stringify(strategy_runs)}`);
    }
    catch (error) {
      logger.error(`[FILL] Errore durante il recupero della strategy runs ${error.message}`);
      return null;
    }
  } else {
    strategy_runs = {
      "AvgBuy" :0,
      "AvgSell":0,
      "numAzioniBuy":0,
      "numAzioniSell":0,
      "PLAzione":0,
      "PLCapitale":0,
      "PLPerc":0,
      "Drawdown_PeakMax":null,
      "Drawdown_PeakMin":null,
      "MaxDrawdown":0,
      "Mean":0,
      "M2":0,
      "Varianza":0,
      "ScartoQuadratico":0,
      "ggCapitaleInvestito":0
    };
  }

  /**  ***************************************************************************************** */


  /**  ***************************************************************************************** */
  // Recupero capitale totale disponibile
  logger.log(`[getAvailableCapital] Recupero capitale disponibile da Alpaca : ${AlpacaEnv}/v2/account`);
  try {
    const res = await axios.get(AlpacaEnv+'/v2/account', {
      headers: {
        'APCA-API-KEY-ID':  process.env.APCA_API_KEY_ID,
        'APCA-API-SECRET-KEY': process.env.APCA_API_SECRET_KEY
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
  // try{
  //   logger.trace(`[FILL] Recupero il dettaglio dell'ordine ${dbManagerUrl}/orders/${data.order.id}`);
  //   dettOrder = await axios.get(`${dbManagerUrl}/orders/${data.order.id}`);
  // }  catch (error) {
  //   logger.error(`[FILL] Errore durante il recupero il dettaglio dell'ordine  ${data.order.id} ${error.message}`);
  //   return null;
  // }

   /**  ***************************************************************************************** */


  /**  ***************************************************************************************** */
  // Recupero gli ordini ancora aperti per verificare se esistono altri ordini su questo symbol
  logger.trace(`[FILL] Recupero Indirizzo Alpaca ${AlpacaEnv}`);
  let openOrders;

  try {
    logger.trace(`[FILL] Recupero Ordini ancora aperti ${AlpacaEnv}/v2/orders`);
    openOrders = await AlpacaApi.loadActiveOrders({side:'buy'})
  } catch (error) {
    logger.error(`[FILL] Errore durante il recupero degli ordini acora aperti ${error.message}`);
    return null;
  }
  const ids = openOrders.map(order => order.id);
  logger.trace(`[FILL] ids : ${JSON.stringify(ids)}`);
  /**  ***************************************************************************************** */

  /**  ***************************************************************************************** */
  //Verifico quanti degli ordini aperti appartengono allo stesso scenario
  if(ids.length > 0){
    try{
      const body ={
          scenarioId :strategia.data[0].id,
          orderIds : ids
        }
      logger.trace(`[FILL] Verifico quanti degli ordini aperti appartengono allo stesso scenario ${dbManagerUrl}/transactions/countByStrategyAndOrder con | ${JSON.stringify(body)}`);
      openOrders = await axios.post(`${dbManagerUrl}/transactions/countByStrategyAndOrder`,  body);
    }  catch (error) {
      logger.error(`[FILL] Errore durante la verifica di ordini aperti con scenario  ${data.order.id} ${error.message}`);
      return null;
    }
  } else {
    openOrders={"data" : { "count" : 0}}
  }

  /**  ***************************************************************************************** */


  // Istanzio la calsse comune e gli passo le transazioni e la strategia.
  const fillComm = new fillOrder(event_type, data, transazioni.data, strategia.data[0], cache, openOrders.data.count, strategy_runs);

  logger.trace(`[FILL] Calcolo update KPIs`);
  fillComm.updateKPIs();

  // Aggiorno la tabella transazioni
  try {
    logger.trace(`[FILL] Aggiorno Tabella Transazioni PUT ${dbManagerUrl}/transactions/${fillComm.getTransazioni().id} con ${JSON.stringify(fillComm.getTransazioni())}`);
    const ret = await axios.put(`${dbManagerUrl}/transactions/${fillComm.getTransazioni().id}`, fillComm.getTransazioni());
  } catch (error) {
    logger.trace(`[FILL] Errore nell'aggiornamento della tabella transazioni ${error.message}`);
    //return null;
  }

  // Aggiorno la tabella Strategies
  try{
    const updStrategy = fillComm.getStrategia();
    const { idBotIn, idBotOut, idSymbol, ...cleanedStrategy } = updStrategy;
    logger.trace(`[FILL] Aggiorno Tabella Strategies PUT ${dbManagerUrl}/strategies/${fillComm.getStrategia().id} con ${JSON.stringify(cleanedStrategy)}`);
    const ret = await axios.put(`${dbManagerUrl}/strategies/${fillComm.getStrategia().id}`, cleanedStrategy);
  } catch (error) {
    logger.trace(`[FILL] Errore nell'aggiornamento della tabella strategies ${error.message}`);
    //return null;
  }

  // Aggiorno la tabella Strategy_runs
  if(fillComm.isNewStrategyRuns()) {
    try{
      logger.trace(`[FILL] Aggiungo nuovo record a Strategy_runs chiamo POST ${dbManagerUrl}/strategies/runs/strategy con body | ${JSON.stringify(fillComm.getNewStrategyRuns())}`);
      const ret = await axios.post(`${dbManagerUrl}/strategies/runs/strategy`, fillComm.getNewStrategyRuns());
    } catch (error) {
      logger.trace(`[FILL] Errore nell'inserimento di un record nella tabella strategy_runs ${error.message}`);
      //return null;
    }
  } else {
      const updateFields = fillComm.getNewStrategyRuns();
      delete updateFields['open_date'];
    try{
      logger.trace(`[FILL] Aggiorno la tabella Strategy_runs chiamo PUT ${dbManagerUrl}/strategies/runs/strategy/${updateFields.strategy_runs_id} con body | ${JSON.stringify(fillComm.getNewStrategyRuns())}`);
      const ret = await axios.put(`${dbManagerUrl}/strategies/runs/strategy/${updateFields.strategy_runs_id}`, updateFields);
    } catch (error) {
      logger.trace(`[FILL] Errore nell'aggiornamento della tabella strategy_runs ${error.message}`);
      //return null;
    }
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