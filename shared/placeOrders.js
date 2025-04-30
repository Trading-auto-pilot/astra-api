const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function placeOrder(symbol, notional, side, type = 'limit', time_in_force = 'gtc', limit_price = null, stop_price = null) {

    //console.log('Place Orders APCA_API_KEY_ID'+APCA_API_KEY_ID);
    try {
        const body = {
        symbol,
        notional,       // Money to invest
        side,          // 'buy' or 'sell'
        type,          // 'market', 'limit', 'stop', 'stop_limit'
        time_in_force, // 'day', 'gtc', 'opg', etc.
        };

        if (limit_price) {
        body.limit_price = limit_price;
        }
        if (stop_price) {
        body.stop_price = stop_price;
        }

        const response = await axios.post(
        'https://paper-api.alpaca.markets/v2/orders', // if using PAPER account
        body,
        {
            headers: {
            'APCA-API-KEY-ID': 'PKNS94MR3ZI0U7AFMEBS', //process.env.APCA_API_KEY_ID,
            'APCA-API-SECRET-KEY': 'Sm2wcfjDQZo0aNGoofSWFSDESWgdVhPD6QczFx0R',// process.env.APCA_API_SECRET_KEY,
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
