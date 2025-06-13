// modules/processCandles.js

const createLogger = require('../../shared/logger');
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const MICROSERVICE = 'LiveMarketListener';
const MODULE_NAME = 'processCandles';
const MODULE_VERSION = '2.0';
const isLocal = process.env.ENV_NAME === 'DEV';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

    class CandleProcessor {
        constructor(AlpacaUrl, dbManagerUrl, tradeExecutor, AlpacaApi, active) {
            this.AlpacaApi = AlpacaApi;
            this.AlpacaUrl = AlpacaUrl;
            this.dbManagerUrl = dbManagerUrl;
            this.positions = [];
            this.orders = [];
            this.strategies = [];
            this.bots = [];
            this.isLocalEnv = isLocal;
            this.tradeExecutor = tradeExecutor;
            this.active = active;
            this.lastEvaluationBuy = null;
            this.lastEvaluationSell = null;
            this.lastTimestampProcessed = null;
        }

    getActiveOrders() { return(this.orders)}
    getActiveStrategies(){return(this.strategies)}
    getActiveBots(){return(this.bots)}
    getActivePositions(){return(this.positions)}
    getOperationalEnvironment(){
        return {
            positions : this.positions,
            orders : this.orders,
            strategies : this.strategies,
            bots : this.bots,
            isLocalEnv : this.isLocalEnv,
            active : this.active,
            lastPrice : this.lastPrice,
            lastEvaluationBuy : this.lastEvaluationBuy,
            lastEvaluationSell : this.lastEvaluationSell,
            lastTimestampProcessed: this.lastTimestampProcessed
        }
    }

    async loadPositions() {
        this.positions = await this.AlpacaApi.loadActivePositions();
        logger.info(`[loadPositions] Caricate ${this.positions.length} posizioni attive`);
    }

    async loadOrderActive() {
        this.orders = await this.AlpacaApi.loadActiveOrders();
        logger.info(`[loadOrderActive] Caricati ${this.orders.length} ordini attivi`);
    }

    async loadActiveStrategies() {
        try {
        const res = await axios.get(`${this.dbManagerUrl}/strategies`);
        this.strategies = res.data || [];
        logger.info(`[loadActiveStrategies] Caricati ${this.strategies.length} strategie attive`);

        const symbolStrategyMap = {};
        for (const strategy of this.strategies) {
            const symbol = strategy.idSymbol;
            logger.trace(`[loadActiveStrategies] Recuperato symbol : ${symbol}`)
            if (!symbolStrategyMap[symbol]) {
                symbolStrategyMap[symbol] = [];
            }
            symbolStrategyMap[symbol].push(strategy);
        }
        return(symbolStrategyMap);

        } catch (err) {
            logger.error('[loadActiveStrategies] Errore nel caricamento strategie attive:', err.message);
        }
    }

    async loadActiveBots() {
        try {
        const res = await axios.get(`${this.dbManagerUrl}/bots`);
        this.bots = res.data || [];
        logger.info(`[loadActiveBots] Caricati ${this.bots.length} bots attivi`);
        } catch (err) {
        logger.error('[loadActiveBots] Errore nel caricamento ordini attivi:', err.message);
        }
    }

    /**
     * Aggiorna Drawdown_PeakMax, Drawdown_PeakMin e MaxDrawdown di una strategia
     * @param {Object} bar - Candela in formato { S, c, ... }
     */
    async updateDrawdownFromBar(bar) {
        let updated = false;        // Controllo se faccio almeno un aggiornamento
        // Trova la strategia corrispondente al simbolo della candela
        const strategy = this.strategies.find(s => s.idSymbol === bar.S);
        if (!strategy) {
            // Nessuna strategia trovata per il simbolo
            logger.warning(`[updateDrawdownFromBar] nessuna strategia trovata per il simbolo ${bar.S}`);
            return;
        }

        // Se è la prima candela, inizializza i valori
        if (strategy.Drawdown_PeakMax === undefined || strategy.Drawdown_PeakMax === null) {
            strategy.Drawdown_PeakMax = bar.c;
            strategy.Drawdown_PeakMin = bar.c;
            strategy.MaxDrawdown = 0;
            updated=true;
            logger.info(`[updateDrawdownFromBar] inizializzazione valori per il simbolo ${bar.S}. Drawdown_PeakMax : ${strategy.Drawdown_PeakMax} Drawdown_PeakMin: ${strategy.Drawdown_PeakMin} MaxDrawdown: ${strategy.MaxDrawdown}`);
        }

        // Se il valore di chiusura è superiore al PeakMax, aggiorna sia PeakMax che PeakMin
        if (bar.c > strategy.Drawdown_PeakMax) {
            strategy.Drawdown_PeakMax = bar.c;
            strategy.Drawdown_PeakMin = bar.c; // Reset, nuovo massimo
            updated=true;
            logger.trace(`[updateDrawdownFromBar] valore di chiusura è superiore al PeakMax, aggiorna sia PeakMax che PeakMin Drawdown_PeakMax = Drawdown_PeakMin = ${strategy.Drawdown_PeakMin}`);
        } 
        // Se il valore di chiusura è inferiore al PeakMin, aggiorna PeakMin
        else if (bar.c < strategy.Drawdown_PeakMin) {
            strategy.Drawdown_PeakMin = bar.c;
            updated=true;
            logger.trace(`[updateDrawdownFromBar] valore di chiusura è inferiore al PeakMin, aggiorna PeakMin: ${strategy.Drawdown_PeakMin}`);
        }

        // Calcola MaxDrawdown se abbiamo un nuovo minimo
        const drawdown =  Math.max(0, (strategy.Drawdown_PeakMax - strategy.Drawdown_PeakMin) / strategy.Drawdown_PeakMax);
        if (drawdown > (strategy.MaxDrawdown || 0)) {
            strategy.MaxDrawdown = drawdown;
            updated=true;
            logger.trace(`[updateDrawdownFromBar] Aggiornamento MaxDrawdown: ${strategy.MaxDrawdown}`);
        }

        if(updated) {
            try {
                await axios.put(`${dbManagerUrl}/strategies/runs/strategy/${strategy.posizioneMercato}`,{
                    "Drawdown_PeakMax": strategy.Drawdown_PeakMax,
                    "Drawdown_PeakMin": strategy.Drawdown_PeakMin,
                    "MaxDrawdown": strategy.MaxDrawdown
                });
                logger.trace(`[updateDrawdownFromBar] Aggiornato strategy_runs ${strategy.posizioneMercato}`);
            } catch (err) {
                logger.error(`[updateDrawdownFromBar] Errore nell'aggiornamento di strategy ${strategy.posizioneMercato} : ${err.message}`);
            }
        }
    }


    async processBar(bar) {
        this.lastPrice = bar.c;
        this.lastTimestampProcessed = bar.t;
        let sell_decision;

        this.updateDrawdownFromBar(bar);

        // Prendo decisioni esecutive solo con segnale attivo.
        if (!this.active) {
            logger.warning(`[processBar] Sistema in pausa. Ignorato segnale per ${bar.S}`);
            return;
        }
        logger.trace(`[processBar] Numero ordini attivi ${this.orders.length} | ${JSON.stringify(this.orders)}`);
        logger.trace(`[processBar] Numero posizioni attive ${this.positions.length} | ${JSON.stringify(this.positions)}`);
        const position = this.positions.find(p => p.symbol === bar.S);
        const order = this.orders.some(o => o.symbol === bar.S);
        const strategyParams = this.strategies.find(s => s.idSymbol === bar.S);
        if (!strategyParams) {
            logger.warning(`[processCandle] Strategia non trovata per symbol ${bar.S}, ricarico e riprovo alla prossima candela`);
            await this.loadActiveStrategies(); 
            return;
        }
        const hasOrders = order ? 1 : 0;
        const hasPositions = position ? 1 : 0;

        const state = `${hasOrders}${hasPositions}`; // "00", "01", "10", "11"

            // No ordini, no posizioni attive Valuto nuovo acquisto
        switch(state) {
            case "00": 
                logger.trace(`[processBar] Nessun ordine attivo e nessuna posizione attiva per ${bar.S} valuto acquaito`);
                try {
                    const decision = await this.evaluateBuySignal(bar, strategyParams);
                    logger.info(`[processBar] Strategia ${strategyParams.id} per ${bar.S} → ${decision.action}`);
                    this.lastEvaluationBuy = decision;
                    if(decision.action === 'BUY')
                        await this.tradeExecutor.handleBuy(strategyParams, bar);
                } catch (err) {
                    logger.error(`[processBar] Errore in BUY per strategia per ${bar.S}:`, err.message);
                }
                break;

                // No ordini, posizioni attive. Valuto prima la vendita delle posizioni attive e se in HOLD valuto Acquisto
            case "01": 
                
                try {   // Valuto prima la vendita
                    logger.trace(`[processBar] Esistono posizioni attive per ${bar.S} Non ci sono ordini attivi. valuto la vendita`);
                    sell_decision = await this.evaluateSellSignal(bar, strategyParams);
                    this.lastEvaluationSell = sell_decision;
                    logger.info(`[processBar] Strategia ${strategyParams.id} per ${bar.S} → ${sell_decision.action}`);
                    if(sell_decision.action === 'SELL'){
                        await this.tradeExecutor.handleSell(strategyParams, bar, this.orders);
                        break;
                    }
                } catch (error) {
                    logger.error(`[processBar] Errore in SELL per strategia per ${bar.S}:`, error.message);
                }

                // In caso di segnale HOLD in vendita, valuto un ascquisto 
                if (sell_decision && sell_decision.action && sell_decision.action === 'HOLD') {
                    try {
                        const decision = await this.evaluateBuySignal(bar, strategyParams);
                        logger.info(`[processBar] Strategia ${strategyParams.id} per ${bar.S} → ${decision.action}`);
                        this.lastEvaluationBuy = decision;
                        if(decision.action === 'BUY')
                            await this.tradeExecutor.handleBuy(strategyParams, bar);
                    } catch (err) {
                        logger.error(`[processBar] Errore in BUY per strategia per ${bar.S}:`, err.message);
                    }
                }
                break;

                // Ordini attivi, no posizioni. Ignoro la candela. Non voglio aprire altri ordini se ce ne sono gia in corso
            case "10": 
                // Non fare nulla
                logger.log(`[processBar] Ignorata candela ${bar.S} per ordine attivo , nessuna posizione attiva`);
                break;

                // Ordini e posizioni attive. Valuto la sola vendita.
            case "11": 
                try {   // Valuto prima la vendita
                    logger.trace(`[processBar] Esistono sia posizioni attive che ordini attivi per ${bar.S} valuto solo la vendita`);
                    sell_decision = await this.evaluateSellSignal(bar, strategyParams);
                    this.lastEvaluationSell = sell_decision;
                    logger.info(`[processBar] Strategia ${strategyParams.id} per ${bar.S} → ${sell_decision.action}`);
                    if(sell_decision.action === 'SELL'){
                        await this.tradeExecutor.handleSell(strategyParams, bar, this.orders);
                        break;
                    }
                } catch (error) {
                    logger.error(`[processBar] Errore in SELL per strategia per ${bar.S}:`, error.message);
                }
                break;
            default:
                throw new Error("Stato non riconosciuto");
        }
    }


    async evaluateBuySignal(bar, strategy) {
        try {
            const bot = this.bots.find(b => b.name === strategy.idBotIn);
            if (!bot || !bot.url) {
                logger.error(`[evaluateBuySignal] Bot ${strategy.idBotIn} non trovato per strategy ID ${strategy.id}`);
                return null;
            }

            let botUrl = bot.url;
            if (this.isLocalEnv && botUrl) {
                const urlObj = new URL(botUrl);
                urlObj.hostname = 'localhost';
                botUrl = urlObj.toString();
            }

            const fullUrl = new URL('/processCandle', botUrl).toString();
            logger.info(`[evaluateBuySignal] Chiamo bot ${strategy.idBotIn} su URL: ${fullUrl} con body ${JSON.stringify({bar, strategy })}`);

            const response = await axios.post(fullUrl, { candle:bar, strategyParams:strategy });
            logger.info(`[evaluateBuySignal] Risposta da bot ${strategy.idBotIn}: ${JSON.stringify(response.data)}`);
            return response.data;

        } catch (err) {
            logger.error(`[evaluateBuySignal] Errore nella chiamata al bot ${strategy.idBotIn}: ${err.message}`);
            return null;
        }
    }

    async evaluateSellSignal(bar, strategy) {
        try {
            const bot = this.bots.find(b => b.name === strategy.idBotOut);
            if (!bot || !bot.url) {
                logger.error(`[evaluateSellSignal] Bot ${strategy.idBotOut} non trovato per strategy ID ${strategy.id}`);
                return null;
            }

            let botUrl = bot.url;
            if (this.isLocalEnv && botUrl) {
                const urlObj = new URL(botUrl);
                urlObj.hostname = 'localhost';
                botUrl = urlObj.toString();
            }
            const fullUrl = new URL('/processCandle', botUrl).toString();
            const body = { candle:bar, strategyParams:strategy };

            logger.trace(`[evaluateSellSignal] Chiamo bot ${strategy.idBotOut} su URL: ${fullUrl} con body ${JSON.stringify(body)}`);

            const response = await axios.post(fullUrl,body );
            logger.info(`[evaluateSellSignal] Risposta da bot ${strategy.idBotOut}: ${JSON.stringify(response.data)}`);
            return response.data;

        } catch (err) {
            logger.error(`[evaluateSellSignal] Errore nella chiamata al bot ${strategy.idBotOut}: ${err.message}`);
            logger.warning(`[evaluateSellSignal] Chiamato bot ${strategy.idBotOut} su URL: ${fullUrl} con body ${JSON.stringify(body)}`);
            return null;
        }
    }


}

module.exports = CandleProcessor;
