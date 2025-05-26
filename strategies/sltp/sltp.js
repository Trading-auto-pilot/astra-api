/* Semplice classe che da segnale vendita se prezzo mercato sotto SL o sopra TP
*/
const axios = require('axios');
const createLogger = require('../../shared/logger');
const MODULE_NAME = 'SLTP';
const MODULE_VERSION = '1.0';

const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL || 'info');


class SLTP {

    constructor() {
        this.dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
        this.positions=[];
        this.settings = {};
    }

    getInfo() {
        return {
        module: MODULE_NAME,
        version: MODULE_VERSION,
        positions: this.positions
        };
    }

    async loadSettings() {
        logger.info(`[loadSetting] Lettura setting da repository...`);
        const keys = [
        'ALPACA-API-TIMEOUT',
        'ALPACA-PAPER-BASE',
        'ALPACA-LOCAL-BASE',
        'ALPACA-LIVE-BASE'
        ];

        for (const key of keys) {
            const res = await axios.get(`${this.dbManagerUrl}/getSetting/${key}`);
            this.settings[key] = res.data.value;
            logger.trace(`[loadSetting] Setting variavile ${key} : ${this.settings[key]}`);
        }
        logger.info(`[loadSetting] Lettura setting da repository...`);
    }

  // 🔁 Registra il bot nel DB se non esiste, altrimenti aggiorna la data
    async registerBot() {
        try {
        await axios.post(`${this.dbManagerUrl}/bot/registra`, {
            name: MODULE_NAME,
            ver: MODULE_VERSION
        });
        logger.info(`[registerBot] Bot registrato`);
        } catch (err) {
            logger.error(`[registerBot][registerBot] Errore: ${err.message}`);
        }
    }

    async loadActiveOrders (){
        this.alpacaAPIServer = this.settings[`ALPACA-`+process.env.ENV_ORDERS+`-BASE`]+'/v2/positions';
        logger.trace(`[loadActiveOrders] variabile alpacaAPIServer ${this.alpacaAPIServer}`);
        try {
            const res = await axios.get(`${this.alpacaAPIServer}`, {
                headers: {
                    'APCA-API-KEY-ID': process.env.APCA_API_KEY_ID, 
                    'APCA-API-SECRET-KEY': process.env.APCA_API_SECRET_KEY,
                    'Content-Type': 'application/json'
                }
            });
            this.positions = res.data;
        } catch (error) {
            logger.error(`[loadActiveOrders] Errore recupero posizioni aperte da Alpaca ${error.message}`);
            return null;
        }
    }


    async init(){
        logger.info(`[init] Inizializzazione...`);

        // Load dei settings da DB
        await this.loadSettings();

        // Qui carico tutte le posizioni aperte da Alpaca
         // Ma devo considerare di rileggerle ogni volta che un ordine viene accettato.
        this.loadActiveOrders();



        // Log delle variabili definite nell'istanza
        for (const key of Object.keys(this)) {
            // Esclude i metodi (funzioni)
            if (typeof this[key] !== 'function') {
            logger.trace(`[init] Variabile ${key} =`, this[key]);
            }
        }

        for (const [key, value] of Object.entries(process.env)) {
        logger.trace(`Environment variable ${key}=${value}`);
        }

        this.registerBot();
    }

    async processCandle(bar, StrategyParams){
        // Confronto la candela arrivata
        // Filtro tra le varie posizioni aperte 

        const position = this.positions.find(p => p.symbol === bar.s);
        logger.trace(`[processCandle] positions: ${JSON.stringify(this.positions)}  position:${JSON.stringify(position)} bar:${JSON.stringify(bar)}`)
        logger.trace(`[processCandle] unrealized_plpc: ${parseFloat(position.unrealized_plpc)}  TP:${parseFloat(StrategyParams.params.TP)}`)
        if(parseFloat(position.unrealized_plpc) >= parseFloat(StrategyParams.params.TP)){
            logger.log(`[processCandle] Triggerato TP Posizione ${position.unrealized_plpc}`)
            return ({
                        action: 'SELL',
                        trigger: 'TP',
                        PL: position.unrealized_plpc,
                        position: position
                    })
        }

        
        if(parseFloat(position.unrealized_plpc) < parseFloat(StrategyParams.params.SL)) {
            logger.log(`[processCandle] Triggerato SL Posizione ${position.unrealized_plpc}`)
            return ({
                        action: 'SELL',
                        trigger: 'SL',
                        PL: position.unrealized_plpc,
                        position: position
                    })
        }

        logger.log(`[processCandle] Posizione in HOLD ${position.unrealized_plpc}`)
            return ({
                        action: 'HOLD',
                        SL: StrategyParams.params.SL,
                        TP: StrategyParams.params.TP,
                        current: position.unrealized_plpc
                    })
    }
}
module.exports = SLTP;