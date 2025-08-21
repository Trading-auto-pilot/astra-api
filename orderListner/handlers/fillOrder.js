const createLogger = require('../../shared/logger');
const { v4: uuidv4 } = require('uuid');
const MICROSERVICE = 'OrderListner';
const MODULE_NAME = 'fillOrders';
const MODULE_VERSION = '1.0';
const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');
 
class fiilOrders {
    constructor(caller, filledOrder, /*transazioni,*/ strategia, /*cache,*/ openOrders, strategy_runs, capitali) {
        this.caller = caller;
        //this.transazioni = transazioni;
        this.strategia = strategia;
        //this.cache=cache;
        this.filledOrder=filledOrder;
        //this.ordine = ordine;
        this.openOrders = openOrders;
        this.capitali = capitali;

        //this.transactionUpdate = transazioni;
        this.strategiaUpdate = strategia;
        this.strategyrunsUpdate = strategy_runs;
        this.newStrategyRuns = false;
    }

    isNewStrategyRuns() {return this.newStrategyRuns; }
    
    getNewStrategyRuns(){
        return this.strategyrunsUpdate;
    }

    // getTransazioni() {
    //     return this.transactionUpdate;
    // }

    getStrategia(){
        return this.strategiaUpdate;
    }

    updateKPIs (){

        logger.trace(`[updateKPIs] this.strategiaUpdate ${JSON.stringify(this.strategiaUpdate)}`);
        logger.trace(`[updateKPIs] this.filledOrder ${JSON.stringify(this.filledOrder)}`);
        logger.trace(`[updateKPIs] this.strategyrunsUpdate ${JSON.stringify(this.strategyrunsUpdate)}`);
        logger.trace(`[updateKPIs] this.openOrders : ${JSON.stringify(this.openOrders)}`);
        //logger.trace(`[updateKPIs] this.transactionUpdate : ${JSON.stringify(this.transactionUpdate)}`);
        logger.trace(`[updateKPIs] this.capitali : ${JSON.stringify(this.capitali)}`);

        // Caso Acquisto
        if(this.filledOrder.order.side == "buy"){
            this.strategyrunsUpdate['open_date'] = this.filledOrder.timestamp;
            // Aggiorno prezzo medio acquisto
            this.strategyrunsUpdate['AvgBuy'] = (parseFloat(this.strategyrunsUpdate.AvgBuy)*Number(this.strategyrunsUpdate.numAzioniBuy) +   parseFloat(this.filledOrder.order.filled_avg_price) * parseFloat(this.filledOrder.order.filled_qty)) / (Number(this.strategyrunsUpdate.numAzioniBuy)+ parseFloat(this.filledOrder.order.filled_qty));
            // Aggiorno numero azioni acquistate
            this.strategyrunsUpdate['numAzioniBuy'] = (this.strategyrunsUpdate['numAzioniBuy'] || 0) + Number(this.filledOrder.order.filled_qty);
            // Aggiorno Capitale Investito

            this.strategiaUpdate.CapitaleInvestito = Number(this.strategiaUpdate.CapitaleInvestito) + Number((parseFloat(this.filledOrder.order.filled_qty) * parseFloat(this.filledOrder.order.filled_avg_price)).toFixed(2));          // Aggiorno il capitale investito
            this.strategyrunsUpdate['CapitaleInvestito'] = Number(this.strategiaUpdate.CapitaleInvestito);
            //this.strategiaUpdate.CapitaleResiduo +=   Number((parseFloat(this.filledOrder.order.filled_qty) * parseFloat(this.filledOrder.order.filled_avg_price)).toFixed(2));            // Aggiorno capitale residuo
            
            //this.transactionUpdate['operation']='BUY'
            if(Number(this.openOrders) === 0 && this.caller === "fill")
                // Se e' l'unico ordine aperto e viene fatto fill completo mi aspetto che OpenOrder vada a zero o quasi. Porebbe
                // esserci una piccola differenza tra il prezzo dell'ordine e quello di acquisto che potrebbe far non azzerare OpenOrders
                this.strategiaUpdate.OpenOrders = 0;                     // OpenOrders viene decrementato Da verificare fill o partial fill
            else
                this.strategiaUpdate.OpenOrders -= parseFloat(this.filledOrder.order.filled_qty) * parseFloat(this.filledOrder.order.filled_avg_price);

            // Se la strategia era si OFF questo e' il primo ingresso in mercato. Genero un nuovo idOperazione e 
            // imposto posizioneMercato ON
            if(this.strategiaUpdate.posizioneMercato==="OFF"){

                const strategy_runs_id = uuidv4();
                //this.transactionUpdate.idOperazione = strategy_runs_id;
                this.strategiaUpdate.posizioneMercato=strategy_runs_id
                this.strategyrunsUpdate['strategy_runs_id']=strategy_runs_id;
                this.strategyrunsUpdate['strategy_id'] = this.strategiaUpdate.id;
                //logger.log(`[updateKPIs] Ciclo di vendita per strategia ${this.strategiaUpdate.id} iniziato con idOperazione ${this.transactionUpdate.idOperazione}`);
                this.newStrategyRuns = true;
            } else {
                this.newStrategyRuns = false;
            }

            // Caso Vendita
        } else {  
            
            logger.log(`[updateKPIs] Inizio calcolo KPIs per chiusura posizione`);
            this.strategyrunsUpdate['update_date'] = this.filledOrder.timestamp;
            // Aggiorno prezzo medio di vendita
            
            logger.trace(`[updateKPIs]  Calvolo AvgSell. AvgSell Pre ${this.strategyrunsUpdate['AvgSell']} numAzioniSell Pre ${this.strategyrunsUpdate['numAzioniSell']} filled_avg_price ${this.filledOrder.order.filled_avg_price} filled_qty ${this.filledOrder.order.filled_qty}`);
            this.strategyrunsUpdate['AvgSell'] = (parseFloat(this.strategyrunsUpdate['AvgSell'])*Number(this.strategyrunsUpdate['numAzioniSell']) +   parseFloat(this.filledOrder.order.filled_avg_price)* parseFloat(this.filledOrder.order.filled_qty)) / (Number(this.strategyrunsUpdate['numAzioniSell'])+ parseFloat(this.filledOrder.order.filled_qty));
            // Aggiorno numero azioni vendute
            this.strategyrunsUpdate['numAzioniSell'] +=  parseFloat(this.filledOrder.order.filled_qty);
            

            // Calcolo del Profit/Loss cumulativo sulla tabella strategies
            this.strategyrunsUpdate['CapitaleResiduo'] = this.capitali.totaleCapitale;
            this.strategyrunsUpdate['PLCapitale'] = Number(this.strategyrunsUpdate['PLCapitale']) + Number((parseFloat(this.strategyrunsUpdate['AvgSell']) - parseFloat(this.strategyrunsUpdate['AvgBuy'])) * parseFloat(this.filledOrder.order.filled_qty))              // Cumulato del Capitale guadagnato o perso
            this.strategyrunsUpdate['PLPerc'] = Number(this.strategyrunsUpdate['PLCapitale']) / Number(this.strategyrunsUpdate['CapitaleInvestito']); //Number(( parseFloat(this.filledOrder.order.filled_avg_price) / parseFloat(this.strategyrunsUpdate['AvgBuy']) -1 ).toFixed(2));
            this.strategiaUpdate.CapitaleResiduo = this.capitali.totaleCapitale;                // Aggiorno capitale residuo
            //this.strategyrunsUpdate['CapitaleResiduo'] =  this.strategiaUpdate.CapitaleResiduo;
            // (Capitale Finale - Capitale Iniziale) / Capitale Iniziale
            //this.strategia.PLPerc = ((this.strategia.CapitaleResiduo + this.strategia.PLCapitale) - (this.strategia.CapitaleInvestito)) / this.strategia.CapitaleInvestito

            // Quando ho venduto tutte le azioni comprate allora chiudo un ciclo, resetto a zero numAzioniBuy, numAzioniSell, CapitaleInvestito
            // AvgBuy e AvgSell per ricominciare nuovo ciclo
            if(Number(this.strategyrunsUpdate.numAzioniBuy)=== Number(this.strategyrunsUpdate.numAzioniSell)){

                this.strategyrunsUpdate['close_date'] = this.filledOrder.timestamp;;
                // Aggiorno numero operazioni e operazioni vincenti
                logger.trace(`[updateKPIs] Incremento numeroOperazioni da ${this.strategiaUpdate.NumeroOperazioni}`);
                this.strategiaUpdate.NumeroOperazioni ++;
                if(this.strategyrunsUpdate['PLCapitale'] > 0)
                    this.strategiaUpdate.NumeroOperazioniVincenti++;

                // Imposto stato OFF Market
                this.strategiaUpdate.posizioneMercato="OFF"

                // Calcolo della Volatilita'
                //this.strategia.Count ++;
                const rendimento = ((Number(this.strategyrunsUpdate['PLCapitale']) + Number(this.strategyrunsUpdate['CapitaleInvestito'])) / Number(this.strategyrunsUpdate['CapitaleInvestito'])) -1;
                let delta = rendimento - Number(this.strategyrunsUpdate['Mean']);

                this.strategyrunsUpdate['Mean'] =  Number(this.strategyrunsUpdate['Mean']) + delta / Number(this.strategiaUpdate.NumeroOperazioni);

                this.strategyrunsUpdate['M2'] = Number(this.strategyrunsUpdate['M2']) + delta * (rendimento - Number(this.strategyrunsUpdate['Mean']));
                if(Number(this.strategiaUpdate.NumeroOperazioni) > 1) 
                    this.strategyrunsUpdate['Varianza'] = Number(this.strategyrunsUpdate['M2']) / (Number(this.strategiaUpdate.NumeroOperazioni) -1);
                this.strategyrunsUpdate['ScartoQuadratico'] = Math.sqrt(Number(this.strategyrunsUpdate['Varianza']))

                // Azzero il capitale investito
                this.strategiaUpdate.CapitaleInvestito = 0;  
            }
            logger.log(`[updateKPIs] Fine calcolo KPIs strategiaUpdate : | ${JSON.stringify(this.strategiaUpdate)}`);
            logger.log(`[updateKPIs] Fine calcolo KPIs strategyrunsUpdate : | ${JSON.stringify(this.strategyrunsUpdate)}`);
        }
            logger.trace(`[updateKPIs]  strategiaUpdate : | ${JSON.stringify(this.strategiaUpdate)}`);
            logger.trace(`[updateKPIs]  strategyrunsUpdate : | ${JSON.stringify(this.strategyrunsUpdate)}`); 
    }
    
}

module.exports = fiilOrders;