/* Semplice classe che da segnale vendita se prezzo mercato sotto SL o sopra TP
*/
const axios = require('axios');
const createLogger = require('../../shared/logger');
const Alpaca = require('../../shared/Alpaca');
const MICROSERVICE = 'STRATEGIES';
const MODULE_NAME = 'SLTP';
const MODULE_VERSION = '2.0';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');


class SLTP {

    constructor() {
        this.dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
        this.positions=[];
        this.settings = {};
        this.AlpacaApi = new Alpaca();
    }

    getInfo() {
        return {
          module: MODULE_NAME,
          version: MODULE_VERSION,
          positions: this.positions
        };
    }

    setPositions(newPositions) { this.positions = newPositions; }
    async getPositions() { this.positions = await this.AlpacaApi.loadActivePositions()}

    async loadSettings() {
        logger.info(`[loadSetting] Lettura setting da repository...`);
        const keys = [
            'ALPACA-API-TIMEOUT',
            'ALPACA-PAPER-BASE',
            'ALPACA-LOCAL-BASE',
            'ALPACA-LIVE-BASE',
            'ALPACA-DEV-BASE'
        ];

        for (const key of keys) {
            const res = await axios.get(`${this.dbManagerUrl}/settings/${key}`);
            this.settings[key] = res.data;
            logger.trace(`[loadSetting] Setting variavile ${key} : ${this.settings[key]}`);
        }
        logger.info(`[loadSetting] Lettura setting da repository...`);
    }

  // 🔁 Registra il bot nel DB se non esiste, altrimenti aggiorna la data
    async registerBot() {
        try {
        await axios.post(`${this.dbManagerUrl}/bots`, {
            name: MODULE_NAME,
            ver: MODULE_VERSION
        });
        logger.info(`[registerBot] Bot registrato`);
        } catch (err) {
            logger.error(`[registerBot][registerBot] Errore: ${err.message}`);
        } 
    }


    async init(){
        logger.info(`[init] Inizializzazione...`);

        await this.AlpacaApi.init();

        // Load dei settings da DB
        await this.loadSettings();

        // Qui carico tutte le posizioni aperte da Alpaca
         // Ma devo considerare di rileggerle ogni volta che un ordine viene accettato.
        //await this.loadActivePosition();
        this.positions = await this.AlpacaApi.loadActivePositions();

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

async processCandle(bar, StrategyParams) {
  let position;
  logger.trace(`[processCandle] bar: ${JSON.stringify(bar)}`); 

  try { 
    position = this.positions.find(p => p.symbol === bar.S);
  } catch (error) {
    this.positions = await this.AlpacaApi.loadActivePositions();
    logger.error(`[processCandle] Errore nel recupero della posizione. Richiamo loadActivePositions() posizioni ${JSON.stringify(this.positions)}`);
  }
  

  
  logger.trace(`[processCandle] posizione trovata: ${position ? position.symbol : 'Nessuna'}`);
  logger.trace(`[processCandle] posizione locale ${JSON.stringify(position)}`);
  

  if (!position) {
    logger.trace(`[processCandle] Nessuna posizione attiva per ${bar.S}, ritorno HOLD`);
    return {
      action: 'HOLD',
      reason: 'no_active_position',
      symbol: bar.S
    };
  }


  const plpc = (parseFloat(bar.c) / parseFloat(position.avg_entry_price))-1;
  const tp = parseFloat(StrategyParams.params.TP);
  const sl = parseFloat(StrategyParams.params.SL);

  logger.log(`[processCandle] unrealized_plpc: ${plpc} | TP: ${tp} | SL: ${sl} `);

  if (plpc >= tp) {
    logger.log(`[processCandle] 🟢 Triggerato TP per ${position.symbol}: ${plpc}`);
    return {
      action: 'SELL',
      trigger: 'TP',
      bot: MODULE_NAME,
      symbol:bar.S,
      PL: plpc,
      position
    };
  }

  if (plpc < sl) {
    logger.log(`[processCandle] 🔴 Triggerato SL per ${position.symbol}: ${plpc}`);
    return {
      action: 'SELL',
      trigger: 'SL',
      bot: MODULE_NAME,
      symbol:bar.S,
      PL: plpc,
      position
    };
  }

  logger.log(`[processCandle] 🟡 HOLD per ${position.symbol} | P&L: ${plpc} | TP: ${tp} | SL: ${sl}`);
  return {
    action: 'HOLD',
    SL: sl,
    TP: tp,
    current: plpc,
    bot: MODULE_NAME,
    symbol:bar.S,
    position
  };
}

}
module.exports = SLTP;