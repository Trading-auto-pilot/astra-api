const axios = require('axios');
const redis = require('redis');
const { promisify } = require('util');
const { initializeSettings, getSetting } = require('./loadSettings');
const createLogger = require('./logger');
const { publishCommand } = require('./redisPublisher');

dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';


const MICROSERVICE = 'Shared';
const MODULE_NAME = 'Alpaca';
const MODULE_VERSION = '1.0';
const REDIS_POSITIONS_KEY = 'alpaca:positions';
const REDIS_ORDERS_KEY = 'alpaca:orders';



const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');
let instance = null;

class AlpacaApi {

    constructor(){
        if (instance) return instance;
        this.initialized = false;
        instance = this;
        this.redisClient = redis.createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
        this.REDIS_CACHE_TTL = 300;
        this.orders = [];
        this.positions = [];
    }

    async init()
    {
        if (this.initialized) return;
        logger.info(`[init] Inizializzazione...`);

        await initializeSettings(dbManagerUrl);
        this.REDIS_CACHE_TTL = getSetting('REDIS_CACHE_TTL') || 300;               // secondi
        this.AlpacaUrl = getSetting(`ALPACA-`+process.env.ENV_ORDERS+`-BASE`);
        logger.log(" >> this.AlpacaUrl :"+ this.AlpacaUrl);
        await this.redisClient.connect();
        this.initialized = true;
    }

    hasActiveOrder(symbol = null) {
        if (!this.initialized) throw new Error('Alpaca non inizializzato');
        if (!Array.isArray(this.orders) || this.orders.length === 0) return false;
        if (!symbol) return this.orders.length > 0;
        return this.orders.some(order => order.symbol === symbol);
    }

    hasActivePosition(symbol = null) {
        if (!this.initialized) throw new Error('Alpaca non inizializzato');
        if (!Array.isArray(this.positions) || this.positions.length === 0) return false;
        if (!symbol) return this.positions.length > 0;
        return this.positions.some(pos => pos.symbol === symbol);
    }

    async refreshCacheActiveOrders() {
        if (!this.initialized) throw new Error('Alpaca non inizializzato');
        logger.log(`[refreshCache] Forzo aggiornamento ordini da Alpaca`);
        this.redisClient.del(REDIS_ORDERS_KEY);
        await this.loadActiveOrders();
        await publishCommand({type:"orders",orders:this.orders},REDIS_ORDERS_KEY);
        return this.orders;
    }

    async refreshCacheActivePositions() {
        if (!this.initialized) throw new Error('Alpaca non inizializzato');
        logger.log(`[refreshCache] Forzo aggiornamento posizioni da Alpaca`);
        this.redisClient.del(REDIS_POSITIONS_KEY);
        await publishCommand({type:"positions",positions:this.positions},REDIS_POSITIONS_KEY);
        return await this.loadActivePositions();
    }

    getOrderCount() {
        if (!this.initialized) throw new Error('Alpaca non inizializzato');
        return Array.isArray(this.orders) ? this.orders.length : 0;
    }

    getPositionCount() {
        return Array.isArray(this.positions) ? this.positions.length : 0;
    }

    async close() {
        if (!this.initialized) throw new Error('Alpaca non inizializzato');
        await this.redisClient.quit();
        logger.log(`[close] Connessione Redis chiusa`);
    }

    async closePosition(symbol){
        if (!this.initialized) throw new Error('Alpaca non inizializzato');
        // Chiusura di tutte le posizioni di symbol
        let orderRes;
        try {
        logger.trace(`[closePosition] Chiusura di tutte le posizioni ${symbol} : DELETE ${this.AlpacaUrl}/v2/positions/${symbol}`);
        orderRes = await axios.delete(`${this.AlpacaUrl}/v2/positions/${symbol}`);
        await this.refreshCacheActivePositions();
        return orderRes.data;
        } catch (error) {
            logger.error(`[closePosition] Errore durante la chiusura della posizione ${error.message} ${this.AlpacaUrl}/v2/positions`);
            return null;
        }
    }

