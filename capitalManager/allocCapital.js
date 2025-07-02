// modules/core/db.js
const createLogger = require('../shared/logger');
const Alpaca = require('../shared/Alpaca');
const cache = require('../shared/cache');
const axios = require('axios');

const AlpacaApi = new Alpaca();

const MICROSERVICE = "CapitalManager";
const MODULE_NAME = 'AllocCapital';
const MODULE_VERSION = '1.2';

// Flag di stato a livello di modulo per flush su DB
let flushNeeded = false;                // Abilita salvataggio su DB quando true 
let readNeeded = false;                 // Legge cache da Alpaca quando true
let logLevel = process.env.LOG_LEVEL;

let capitaleTotale,                     // Totale del cache di Alpaca piu il capitale investito in posizioni aperte
                                        // (cosa avrei se chiudessi tutte le posizioni senza profitto o perdita)
    capitaleDisponibile,                // Totale del cache di Alpaca meno quanto gia impegnato in ordini aperti
                                        // rappresenta quanto effettivamente posso usare nel prossimo investimento
    capitaleImpegnato,                  // Somma di capitale investito in posizioni aperte e ordini aperti

    totaleOrdiniAperti,                 // Somma totale degli ordini gia aperti

    totaleCapitaleInvestito;            // Somma totale del capitale investito in posizioni aperete

 
let totaleCapitale, OpenOrders;

const dbManagerUrl =process.env.DBMANAGER_URL || 'http://localhost:3002'
const marketSimulator = process.env.MARKETSIMULATOR_URL || 'http://localhost:3003'    // Usato solo per simulazione

let logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, logLevel || 'info');

function safe(val) {
  return val === undefined ? null : val;
}

function azzeraContatori() {
  capitaleTotale = capitaleDisponibile = capitaleImpegnato = totaleOrdiniAperti = totaleCapitaleInvestito = 0;
}
function setCapitaleDisponibile(value) {capitaleDisponibile = value}
function getCapitaleDisponibile() {return Number(capitaleDisponibile)|| 0}

function setTotaleCapitaleImpegnato(value) { capitaleImpegnato=value}
function getTotaleCapitaleImpegnato() { return Number(capitaleImpegnato)|| 0}

function setTotaleCapitale (value){capitaleTotale=value}
function getTotaleCapitale(){return Number(capitaleTotale)|| 0}

function setTotaleOrdiniAperti (value){totaleOrdiniAperti=value}
function getTotaleOrdiniAperti(){return Number(totaleOrdiniAperti)|| 0}

function setTotaleCapitaleInvestito(value){totaleCapitaleInvestito=value}
function getTotaleCapitaleInvestito(){return Number(totaleCapitaleInvestito) || 0}


function setFlushNeeded(state = true) { flushNeeded = state}
function isFlushNeeded() {return flushNeeded}
function setReadNeeded(state = true) {readNeeded = state}
function isReadNeeded() {return readNeeded}
function getLogLevel(){return logLevel}

