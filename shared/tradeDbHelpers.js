// shared/tradeDbHelpers.js

const axios = require('axios');
const createLogger = require('./logger');

const MICROSERVICE = 'Shared';
const MODULE_NAME = 'tradeDBHelper';
const MODULE_VERSION = '2.0';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

//this.dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';

const tradeDbHelpers = (dbManagerUrl) => ({

  /**
   * Inserisce una nuova posizione a seguito di un ordine BUY
   */
    async  buildPositionFromOrder(order, strategy , context, bar) {

        const body = {
            strategy_id : strategy.id,
            asset_id: order.asset_id || null,
            symbol: order.symbol,
            asset_class: order.asset_class || null,
            side: order.side,
            qty: parseFloat(order.filled_qty || 0),
            filled_avg_price: parseFloat(order.filled_avg_price || 0),
            avg_entry_price: parseFloat(order.filled_avg_price || 0),
            market_value: parseFloat(order.filled_qty || 0) * parseFloat(order.filled_avg_price || 0),
            cost_basis: parseFloat(order.filled_qty || 0) * parseFloat(order.filled_avg_price || 0),
            unrealized_pl: 0,
            unrealized_plpc: 0,
            current_price: parseFloat(order.filled_avg_price || 0),
            lastday_price: parseFloat(order.filled_avg_price || 0),
            change_today: 0,
            order_id: order.id || null,
            client_order_id: order.client_order_id || null,
            created_at: order.created_at ? new Date(order.created_at) : new Date(),
            filled_at: order.filled_at ? new Date(order.filled_at) : new Date(),
            note: context.note || null,
            realized_pl: null,
            cumulative_equity: context.cumulative_equity || null,
            equity_after_trade: context.equity_after_trade || null,
            pnl_snapshot: context.pnl_snapshot ? JSON.stringify(context.pnl_snapshot) : null
        };

        logger.trace(`[buildPositionFromOrder] inserimento in ${dbManagerUrl}/positions con body | ${JSON.stringify(body)}`);
        try {
            const res = await axios.post(`${dbManagerUrl}/positions/`, body);
            return res.data;
        } catch (error) {
            logger.error(`[buildPositionFromOrder] Errore inserimento Posizione ordine strategy_id ${strategy.id} error : ${error.message} | ${JSON.stringify(order)} `);
            throw new Error(`Parametri richiesti: symbol, periodDays, currentDate, tf ${error.message}`);
        }
    },


    // shared/positionBuilder.js
    async buildPositionFromClose(data, strategy , context, bar) {

        const body = {
            strategy_id: strategy.id || null,
            asset_id: data.asset_id || null,
            symbol: data.symbol,
            asset_class: data.asset_class || null,
            side: data.side || null,
            qty: parseFloat(data.qty) || 0,
            filled_avg_price: parseFloat(data.avg_entry_price) || 0,
            avg_entry_price: parseFloat(data.avg_entry_price) || 0,
            market_value: parseFloat(data.market_value) || 0,
            cost_basis: parseFloat(data.cost_basis) || 0,
            unrealized_pl: parseFloat(data.unrealized_pl) || 0,
            unrealized_plpc: parseFloat(data.unrealized_plpc) || 0,
            current_price: parseFloat(data.current_price) || 0,
            lastday_price: parseFloat(data.lastday_price) || 0,
            change_today: parseFloat(data.change_today) || 0,
            order_id: null,
            client_order_id: null,
            created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
            filled_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
            note : context.note,
            realized_pl: null,
            cumulative_equity: context.cumulative_equity || null,
            equity_after_trade: context.equity_after_trade || null,
            pnl_snapshot: context.pnl_snapshot ? JSON.stringify(context.pnl_snapshot) : null
        };

        try {
            logger.trace(`[buildPositionFromClose] inserimento in POST ${dbManagerUrl}/positions con body | ${JSON.stringify(body)}`);
            const res = await axios.post(`${dbManagerUrl}/positions`, body);
            return res.data
        } catch (error) {
            logger.error(`[buildPositionFromClose] Errore inserimento strategy_id ${strategy.id} Posizione ordine | ${JSON.stringify(body)} `);
            throw new Error(`Parametri richiesti: symbol, periodDays, currentDate, tf`);
        }

    },

    async updateStrategies(order, strategy, additionalData = {}) {
        if (!order || !order.id) {
            throw new Error('Ordine non valido. Campo id mancante.');
        }

        try {
            logger.trace(`[updateStrategies] inserimento in ${dbManagerUrl}/strategies/${strategy.id} con  | ${JSON.stringify(order)}`);
            const res = await axios.put(`${dbManagerUrl}/strategies/${strategy.id}`, order);
            return res.data;
        } catch (error) {
            logger.error(`[updateStrategies] Errore inserimento strategy_id ${strategy.id} Posizione ordine | ${JSON.stringify(order)} `);
            throw new Error(`Parametri richiesti: symbol, periodDays, currentDate, tf`);
        }
    },

    async insertOrder(orderRes){

        logger.trace(`[insertOrder] calling endpoint POST ${dbManagerUrl}/orders with payload | ${JSON.stringify(orderRes)}`);
        try {
            const res = await axios.post(`${dbManagerUrl}/orders`, orderRes);
            return res.data;
        } catch (err) {
            logger.error(`[insertOrder] ${err.message}`);
            return { success: false, error: err.message };
        }
    },

    async  insertBuyTransaction(orderRes, strategy) {
        const price = orderRes.filled_avg_price || orderRes.limit_price || orderRes.price;
        const payload = {
            ScenarioID: strategy.id,
            operationDate: orderRes.filled_at || orderRes.created_at,
            operation: 'BUY ORDER',
            Price: price,
            capitale: Number(price) * Number(orderRes.qty),
            profitLoss: null,
            exit_reason: null,
            days: null,
            MA: strategy.params.MA,
            orderId: orderRes.id,
            NumAzioni: orderRes.qty,
            PLAzione: 0,
            PLOperazione: 0,
            PLPerc: 0.00,
            idOperazione: null,
            PLOperazionePerc: 0.00
        };

        logger.trace(`[insertBuyTransaction] calling endpoint POST ${dbManagerUrl}/transactions/buy with payload | ${JSON.stringify(payload)}`);
        try {
            const res = await axios.post(`${dbManagerUrl}/transactions/buy`, payload);
            return res.data;
        } catch (err) {
            logger.error(`[insertBuyTransaction] ${err.message}`);
            return { success: false, error: err.message };
        }
    }

});

module.exports = tradeDbHelpers;