    async loadActiveOrders({ symbol = null, order_id = null, side = null } = {}) {
        if (!this.initialized) throw new Error('Alpaca non inizializzato');
        const alpacaAPIServer = this.AlpacaUrl + '/v2/orders?status=open';
        logger.log(`[loadActiveOrders] variabile alpacaAPIServer ${alpacaAPIServer} con symbol ${symbol} e order_id ${order_id}`);

        try {
            const cached = await this.redisClient.get(REDIS_ORDERS_KEY);
            if (cached) {
                this.orders = JSON.parse(cached);
                logger.log(`[loadActiveOrders] ${this.orders.length} ordini letti da cache Redis`);
            } else {
                const res = await axios.get(alpacaAPIServer, {
                    headers: {
                        'APCA-API-KEY-ID': process.env.APCA_API_KEY_ID,
                        'APCA-API-SECRET-KEY': process.env.APCA_API_SECRET_KEY,
                        'Content-Type': 'application/json'
                    }
                });
                this.orders = res.data;
                await this.redisClient.setEx(REDIS_ORDERS_KEY, this.REDIS_CACHE_TTL, JSON.stringify(this.orders));
                logger.log(`[loadActiveOrders] ${this.orders.length} Nuovi ordini caricati da Alpaca | ${JSON.stringify(this.orders)}`);
            }

            if (order_id) {
                return this.orders.find(o => o.id === order_id) || null;
            }

            if (symbol) {
                return this.orders.filter(o => o.symbol === symbol);
            }

            if (side) {
                return this.orders.filter(o => o.side === side);
            }

            return this.orders;

        } catch (error) {
            logger.error(`[loadActiveOrders] Errore recupero ordini da Alpaca ${error.message}`);
            return null;
        }
    }



    async loadActivePositions(symbol = null) {
        if (!this.initialized) throw new Error('Alpaca non inizializzato');
        const alpacaAPIServer = this.AlpacaUrl + '/v2/positions';
        logger.log(`[loadActivePosition] variabile alpacaAPIServer ${alpacaAPIServer} con symbol ${symbol}`);

        try {
            const cached = await this.redisClient.get(REDIS_POSITIONS_KEY);
            if (cached) {
                this.positions = JSON.parse(cached);
                logger.log(`[loadActivePositions] ${this.positions.length} Posizioni lette da cache Redis`);
            } else {
                const res = await axios.get(alpacaAPIServer, {
                    headers: {
                        'APCA-API-KEY-ID': process.env.APCA_API_KEY_ID,
                        'APCA-API-SECRET-KEY': process.env.APCA_API_SECRET_KEY,
                        'Content-Type': 'application/json'
                    }
                });
                this.positions = res.data;
                await this.redisClient.setEx(
                    REDIS_POSITIONS_KEY,
                    this.REDIS_CACHE_TTL,
                    JSON.stringify(this.positions)
                );
                logger.log(`[loadActivePositions] ${this.positions.length} Nuove posizioni caricate da Alpaca | ${JSON.stringify(this.positions)}`);
            }

            if (symbol) {
                return this.positions.find(p => p.symbol === symbol) || null;
            }

            return this.positions;

        } catch (error) {
            logger.error(`[loadActivePositions] Errore recupero posizioni aperte da Alpaca ${error.message}`);
            return null;
        }
    }

