const createLogger = require('../shared/logger');
const { v4: uuidv4 } = require('uuid');
const MODULE_NAME = 'fillOrders';
const MODULE_VERSION = '1.0';
const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL || 'info');

class fiilOrders {
    constructor(caller, filledOrder, transazioni, strategia, ordine, cache, openOrders) {
        this.caller = caller;
        this.transazioni = transazioni;
        this.strategia = strategia;
        this.cache=cache;
        this.filledOrder=filledOrder;
        this.ordine = ordine;
        this.openOrders = openOrders;

        this.transactionUpdate = transazioni;
        this.strategiaUpdate = strategia;
    }

    getTransazioni() {
        return this.transactionUpdate;
    }

    getStrategia(){
        return this.strategiaUpdate;
    }

    updateKPIs (){
        // Caso Acquisto
        if(this.ordine.side == "buy"){
            // Aggiorno prezzo medio acquisto
            this.strategiaUpdate.AvgBuy = (this.strategiaUpdate.AvgBuy*this.strategies.numAzioniBuy +   parseFloat(this.ordine.filled_avg_price) * parseFloat(this.ordine.filled_qty)) / (this.strategies.numAzioniBuy+ parseFloat(this.ordine.filled_qty));
            // Aggiorno numero azioni acquistate
            this.strategiaUpdate.numAzioniBuy +=  this.ordine.filled_qty;
            // Aggiorno Capitale Investito
            this.strategiaUpdate.CapitaleInvestito += parseFloat(this.ordine.filled_qty) * parseFloat(filled_avg_price);          // Aggiorno il capitale investito
            this.strategiaUpdate.CapitaleResiduo += parseFloat(this.ordine.filled_qty) * parseFloat(filled_avg_price);            // Aggiorno capitale residuo
            if(this.openOrders === 0 && caller === "OrderListener Fill")
                this.strategiaUpdate.OpenOrders = 0;                     // OpenOrders viene decrementato Da verificare fill o partial fill
            else
                this.strategiaUpdate.OpenOrders -= parseFloat(this.ordine.filled_qty) * parseFloat(filled_avg_price);

            // Se la strategia era si OFF questo e' il primo ingresso in mercato. Genero un nuovo idOperazione e 
            // imposto posizioneMercato ON
            if(this.strategiaUpdate.posizioneMercato==="OFF"){
                this.transactionUpdate.idOperazione = uuidv4();
                this.strategiaUpdate.posizioneMercato="ON"
                logger.log(`[updateStrategia] Ciclo di vendita per strategia ${this.strategiaUpdate.id} iniziato con idOperazione ${this.transactionUpdate.idOperazione}`);
            }

            // Caso Vendita
        } else {  
            // Aggiorno prezzo medio di vendita
            this.strategiaUpdate.AvgSell = (this.strategiaUpdate.AvgSell*this.strategies.numAzioniSell +   parseFloat(this.ordine.filled_avg_price)* parseFloat(this.ordine.filled_qty)) / (this.strategies.numAzioniSell+ parseFloat(this.ordine.filled_qty));
            // Aggiorno numero azioni vendute
            this.strategiaUpdate.numAzioniSell +=  parseFloat(this.ordine.filled_qty);

            

            // Calcolo del Profit/Loss della singola operazione tabella transazioni
            this.transactionUpdate.PLPerc = (this.strategiaUpdate.AvgSell / this.strategiaUpdate.AvgBuy ) -1 ;                              // Quanto ho perso o guadagnato in percentuale su questa transazione
            this.transactionUpdate.PLAzione = this.strategiaUpdate.AvgSell - this.strategiaUpdate.AvgBuy;                                   // Quanto ho perso o guadagnato in $ per azione su questa transazione
            this.transactionUpdate.capitale = parseFloat(this.ordine.filled_avg_price) * parseFloat(this.ordine.filled_qty);                // Capitale in arrivo da questa transazione
            this.transactionUpdate.PLOperazione = this.transactionUpdate.PLAzione * parseFloat(this.ordine.filled_qty);                     // Quanto ho perso o guadagnato in $ su questa transazione
            this.transactionUpdate.PLOperazionePerc = (this.transactionUpdate.capitale / this.strategiaUpdate.CapitaleInvestito);           // Profit/Loss in percentuale per tutta l'operazione

            // Calcolo del Profit/Loss cumulativo sulla tabella strategies
            this.strategiaUpdate.PLCapitale +=  this.transactionUpdate.PLOperazione                                                 // Cumulato del Capitale guadagnato o perso
            this.strategiaUpdate.CapitaleResiduo -= this.strategiaUpdate.AvgBuy * parseFloat(this.ordine.filled_qty)                // Aggiorno capitale residuo
            // (Capitale Finale - Capitale Iniziale) / Capitale Iniziale
            //this.strategia.PLPerc = ((this.strategia.CapitaleResiduo + this.strategia.PLCapitale) - (this.strategia.CapitaleInvestito)) / this.strategia.CapitaleInvestito


            // Calcolo del Max DrawDown
            this.strategiaUpdate.Drawdown_PeakMax = Math.max(this.strategiaUpdate.Drawdown_PeakMax , this.strategiaUpdate.CapitaleResiduo + this.strategiaUpdate.PLCapitale);
            let Drawdown = (this.strategiaUpdate.Drawdown_PeakMax - this.strategiaUpdate.CapitaleResiduo + this.strategiaUpdate.PLCapitale);
            this.strategiaUpdate.MaxDrawdown = Math.min(this.strategiaUpdate.MaxDrawdown,  ((Drawdown / this.strategiaUpdate.Drawdown_PeakMax) * 100).toFixed(2));

            // Quando ho venduto tutte le azioni comprate allora chiudo un ciclo, resetto a zero numAzioniBuy, numAzioniSell, CapitaleInvestito
            // AvgBuy e AvgSell per ricominciare nuovo ciclo
            if(this.strategiaUpdate.numAzioniBuy === this.strategiaUpdate.numAzioniSell){
                logger.log(`[updateStrategia] Ciclo di vendita per strategia ${this.strategiaUpdate.id} finito azzero numAzioniBuy, numAzioniSell, AvgBuy e AvgSell e incremento numero operazioni`);
                this.strategiaUpdate.AvgBuy = this.strategiaUpdate.AvgSell = this.strategiaUpdate.numAzioniBuy = this.strategiaUpdate.numAzioniSell = 0;

                // Aggiorno numero operazioni e operazioni vincenti
                this.strategiaUpdate.NumeroOperazioni ++;
                if(this.strategiaUpdate.PLCapitale > 0)
                    this.strategiaUpdate.NumeroOperazioniVincenti++;

                // Imposto stato OFF Market
                this.strategiaUpdate.posizioneMercato="OFF"

                // Calcolo della Volatilita'
                //this.strategia.Count ++;
                const rendimento = (this.strategia.PLCapitale + this.strategiaUpdate.CapitaleInvestito) / this.strategiaUpdate.CapitaleInvestito
                let delta = rendimento - this.strategia.Mean;
                this.strategia.mean +=  delta / this.strategiaUpdate.NumeroOperazioni;
                this.strategia.M2 += delta * (rendimento - this.strategia.mean);
                if(this.strategiaUpdate.NumeroOperazioni > 1) this.strategia.Varianza = this.strategia.M2 / (this.strategiaUpdate.NumeroOperazioni -1);
                this.strategia.ScartoQuadratico = Math.sqrt(this.strategia.Varianza)

                // Azzero il capitale investito
                this.strategiaUpdate.CapitaleInvestito = 0;
            }
        }
        
    }
    
}

module.exports = fiilOrders;