function setLogLevel(level) {
    logLevel=level;
    logger.setLevel(level);
}


  /**
   * 
   * @param {*} strategy_id   Strategia su cui viene fatto inserimento ordine
   * @param {*} requested     Capitale richiesto (massimo rimanente per strategia)
   * @param {*} approved      Capitale appivato (prodotto di qty share * costo medio)
   * @returns                 Capitale disponibile : availableCapital
   * 
   * Questa funzione viene chiamata all'inserimento di un ordine di BUY, rimpiazza 
   * il valore di OpenOrder (a cui era assegnato il massimo residuo per la strategia 
   *  - requested - ) con la cifra  richiesta in base al numero di azioni che devono 
   *  essere comprate - approved.
   *  Aggiorna il valore di availableCapital presente in cache con l'eventuale differenza
   *  tra i due valori
   *  Dal momento che OpenOrder viene modificato, il flag Flush viene impostato a true.
   */
  async function setStrategyCapitalInsertOrder(strategy_id, requested, approved) {
    if(getCapitaleDisponibile() && getCapitaleDisponibile() < 0) 
      throw new Error((`[setStrategyCapitalInsertOrder] Capitale disponibile : ${getCapitaleDisponibile()} negativo o nullo`));

    logger.info(`[setStrategyCapitalInsertOrder] Insert Order for strategy ${strategy_id} amount requested ${requested} amount approved ${approved} `);
    const capitalData = await cache.get('strategy:capital');
    const alpacaCache = await cache.get('strategy:capital:availableCache');

    if (!capitalData || !capitalData[strategy_id]) {
      logger.warning(`[setStrategyCapitalInsertOrder] capitalData not found in REDIS ${JSON.stringify(capitalData)} lanch initCapitalManager`);
      await initCapitalManager();
      return null;
    }
 
    // aggiorna Documento
    capitalData[strategy_id].OpenOrders = approved;//Math.round(Math.max(0,OpenOrder - requested + approved));
    logger.trace(`[setStrategyCapitalInsertOrder] OpenOrders per strategy_id ${strategy_id} = ${capitalData[strategy_id].OpenOrders}`);

    // salva il documento aggiornato in Redis
    await cache.setp('strategy:capital', capitalData);
    
    // 2. Recupera il nuovo capitale disponibile e salva su REDIS
    // let availableCapital = await cache.get('strategy:capital:availableCache');
    // availableCapital = Math.max(0,Number(availableCapital) - requested + approved);
    // await cache.setp(`strategy:capital:availableCache`, availableCapital);

    setFlushNeeded();
    const rc = await calcolaAlloc(capitalData, alpacaCache);
    if(!rc.success)
      return ({ approved : false, reason : rc.Error });

    return ({success:true, capitalData:capitalData })
  }

  /**
   * 
   * @param {*} strategy_id   Strategia su cui viene accettato ordine 
   * @param {*} approved      Capitale approvato da CapitalManager (prodotto di qty share * costo medio)
   * @param {*} used          Capitale effettivamente utilizzato in acquisto (acquisto parziale o oscillazione prezzo)
   * @returns                 Capitale disponibile : availableCapital 
   * Questa funzione viene chiamata sul segnale FILL o PARTIAL_FILL di OrderListner. Aggunge a CapitaleInvestito quello usato
   * e rimuove da OpenOrder quello non usato.
   * Anche in questo caso viene aggiornato il capitale disponibile (availableCapital) presente in cache.
   * In questo caso vengono settati a true il flag per fare il flush su DB e quello per recuperare il cach da Alpaca.
   */

  async function setStrategyCapitalAcceptedOrder(strategy_id, approved, used) {

    logger.info(`[setStrategyCapitalAcceptedOrder] Order Accepted for strategy ${strategy_id} amount approved ${approved} amount used ${used}`);
    const capitalData = await cache.get('strategy:capital');
    //const alpacaCache = await cache.get('strategy:capital:availableCache');
    let alpacaCache = await AlpacaApi.getAvailableCapital();
    await cache.setp(`strategy:capital:availableCache`, alpacaCache);

    if (!capitalData || !capitalData[strategy_id]) {
      logger.warning(`[setStrategyCapitalAcceptedOrder] capitalData not found in REDIS ${JSON.stringify(capitalData)} lanch initCapitalManager`);
      await initCapitalManager()
      return null;
    }

    // Recupero informazioni dal documento
    let CapitaleInvestito = Number(capitalData[strategy_id].CapitaleInvestito);
    let OpenOrder = Number(capitalData[strategy_id].OpenOrders);
    // aggiorna Documento
    CapitaleInvestito = used;
    OpenOrder -= Math.round(approved);
    if(OpenOrder + CapitaleInvestito < 0){
      logger.warning(`[setStrategyCapitalAcceptedOrder] OpenOrder negativo. OpenOrder : ${capitalData[strategy_id].OpenOrders} approved : ${approved}`);
      throw new Error(`[setStrategyCapitalAcceptedOrder] OpenOrder negativo. OpenOrder : ${capitalData[strategy_id].OpenOrders} approved : ${approved}`);
    }
      

    capitalData[strategy_id].CapitaleInvestito = CapitaleInvestito;
    capitalData[strategy_id].OpenOrders = 0; //OpenOrder;

    // salva il documento aggiornato in Redis
    await cache.setp('strategy:capital', capitalData);
    

    setFlushNeeded();
    setReadNeeded();
    const rc = await calcolaAlloc(capitalData, alpacaCache);
    if(!rc.success)
      return ({ approved : false, reason : rc.Error });

    return ({success:true, capitalData: capitalData})
  }

  async function freeupCapital(strategy_id, CapitaleInvestito = 0) {

    logger.log(`[freeupCapital] Chiusura strategia ${strategy_id} con CapitaleInvestito ${CapitaleInvestito}`);
    // Aggiorno AvailableCapital
    alpacaCache = await AlpacaApi.getAvailableCapital();
    await cache.setp(`strategy:capital:availableCache`, alpacaCache);

    const capitalData = await cache.get('strategy:capital');
    //  Azzero capitaleInvestito
    capitalData[strategy_id].CapitaleInvestito = CapitaleInvestito;
    // Ricalcola i capitali disponibili
    const rc = await calcolaAlloc(capitalData, alpacaCache, true);
    if(!rc.success)
      return ({ approved : false, reason : rc.Error });
    // salva il documento aggiornato in Redis
    logger.log(`[freeupCapital] Salvataggio struttura post chiusura | ${JSON.stringify(capitalData)}`);
    await cache.setp('strategy:capital',capitalData);
    setReadNeeded();
    setFlushNeeded();
    return({success:true})

  }

  /**
   * 
   * @param {*} strategy_id     Strategia du cui richiedere il capitale disponibile per investimento
   * @returns                   Capitale disponibile - rimanente -
   * Questa funzione viene chiamata al segnale di BUY e serve per recuperare il capitale disponibile per 
   * la strategia e verificare se procedere con l'acquisto.
   * Dal momento che questa funzione modifica OpenOrder inserendo il capitale disponibile, viene impostato 
   * il flag FlushDB a true.
   */

  async function reserveCapitalForStrategy(strategy_id, closed) {
      logger.trace(`[reserveCapitalForStrategy] chiamata con strategy_id : ${strategy_id}`);

      if((getCapitaleDisponibile() && getCapitaleDisponibile() < 0) ) 
        return ({ approved : false , Error: ` Capitale disponibile  ${getCapitaleDisponibile()} negativo o nullo`});

    const capitalData = await cache.get('strategy:capital');
    let AlpacaCache = await cache.get('strategy:capital:availableCache');

    if (!capitalData || !capitalData[strategy_id]) {
      await initCapitalManager();
      return null;
    }
    const strategyData = capitalData[strategy_id];
    logger.trace(`[reserveCapitalForStrategy] strategyData for strategyId ${strategy_id} | ${JSON.stringify(strategyData)}`);

    const rimanente = Number(strategyData.rimanente) || 0;
    const openOrders = Number(strategyData.OpenOrders) || 0;
    AlpacaCache = Number(AlpacaCache) || 0;

    if(closed > Math.round(openOrders + rimanente)){
      capitalData[strategy_id].OpenOrders = 0;
      logger.warning(`[reserveCapitalForStrategy] Prezo security ${closed} maggiore del capitale residuo ${Math.round(openOrders + rimanente)}. Strategy id ${strategy_id} azzero openOrders`);
      await cache.setp('strategy:capital',capitalData);
      return ({ approved : false , Error: `Prezo security ${closed} maggiore del capitale residuo ${Math.round(openOrders + rimanente)}`});
    }
       

    // aggiorna OpenOrders nel documento
    capitalData[strategy_id].OpenOrders = Math.round(openOrders + rimanente);
    logger.trace(`[reserveCapitalForStrategy] capitalData prima di calcolaAlloc  | ${JSON.stringify(capitalData)}`);

    // Ricalcola i capitali disponibili
    const rc = await calcolaAlloc(capitalData, AlpacaCache);
    if(!rc.success)
      return ({ approved : false, reason : rc.Error });
    // salva il documento aggiornato in Redis
    await cache.setp('strategy:capital',capitalData);
    logger.trace(`[reserveCapitalForStrategy] capitalData dopo calcolaAlloc  | ${JSON.stringify(capitalData)}`);
    // salva availableCapital su REDIS
    //await cache.setp('strategy:capital:availableCache',AlpacaCache);

    setFlushNeeded();
    setReadNeeded();

    if(capitalData[strategy_id].OpenOrders > 0)
        return {
            approved : true,
            grantedAmount :capitalData[strategy_id].OpenOrders,
            cacheResiduo : AlpacaCache,
            capitalData : capitalData[strategy_id]
        };
   
    return { approved : false }
  }

  /**
   * 
   * @returns   Contenuto cache
   * Funzione di controllo per verificare il contenuto della cache.
   */
  async function getCapital() {
      let redisKey = 'strategy:capital';
      const capitalData = await cache.get(redisKey);
      if (!capitalData) {
        logger.warning(`[getCapitalCache] errore nel recupero di strategy:capital da REDIS`);
        await initCapitalManager();
        return null;
      }

      redisKey = 'strategy:capital:availableCache';
      const alpacaCache = await cache.get(redisKey);
      if (!alpacaCache) {
        logger.warning(`[getCapitalCache] errore nel recupero di strategy:capital:availableCache da REDIS`);
        return null;
      }

      return {capitalData:capitalData, 
              alpacaCache:alpacaCache, 
              totaleCapitale:getTotaleCapitale(),
              openOrders:getTotaleOrdiniAperti(),
              capitaleInvestito : getTotaleCapitaleInvestito(),
              totaleCapitaleImpegnato:getTotaleCapitaleImpegnato(),
              capitaleDisponibile:getCapitaleDisponibile(),
              flushNeeded : isFlushNeeded(),
              readNeeded : isReadNeeded()
              
            };
  } 
 
  /**
   * 
   * @param {*} data                Dati presenti in cache REDIS
   * @param {*} availableCapital    Capitale disponibile presente in REDIS 
   * @returns                       Nuova struttura REDIS
   * Questa funzione prende in ingresso la struttura in cache REDIS ed effettua tutti i calcoli, strategia per 
   * strategia sul capitale rimanente potenzialmente utilizzabile tenendo conto del capitale totale, di quanto 
   * gia investito e di ordini aperti.
   * Vengono fatti controlli di coerenza e quadratura.
   */
  async function calcolaAlloc(data, alpacaCache, freUp=false) {
    if(alpacaCache < 0) {
      logger.error(`[calcolaAlloc] ERRORE!!! alpacaCache ${alpacaCache} negativo!`);
      // Solo in simulazione
      await axios.post(`${marketSimulator}/stop`);

      // Aggiungere alerting

    }
    let share, investito, ordini, 
        totaleStrategia, rimanente; 

    azzeraContatori();
    // 1. Calcolo del capitale Originale (Disponibile + Impegnato)
    for (const row of Object.values(data)) {
      // This is only for debugging the Simulation --- Remove in prod
      // if(Number(row.CapitaleInvestito) > 36000){
      //   await axios.post('http://localhost:3003/stop');
      // }

      //*********************************************************** */
      freUp? setTotaleCapitaleInvestito(Number(row.CapitaleInvestito)) : setTotaleCapitaleInvestito( getTotaleCapitaleInvestito() + Number(row.CapitaleInvestito));
      setTotaleOrdiniAperti(getTotaleOrdiniAperti() + Number(row.OpenOrders));
    }
    setTotaleCapitaleImpegnato(getTotaleCapitaleInvestito() + getTotaleOrdiniAperti());
    setTotaleCapitale(Number(alpacaCache) + getTotaleCapitaleInvestito());
    setCapitaleDisponibile( Number(alpacaCache) - getTotaleOrdiniAperti() );

    logger.trace(`[calcolaAlloc] totaleCapitaleImpegnato = ${getTotaleCapitaleImpegnato()} Capitale Totaler ${getTotaleCapitale()}`);

    // 2. Calcolo del capitale assegnato e rimanente per ciascuna strategia
    for (const [id, row] of Object.entries(data)) {
      share = Number(row.share) || 0;
      investito = Number(row.CapitaleInvestito) || 0;
      ordini = Number(row.OpenOrders);

      totaleStrategia = Math.round(getTotaleCapitale() * share);
      rimanente = Math.round(Math.max(0, Math.min(totaleStrategia - (investito + ordini), getCapitaleDisponibile())));
      logger.trace(`[calcolaAlloc] Startegia ${id} totale = ${totaleStrategia} rimanente = ${rimanente}`);

      data[id].totaleStrategia = totaleStrategia;
      data[id].rimanente = rimanente;

      // 3. Verifica che somma degli impieghi non superi il budget per strategia
      if (!freUp && ((investito + ordini + rimanente) *1,1 > totaleStrategia )) {
        logger.warning(`[calcolaAlloc] ATTENZIONE!!! Errore quadratura per la strategia ${id}: totaleStrategia = ${totaleStrategia} investito = ${investito} ordini = ${ordini} rimanente = ${rimanente}  totale allocato supera il massimo consentito strategia + 10%.`);
        return({success: false, Error : `Errore di quadratura per la strategia ${id}: totaleStrategia = ${totaleStrategia} investito = ${investito} ordini = ${ordini} rimanente = ${rimanente} totale allocato supera il massimo consentito.`});
      }
    }

    // 4. Verifica che la somma complessiva degli impieghi non superi il capitale originale
    if (!freUp &&  (getTotaleCapitaleImpegnato() > getTotaleCapitale())) {
        logger.warning(`[calcolaAlloc] ATTENZIONE!!! Errore di quadratura complessiva: capitale complessivo impegnato (${getTotaleCapitaleImpegnato()}) supera il totale disponibile (${getTotaleCapitale()}).`);
        return({success:false, Error: `Errore di quadratura complessiva: capitale complessivo impegnato (${getTotaleCapitaleImpegnato()}) supera il totale disponibile (${getTotaleCapitale()}).`});
    }

    if(!freUp &&  (investito < 0 || ordini < 0)) {
        logger.warning(`[calcolaAlloc] ATTENZIONE!!! Errore di quadratura per la strategia ${id}: CapitaleInvestito e OpenOrders non possono essere negativi.`);
        return({Success:false, Error:`[calcolaAlloc] Errore di quadratura per la strategia ${id}: CapitaleInvestito ${investito} e OpenOrders ${ordini} non possono essere negativi.`});
    }

    await cache.setp('strategy:capital', data);
    return ({success:true, data:data});
  }

  /**
   * 
   * @returns 
   * Questa funzione viene chiamata alla partenza dei servizi da CapitalManager per inizzializzare la cache REDIS.
   * Questa funzione lancia anche due counter per fare il Flush periodico su DB di quanto e' contenuto nella cache e 
   * la lettura periodica del capitale disponibile da REDIS
   */
  async function initCapitalManager() {
    
    let rowsData = {};
    let tentativiScritturaFalliti=0;
    await AlpacaApi.init(); 
    
    // 1. Recupera i dati da MySQL
    logger.trace(`[initCapitalManager] Richiamo in GET  ${dbManagerUrl}/strategies/capital`);
    const res = await axios.get(`${dbManagerUrl}/strategies/capital`);
    const rows = res.data;
    logger.trace(`[initCapitalManager] Recuperato dati da DB = ${JSON.stringify([rows])}}`);

    // 2. Recupera il capitale disponibile da Alpaca e salva su REDIS
    let alpacaCache = await AlpacaApi.getAvailableCapital();
    await cache.setp(`strategy:capital:availableCache`, alpacaCache);
    logger.trace(`[initCapitalManager] Recuperato capitale disponibile da Alpaca = ${alpacaCache}`);


    // 3. Inizializza la struttura in Redis
      for (const row of rows) {
        rowsData[row.id] = {
            share: row.share,
            CapitaleInvestito: row.CapitaleInvestito || 0,
            OpenOrders: row.OpenOrders || 0,
            totaleStrategia:  0,
            rimanente : 0
        };
      }
 
      const alloc = await calcolaAlloc(rowsData, alpacaCache);

      if(!alloc.success)
        return ({ approved : false, reason : alloc.Error });

      logger.trace(`[initCapitalManager] Calcolo Alloc eseguito nuovo struttura = ${JSON.stringify(alloc)}`);

      await cache.setp('strategy:capital', rowsData);


    // 4. Lettura periodica di cache da Alpaca
    setInterval(async () => {
      if (!isReadNeeded()) return;

      alpacaCache = await AlpacaApi.getAvailableCapital();
      await cache.setp(`strategy:capital:availableCache`, alpacaCache);
      const data = await cache.get('strategy:capital');
      calcolaAlloc(data, alpacaCache);

      setReadNeeded(false);
    }, 10000);

    // 5. Flush periodico verso DB
    setInterval(async () => {
      const capitalData = await cache.get('strategy:capital');
      if (!capitalData || !isFlushNeeded()) return;

      try {
        const res = await axios.put(`${dbManagerUrl}/strategies/capital`,capitalData);
        logger.trace(`[initCapitalManager] FlushDB effettuato ${JSON.stringify(res.data)}`);
        setFlushNeeded(false);
        tentativiScritturaFalliti=0;
      } catch (error) {
        tentativiScritturaFalliti++;
        logger.warning(`[initCapitalManager] Tentativo ${tentativiScritturaFalliti} di Flush della cache in DB : ${error.message} usr PUT ${dbManagerUrl}/strategies/capital body: ${JSON.stringify(capitalData)}`);
      }
    }, 10000);
    
    return ({success:true, rowsData : rowsData})
  }


module.exports = {
  safe,
  initCapitalManager,
  reserveCapitalForStrategy,
  getCapital,
  setStrategyCapitalInsertOrder,
  setStrategyCapitalAcceptedOrder,
  getLogLevel,
  setLogLevel,
  freeupCapital,
  calcolaAlloc
};
