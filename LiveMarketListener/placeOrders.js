const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function placeOrder(url, apiKey, apiSecret, symbol, qty, side, type = 'limit', time_in_force = 'gtc', limit_price = null, stop_price = null) {

    //console.log('Place Orders APCA_API_KEY_ID'+APCA_API_KEY_ID);
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
        order_class,
            // Array or object to send other orders linked to the main one
        legs,
            // Additional parameters for take-profit leg of advanced orders
        take_profit,
            // Additional parameters for stop-loss leg of advanced orders
        stop_loss
        };

        if (limit_price) {
            body.limit_price = limit_price;
        }
        if (stop_price) {
            body.stop_price = stop_price;
        }

        const response = await axios.post(
        url,
        body,
        {
            headers: {
            'APCA-API-KEY-ID': apiKey, 
            'APCA-API-SECRET-KEY': apiSecret,
            'Content-Type': 'application/json'
            }
        }
        );

        console.log(`[ORDER] Success: Order placed`, response.data);
        return response.data;

    } catch (error) {
        console.error('[ORDER] Failed to place order:', error.response ? error.response.data : error.message);
        throw error;
    }
}

module.exports = { placeOrder };