    async placeOrder(symbol, qty, side, type = 'limit', time_in_force = 'gtc', limit_price = null, stop_price = null,trail_price = null, extended_hours = false, client_order_id, /*order_class, take_profit, stop_loss*/) {
        if (!this.initialized) throw new Error('Alpaca non inizializzato');
        const alpacaAPIServer = this.AlpacaUrl + '/v2/orders';
        try {
            const body = {
                //symbol, asset ID, or currency pair to identify the asset to trade, 
                // required for all order classes except for er. AAPL
            symbol,       
                // number of shares to trade. Can be fractionable for only market and day order types. 
                // Required for mleg order class, represents the number of units to trade of this strategy.      
            qty,            
                // BUY | SELL
            side,          
                // market       :   Immidiatly executed at the best market price. Number of security garanteed, price not garanteed
                // limit        :   Buy or Sell at a specific price or better Price garanteed, number of security not garanteed
                // stop         :   Order to buy or sell a stock once the price of the stock reaches the specified price then the 
                //                  then the Buy or Sell will be made at the price market.
                // stop_limit   :   Combile Stop with limit order.buy or sell a stock once the price of the stock reaches the 
                //                  specified price then the a limit will be set
                // trailing_stop:   Follow the stock price, goes up if the stock price goes up.
            type,          
                // day          :   A day order is eligible for execution only on the day it is live. By default, 
                //                  the order is only valid during Regular Trading Hours (9:30am - 4:00pm ET)  
                // gtc          :   The order is good until canceled. Non-marketable GTC limit orders are subject to price
                //                  adjustments to offset corporate actions affecting the issue 
                // opg          :   Use this TIF with a market/limit order type to submit “market on open” (MOO) and 
                //                  “limit on open” (LOO) orders. This order is eligible to execute only in the market opening auction
                // cls          :   Use this TIF with a market/limit order type to submit “market on close” (MOC) and “limit on close” 
                //                  (LOC) orders. This order is eligible to execute only in the market closing auction.
                // ioc          :   An Immediate Or Cancel (IOC) order requires all or part of the order to be executed immediately. 
                //                  Any unfilled portion of the order is canceled.
                // fok          :   A Fill or Kill (FOK) order is only executed if the entire order quantity can be filled, otherwise 
                //                  the order is canceled. 
            time_in_force, 
                // Required if type is limit or stop_limit. In case of mleg, the limit_price parameter is expressed with the following notation:
                //      A positive value indicates a debit, representing a cost or payment to be made.
                //      A negative value signifies a credit, reflecting an amount to be received.
            limit_price,
                // required if type is stop or stop_limit
            stop_price,
                // this or trail_price is required if type is trailing_stop
            trail_price,
                // (default) false. If true, order will be eligible to execute in premarket/afterhours. 
                // Only works with type limit and time_in_force day.
            extended_hours,
                // A unique identifier for the order. Automatically generated if not sent.
            client_order_id,
                // The order classes supported by Alpaca vary based on the order's security type.  Check on Alpaca
            //order_class,
                // Array or object to send other orders linked to the main one
            //legs,
                // Additional parameters for take-profit leg of advanced orders
            //take_profit,
                // Additional parameters for stop-loss leg of advanced orders
            //stop_loss
            };

            
            if (limit_price) {
                body.limit_price = limit_price;
            }
            if (stop_price) {
                body.stop_price = stop_price;
            }

            const response = await axios.post(
                alpacaAPIServer,
                body,
                {
                    headers: {
                        'APCA-API-KEY-ID': process.env.APCA_API_KEY_ID, 
                        'APCA-API-SECRET-KEY': process.env.APCA_API_SECRET_KEY,
                        'Content-Type': 'application/json'
                    }
                }
            );
            await this.refreshCacheActiveOrders();
            return response.data;

        } catch (error) {
            logger.error('[ORDER] Failed to place order:', error.message);
            throw error;
        }

    } 

    async getAvailableCapital() {
        if (!this.initialized) throw new Error('Alpaca non inizializzato');
        const alpacaAPIServer = this.AlpacaUrl + '/v2/account';
        logger.log(`[getAvailableCapital] Recupero capitale disponibile da Alpaca : ${alpacaAPIServer}`);
        
        try {
            const res = await axios.get(alpacaAPIServer, {
                headers: {
                'APCA-API-KEY-ID': process.env.APCA_API_KEY_ID,
                'APCA-API-SECRET-KEY': process.env.APCA_API_SECRET_KEY
                }
            });
            logger.log(`[getAvailableCapital] Recuperato capitale ${res.data.cash}`);
            return(parseFloat(res.data.cash));
        } catch (err) {
            logger.error(`[getAvailableCapital] Errore Alpaca:`, err.message);
        throw err;
        }
    }

}
module.exports = AlpacaApi;
