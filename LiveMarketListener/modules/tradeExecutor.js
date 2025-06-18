// modules/tradeExecutor.js
const axios = require('axios');
const uuidv4 = require('uuid').v4;
const createLogger = require('../../shared/logger');
const tradeDbHelpersFactory = require('../../shared/tradeDbHelpers');
const { publishCommand } = require('../../shared/redisPublisher');
const tradeDbHelpers = tradeDbHelpersFactory(process.env.DBMANAGER_URL || 'http://localhost:3002');

const MICROSERVICE = 'LiveMarketListener';
const MODULE_NAME = 'tradeExecutor';
const MODULE_VERSION = '2.0';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

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
            logger.trace(`[BUY] Ordine id ${orderId}`);
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


        const evalResult = await richiestaCapitale(bar, strategy);
        if (!evalResult) return;

        const orderRes = await BUY(strategy, evalResult, bar);
        if (!orderRes) throw new Error('BUY failed');

        // Devo richiamare funzione condivisa in shared
        const data = {id: strategy.id, OpenOrders : parseFloat(orderRes.qty || 0) * parseFloat(orderRes.limit_price || 0)}
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
            logger.warning(`[handleSell] Ordine SELL per sybol ${bar.S} e qty ${trategy.numAzioniBuy}  già esistente`);
            return;
        }

        logger.info(`[handleSell] Recupero informazioni strategy_runs : ${shared.dbManagerUrl}/strategies/runs/strategy/${strategy.posizioneMercato}`);
        strategy_runs = await axios.get(`${shared.dbManagerUrl}/strategies/runs/strategy/${strategy.posizioneMercato}`);


        const orderRes = strategy.params.sell.exitMode === 'order'
            ? await SELL(strategy, bar)
            : await shared.AlpacaApi.closePosition(strategy.idSymbol);

        if (!orderRes) throw new Error('SELL failed');

        const statoOrdine = Number(strategy_runs.numAzioniBuy) === Number(strategy_runs.numAzioniSell) + Number(orderRes.qty) 
            ? "CHIUSO"
            : "APERTO";

        // Verifico se ho chiuso tutto o parte.
        let data;
        if(strategy.params.sell.exitMode === 'order') {
            data = {
                id:strategy.id,
                CapitaleInvestito: statoOrdine === "CHIUSO" ? 0 : Number(strategy.CapitaleInvestito) - (parseFloat(orderRes.avg_entry_price) * parseFloat(orderRes.qty)),
                NumeroOperazioni:strategy.NumeroOperazioni +1,
                // AvgBuy: statoOrdine === "CHIUSO"  ? 0 : strategy.AvgBuy,
                // AvgSell: statoOrdine === "CHIUSO"  ? 0 : (Number(strategy.AvgSell) * Number(strategy.numAzioniSell) + Number(orderRes.market_value)) / (Number(strategy.numAzioniSell) + Number(orderRes.qty)),
                posizioneMercato: statoOrdine === "CHIUSO"  ? "OFF" :strategy.posizioneMercato,
            };


        } else {
            data = {
                id:strategy.id,

                CapitaleInvestito: statoOrdine === "CHIUSO" ? 0 : Number(strategy.CapitaleInvestito) - (parseFloat(orderRes.market_value) * (1 + parseFloat(orderRes.unrealized_pl))),
                NumeroOperazioni:strategy.NumeroOperazioni +1,
                NumeroOperazioniVincenti: orderRes.unrealized_pl > 0  ? Number(strategy.NumeroOperazioniVincenti) +1 : Number(strategy.NumeroOperazioniVincenti),
                // AvgBuy: statoOrdine === "CHIUSO"  ? 0 : strategy.AvgBuy,
                // AvgSell: statoOrdine === "CHIUSO"  ? 0 : (Number(strategy.AvgSell) * Number(strategy.numAzioniSell) + Number(orderRes.market_value)) / (Number(strategy.numAzioniSell) + Number(orderRes.qty)),
                posizioneMercato: statoOrdine === "CHIUSO"  ? "OFF" :strategy.posizioneMercato,
            };
        }
        logger.log(`[handleSell] Update strategies con data ${JSON.stringify(data)}`);

        rc = await tradeDbHelpers.updateStrategies(data, strategy, {} );            
        if (!rc) throw new Error('Transazione updateStrategies fallita');

        // logger.trace(`[handleSell] Update strategy runs ${shared.dbManagerUrl}/strategies/runs/strategy/${strategy.posizioneMercato} | ${JSON.stringify(strategy_runs_update)}`);
        // rc = await axios.put(`${shared.dbManagerUrl}/strategies/runs/strategy/${strategy.posizioneMercato}`,strategy_runs_update);
        // if (!rc) throw new Error('Transazione strategy runs fallita');

        return orderRes;
    }

    async function richiestaCapitale(bar, strategy) {
        try {
            const url = `${shared.capitalManagerUrl}/evaluate/${strategy.id}`;
            logger.trace(`[richiestaCapitale] Richiesta capitale a: ${url}`);

            const { data: evalResult } = await axios.get(url);
            logger.trace(`[richiestaCapitale] Risposta: ${JSON.stringify(evalResult)}`);

            if (!evalResult || typeof evalResult.approved === 'undefined') {
                logger.warning(`[richiestaCapitale] Risposta non valida per ${strategy.id}`);
                return;
            }

            if (!evalResult.approved) {
                logger.info(`[richiestaCapitale] Allocazione rifiutata per ${strategy.idSymbol} (${strategy.id})`);
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
  handleSell
};
