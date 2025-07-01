// modules/tradeExecutor.js
const axios = require('axios');
const uuidv4 = require('uuid').v4;
const createLogger = require('../../shared/logger');
const tradeDbHelpersFactory = require('../../shared/tradeDbHelpers');
const { publishCommand } = require('../../shared/redisPublisher');

const marketSimulatorUrl = process.env.MARKETSIMULATOR_URL || 'http://localhost:3003'
const MICROSERVICE = 'LiveMarketListener';
const MODULE_NAME = 'tradeExecutor';
const DBMANAGER_URL = process.env.DBMANAGER_URL || 'http://localhost:3002'
const tradeDbHelpers = tradeDbHelpersFactory(DBMANAGER_URL);
const MODULE_VERSION = '2.0';

let logLevel =  process.env.LOG_LEVEL || 'info'
const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION,logLevel);

    let shared = {
        dbManagerUrl: '',
        alpacaAPIServer: '',
        capitalManagerUrl:'',
        AlpacaApi:''
    };

    function init(config) {
        shared = { ...shared, ...config };
        logger.trace(`[init] Init complete : ${JSON.stringify(shared)}`);
    }

    function getLogLevel(){
        return logLevel;
    }

    function setLogLevel(level) {
        logLevel=level;
        logger.setLevel(level);
    }

    async function SELL(strategy, bar) {
        try {
            const orderId = strategy.id + '-' + uuidv4();
            logger.trace(`[SELL] Ordine id ${orderId}`);
            const orderRes = await shared.AlpacaApi.placeOrder(
                    strategy.idSymbol,
                    strategy.numAzioniBuy,
                    'sell',
                    strategy.params.sell.type,
                    strategy.params.sell.time_in_force,
                    Math.ceil((parseFloat(strategy.params.sell.limit_price) + 1) * bar.c),
                    Math.ceil((parseFloat(strategy.params.sell.stop_price) + 1) * bar.c),
                    strategy.params.sell.trail_price,
                    strategy.params.sell.extended_hours,
                    orderId
            );
            await publishCommand({type:"orderRes", orderRes:orderRes},'orders:update' );
            return orderRes;
        } catch (error) {
            logger.error(`[SELL] Errore: ${error.message}`);
            return null;
        }
    }

    async function BUY(strategy, evalResult, bar) {
        try {
            const numShare = Math.floor(evalResult.grantedAmount / bar.c);
            logger.trace(`[BUY] grantedAmount : ${evalResult.grantedAmount} asset cost : ${bar.c} Num share to buy : ${numShare}`);
            const orderId = strategy.id + '-' + uuidv4();
            logger.trace(`[BUY] Ordine id ${orderId} symbol ${strategy.idSymbol}`);
            const orderRes = await shared.AlpacaApi.placeOrder(
                    strategy.idSymbol,
                    numShare,
                    'buy', 
                    strategy.params.buy.type,
                    strategy.params.buy.time_in_force,
                    Math.ceil((parseFloat(strategy.params.buy.limit_price) + 1) * bar.c),
                    strategy.params.buy.stop_price,
                    strategy.params.buy.trail_price,
                    strategy.params.buy.extended_hours,
                    orderId
            );
            await publishCommand({type:"orderRes", orderRes:orderRes},'orders:update' );
            return orderRes;
        } catch (error) {
            logger.error(`[BUY] Errore: ${error.message}`);
            return null;
        }
    }


    async function handleBuy(strategy, bar) {
        logger.info(`[handleBuy] BUY con candela ${JSON.stringify(bar)}`);
        logger.trace(`[handleBuy] Verifico se esiste un ordine appena immesso ${DBMANAGER_URL}/transactions/open/${strategy.id}`);  
        const order = await axios.get(`${DBMANAGER_URL}/transactions/open/${strategy.id}`);
        if(Number(order.open) === 1) {
            logger.trace(`[handleBuy] Ordine BUY OPEN esistente. Non inserisco altro ordine`);  
            return;
        }


        const evalResult = await richiestaCapitale(bar, strategy);
        if (!evalResult) return;

        const orderRes = await BUY(strategy, evalResult, bar);
        if (!orderRes) throw new Error('BUY failed');

        // Aggiorno Capitale utilizzato
        const url = `${shared.capitalManagerUrl}/capital/${strategy.id}`;
        const amount = parseFloat(orderRes.qty || 0) * parseFloat(orderRes.limit_price || 0); 
        const body = {requested : evalResult.grantedAmount, approved : amount};
        logger.trace(`[handleBuy] Richiesta capitale a POST: ${url} con body | ${JSON.stringify(body)}`);       
        
        await axios.post(url,body);

        // Devo richiamare funzione condivisa in shared
        const data = {id: strategy.id, OpenOrders : amount}
        // Aggiungo record a Strategy
        let rc = await tradeDbHelpers.updateStrategies(data, strategy);
        if (!rc) throw new Error('update Strategies fallita');
        // Aggiungo record in transaction insertBuyTransaction
        rc = await tradeDbHelpers.insertBuyTransaction(orderRes, strategy, {} )
        if (!rc) throw new Error('Insert New transaction fallita');

        // Aggiungo record in tabella Ordini
        rc = await tradeDbHelpers.insertOrder(orderRes)
        if (!rc) throw new Error('Insert New transaction fallita');

        // Aggiungo il capitale alloccato in strategies come OpenOrders
        // rc = await tradeDbHelpers.buildPositionFromOrder(orderRes, strategy, {} )
        // if (!rc) throw new Error('buildPositionFromOrder fallita');

        return orderRes;
    }

    async function handleSell(strategy, bar, orderActive) {
        logger.info(`[handleSell] SELL con candela ${JSON.stringify(bar)}`);
        const exists = orderActive.some(o =>
            o.symbol === bar.S &&
            Number(o.qty) === Number(strategy.numAzioniBuy) &&
            o.side === 'sell' &&
            o.status === 'new'
        );

        if (exists) {
            logger.warning(`[handleSell] Ordine SELL per sybol ${bar.S} e qty ${strategy.numAzioniBuy}  già esistente`);
            return;
        }

        logger.info(`[handleSell] Recupero informazioni strategy_runs : ${shared.dbManagerUrl}/strategies/runs/strategy/${strategy.posizioneMercato}`);
        strategy_runs = await axios.get(`${shared.dbManagerUrl}/strategies/runs/strategy/${strategy.posizioneMercato}`);
        strategy_runs = strategy_runs.data;


        const orderRes = strategy.params.sell.exitMode === 'order'
            ? await SELL(strategy, bar)
            : await shared.AlpacaApi.closePosition(strategy.idSymbol);

        if (!orderRes) throw new Error('SELL failed');

        const statoOrdine = Number(strategy_runs.numAzioniBuy) <= Number(strategy_runs.numAzioniSell) + Number(orderRes.qty) 
            ? "CHIUSO"
            : "APERTO";

        logger.log(`[handleSell] Chiusura posizione ${strategy.id} numAzioniBuy ${strategy_runs.numAzioniBuy} numAzioniSell ${strategy_runs.numAzioniSell} qty Order sold ${orderRes.qty} statoOrdine : ${statoOrdine}`);
        logger.log(`[handleSell] strategy_runs : ${JSON.stringify(strategy_runs)}`);
        // Verifico se ho chiuso tutto o parte.
        let data, CapitaleInvestito;
        if(strategy.params.sell.exitMode === 'order') {
            data = {
                id:strategy.id,
                //NumeroOperazioni:strategy.NumeroOperazioni +1,
                // AvgBuy: statoOrdine === "CHIUSO"  ? 0 : strategy.AvgBuy,
                // AvgSell: statoOrdine === "CHIUSO"  ? 0 : (Number(strategy.AvgSell) * Number(strategy.numAzioniSell) + Number(orderRes.market_value)) / (Number(strategy.numAzioniSell) + Number(orderRes.qty)),
                posizioneMercato: statoOrdine === "CHIUSO"  ? "OFF" :strategy.posizioneMercato,
            };
            CapitaleInvestito = statoOrdine === "CHIUSO" ? 0 : Number(strategy.CapitaleInvestito) - (parseFloat(orderRes.avg_entry_price) * parseFloat(orderRes.qty));

        } else {
            data = {
                id:strategy.id,
                //NumeroOperazioni:strategy.NumeroOperazioni +1,
                //NumeroOperazioniVincenti: orderRes.unrealized_pl > 0  ? Number(strategy.NumeroOperazioniVincenti) +1 : Number(strategy.NumeroOperazioniVincenti),
                // AvgBuy: statoOrdine === "CHIUSO"  ? 0 : strategy.AvgBuy,
                // AvgSell: statoOrdine === "CHIUSO"  ? 0 : (Number(strategy.AvgSell) * Number(strategy.numAzioniSell) + Number(orderRes.market_value)) / (Number(strategy.numAzioniSell) + Number(orderRes.qty)),
                posizioneMercato: statoOrdine === "CHIUSO"  ? "OFF" :strategy.posizioneMercato,
            };
            CapitaleInvestito= statoOrdine === "CHIUSO" ? 0 : Number(strategy.CapitaleInvestito) - (parseFloat(orderRes.market_value) * (1 + parseFloat(orderRes.unrealized_plpc)));
        }
        if(CapitaleInvestito < 0 ){
            logger.error(`[handleSell] ATTENZIONE!!! CapitaleInvestito negativo Capitale Investito precedente ${strategy.CapitaleInvestito} CapitaleInvestito : $CapitaleInvestito} orderRes : ${JSON.stringify(orderRes)}`);
            // Fermare la simulazione
            //await axios.post(`${marketSimulatorUrl}/stop`);
            //throw new Error(`[handleSell] ATTENZIONE!!! CapitaleInvestito negativo Capitale Investito precedente ${strategy.CapitaleInvestito} CapitaleInvestito : ${CapitaleInvestito} orderRes : ${JSON.stringify(orderRes)}`);
        }
        const url = `${shared.capitalManagerUrl}/capital/${strategy.id}`;
        logger.trace(`[handleSell] Chiusura posizione ${strategy.id} DELETE: ${url} con CapitaleInvestito ${CapitaleInvestito}`);
        await axios.delete(url, {
            params : {
                CapitaleInvestito : CapitaleInvestito
        }});
        logger.log(`[handleSell] Update strategies ${strategy.id} con CapitaleInvestito ${CapitaleInvestito}`);

        // rc = await tradeDbHelpers.updateStrategies(data, strategy, {} );            
        // if (!rc) throw new Error('Transazione updateStrategies fallita');

        // logger.trace(`[handleSell] Update strategy runs ${shared.dbManagerUrl}/strategies/runs/strategy/${strategy.posizioneMercato} | ${JSON.stringify(strategy_runs_update)}`);
        // rc = await axios.put(`${shared.dbManagerUrl}/strategies/runs/strategy/${strategy.posizioneMercato}`,strategy_runs_update);
        // if (!rc) throw new Error('Transazione strategy runs fallita');

        return orderRes;
    }

    async function richiestaCapitale(bar, strategy) {
        try {
            const url = `${shared.capitalManagerUrl}/capital/${strategy.id}`;
            logger.trace(`[richiestaCapitale] Richiesta capitale a GET: ${url}`);

            const { data: evalResult } = await axios.get(url,{
                params : {
                    closed : bar.c
                }
            });
            logger.trace(`[richiestaCapitale] Risposta: ${JSON.stringify(evalResult)}`);

            if (!evalResult || typeof evalResult.approved === 'undefined') {
                logger.warning(`[richiestaCapitale] Risposta non valida per ${strategy.id}`);
                return;
            }

            if (!evalResult.approved) {
                logger.info(`[richiestaCapitale] Allocazione rifiutata per ${strategy.idSymbol} (${strategy.id}) eval ${JSON.stringify(evalResult)}`);
                return;
            }

            if (evalResult.grantedAmount < bar.c) {
                logger.info(`[richiestaCapitale] Fondi insufficienti per ${strategy.idSymbol} (${strategy.id}): granted=${evalResult.grantedAmount}, prezzo=${bar.c}`);
                return;
            }

            return evalResult;

        } catch (error) {
            logger.error(`[richiestaCapitale] Errore per ${strategy.id}: ${error.message}`);
            return;
        }
    }



module.exports = {
  init,
  handleBuy,
  handleSell,
  getLogLevel,
  setLogLevel
};
