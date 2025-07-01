

module.exports = async (data, event_type, AlpacaEnv, AlpacaApi) => {
  const axios = require('axios');
  const createLogger = require('../../shared/logger');
  const fillOrder = require('./fillOrder');


  let side = data.order.side.toUpperCase();
  const MICROSERVICE = "OrderListner"
  const MODULE_NAME =  'Fill';
  const MODULE_VERSION = '1.1';
  const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');
  logger.trace('[FILL ${side}] Order completely filled:', JSON.stringify(data));

  const dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
  const alertingUrl = process.env.ALERTINGMANAGER_URL || 'http://localhost:3008';
  const capitalManagerUrl = process.env.CAPITALMANAGER_URL || 'http://localhost:3009';
  let transazioni, strategia, myStrategy, capitali;

  const axiosNoRetry = axios.create({
    timeout: 2000, // oppure il timeout che preferisci
    maxRedirects: 0,
    transitional: { clarifyTimeoutError: true }
  });


  /**  ***************************************************************************************** */
  // Recupero transazioni
  try {
    logger.trace(`[FILL ${side}] Recupero ScenarioId con  ${dbManagerUrl}/transactions/ScenarioIdByOrderId/${data.order.id}`);
    transazioni = await axios.get(`${dbManagerUrl}/transactions/ScenarioIdByOrderId/${data.order.id}`);
    logger.trace(`[FILL ${side}] trovata transazione ${JSON.stringify(transazioni.data)}`);
  }
  catch (error) {
    logger.error(`[FILL ${side}] Errore durante il recupero della transazione ${error.message}`);
    return null;
  }
  /**  ***************************************************************************************** */

  /**  ***************************************************************************************** */
  // Recupero strategia
  try {
    logger.trace(`[FILL ${side}] Recupero ScenarioId con GET ${dbManagerUrl}/strategies/symbol/${data.order.symbol}`);
    strategia = await axios.get(`${dbManagerUrl}/strategies/symbol/${data.order.symbol}`);
    logger.trace(`[FILL ${side}] Strategia recuperata  ${JSON.stringify(strategia.data[0])}`);
  }
  catch (error) {
    logger.error(`[FILL ${side}] Errore durante il recupero della strategy id ${error.message}`);
    return null;
  }
  /**  ***************************************************************************************** */

    /**  ***************************************************************************************** */
  // Recupero strategy_runs
  if(strategia.data[0].posizioneMercato !== "OFF") {
    try {
      logger.trace(`[FILL ${side}] Recupero strategy_runs con GET ${dbManagerUrl}/strategies/runs/strategy/${strategia.data[0].posizioneMercato}`);
      strategy_runs = await axios.get(`${dbManagerUrl}/strategies/runs/strategy/${strategia.data[0].posizioneMercato}`);
      strategy_runs = strategy_runs.data
      logger.trace(`[FILL ${side}] Strategy runs recuperata  ${JSON.stringify(strategy_runs)}`);
    }
    catch (error) {
      logger.error(`[FILL ${side}] Errore durante il recupero della strategy runs ${error.message}`);
      return null;
    }
  } else {
    logger.trace(`[FILL ${side}] Posizione Mercato OFF, nuova strategia azzero tutto.`);
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


   // Recupero capitali usati
   try {
      const url = `${capitalManagerUrl}/capital`;
      logger.trace(`[FILL ${side}] Recupero Capitali da capitalManager ${url}`);
      capitali = await axios.get(`${url}`);
   } catch (error) {
    logger.error(`[FILL ${side}] Errore durante il recupero dei capitali da ${url} erro : ${error.message}`);
    return null;
   }

   // Aggiornamento totaleCapitale con capitale svincolato in caso vendita
   if(data.order.side === "sell"){
    const capitaleSvincolato = Number(data.order.qty) * Number(data.order.filled_avg_price);
    logger.log(`[FILL ${side}] Chiusura posizione incremento totaleCapitale con la somma svincolata ${data.order.qty} x ${data.order.filled_avg_price} = ${capitaleSvincolato}`);
    logger.trace(`[FILL ${side}] pre capitali | ${JSON.stringify(capitali.data)}`);
    capitali.data.totaleCapitale += capitaleSvincolato;
    capitali.data.alpacaCache += capitaleSvincolato;
    logger.trace(`[FILL ${side}] nuovo capitali | ${JSON.stringify(capitali.data)}`);
    try {
      const url = `${capitalManagerUrl}/capital/calcolaAlloc`;
      const body = {data : capitali.data.capitalData, alpacaCache : capitali.data.alpacaCache, freeUp:false};
      logger.log(`[FILL ${side}] Chiamo ${url} con body | ${JSON.stringify(body)}`);
      await axios.put(url,body);
    } catch (error) {
       logger.error(`[FILL ${side}] Errore chiamata PUT ${capitalManagerUrl}/capital/calcolaAlloc : ${error.message}`);
    }
   }

  /**  ***************************************************************************************** */
  // Recupero gli ordini ancora aperti per verificare se esistono altri ordini su questo symbol
  logger.trace(`[FILL ${side}] Recupero Indirizzo Alpaca ${AlpacaEnv}`);
  let openOrders;

  try {
    logger.trace(`[FILL ${side}] Recupero Ordini ancora aperti ${AlpacaEnv}/v2/orders`);
    openOrders = await AlpacaApi.loadActiveOrders({side:'buy'})
  } catch (error) {
    logger.error(`[FILL ${side}] Errore durante il recupero degli ordini acora aperti ${error.message}`);
    return null;
  }
  const ids = openOrders.map(order => order.id);
  logger.trace(`[FILL ${side}] ids : ${JSON.stringify(ids)}`);
  /**  ***************************************************************************************** */

  /**  ***************************************************************************************** */
  //Verifico quanti degli ordini aperti appartengono allo stesso scenario
  if(ids.length > 0){
    try{
      const body ={
          scenarioId :strategia.data[0].id,
          orderIds : ids
        }
      logger.trace(`[FILL ${side}] Verifico quanti degli ordini aperti appartengono allo stesso scenario ${dbManagerUrl}/transactions/countByStrategyAndOrder con | ${JSON.stringify(body)}`);
      openOrders = await axios.post(`${dbManagerUrl}/transactions/countByStrategyAndOrder`,  body);
    }  catch (error) {
      logger.error(`[FILL ${side}] Errore durante la verifica di ordini aperti con scenario  ${data.order.id} ${error.message}`);
      return null;
    }
  } else {
    openOrders={"data" : { "count" : 0}}
  }

  /**  ***************************************************************************************** */


  // Istanzio la calsse comune e gli passo le transazioni e la strategia.
  const fillComm = new fillOrder(event_type, data, transazioni.data, strategia.data[0], /*cache,*/ openOrders.data.count, strategy_runs, capitali.data);

  logger.trace(`[FILL ${side}] Calcolo update KPIs`);
  fillComm.updateKPIs();

  // Aggiorno la tabella transazioni
  try {
    logger.trace(`[FILL ${side}] Aggiorno Tabella Transazioni PUT ${dbManagerUrl}/transactions/${fillComm.getTransazioni().id} con ${JSON.stringify(fillComm.getTransazioni())}`);
    const ret = await axios.put(`${dbManagerUrl}/transactions/${fillComm.getTransazioni().id}`, fillComm.getTransazioni());
  } catch (error) {
    logger.error(`[FILL ${side}] Errore nell'aggiornamento della tabella transazioni ${error.message}`);
    //return null;
  }

  // Aggiorno la tabella Strategies
  try{
    const updStrategy = fillComm.getStrategia();
    const { idBotIn, idBotOut, idSymbol, ...cleanedStrategy } = updStrategy;
    logger.trace(`[FILL ${side}] Aggiorno Tabella Strategies PUT ${dbManagerUrl}/strategies/${fillComm.getStrategia().id} con ${JSON.stringify(cleanedStrategy)}`);
    const ret = await axios.put(`${dbManagerUrl}/strategies/${fillComm.getStrategia().id}`, cleanedStrategy);
    // Aggiornamento capitali 

    const url = `${capitalManagerUrl}/capital/${fillComm.getStrategia().id}`;
    await axiosNoRetry.put(url,{used : fillComm.getStrategia().CapitaleInvestito, approved : strategia.data[0].CapitaleInvestito});
    logger.trace(`[FILL ${side}] Aggiorno Capitali in CapitalManager used : ${fillComm.getStrategia().CapitaleInvestito} approved:${strategia.data[0].CapitaleInvestito}`);
  } catch (error) {
    logger.error(`[FILL ${side}] Errore nell'aggiornamento della tabella strategies ${error.message}`);
    //return null;
  }




  // Aggiorno la tabella Strategy_runs
  if(fillComm.isNewStrategyRuns()) {
    try{
      logger.trace(`[FILL ${side}] Aggiungo nuovo record a Strategy_runs chiamo POST ${dbManagerUrl}/strategies/runs/strategy con body | ${JSON.stringify(fillComm.getNewStrategyRuns())}`);
      const ret = await axios.post(`${dbManagerUrl}/strategies/runs/strategy`, fillComm.getNewStrategyRuns());
    } catch (error) {
      logger.trace(`[FILL ${side}] Errore nell'inserimento di un record nella tabella strategy_runs ${error.message}`);
      //return null;
    }
  } else {
      const updateFields = fillComm.getNewStrategyRuns();
      delete updateFields['open_date'];
    try{
      logger.trace(`[FILL ${side}] Aggiorno la tabella Strategy_runs chiamo PUT ${dbManagerUrl}/strategies/runs/strategy/${updateFields.strategy_runs_id} con body | ${JSON.stringify(fillComm.getNewStrategyRuns())}`);
      const ret = await axios.put(`${dbManagerUrl}/strategies/runs/strategy/${updateFields.strategy_runs_id}`, updateFields);
    } catch (error) {
      logger.error(`[FILL ${side}] Errore nell'aggiornamento della tabella strategy_runs ${error.message}`);
      //return null;
    }
  }




  /**  ***************************************************************************************** */
  // Invio comunicazione di Ordine eseguito
  try{
    // Invio cominicazione via email
    logger.trace(`[FILL ${side}] Invio email richiamando ${alertingUrl}/email/send Eseguito FILL prezzo ${transazioni.data.Price} numero contratti ${transazioni.data.NumAzioni} totale capitale ${data.order.filled_qty * data.order.filled_avg_price}`);
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