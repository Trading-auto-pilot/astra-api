const createLogger = require('../../shared/logger');
const { v4: uuidv4 } = require('uuid');
const MODULE_NAME = 'fillOrders';
const MODULE_VERSION = '1.0';
const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL || 'info');
 
class fiilOrders {
    constructor(caller, filledOrder, transazioni, strategia, cache, openOrders) {
        this.caller = caller;
        this.transazioni = transazioni;
        this.strategia = strategia;
        this.cache=cache;
        this.filledOrder=filledOrder;
        //this.ordine = ordine;
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
        if(this.filledOrder.order.side == "buy"){
            logger.trace(`[BUY] this.openOrders : ${this.openOrders} this.filledOrder : ${JSON.stringify(this.filledOrder)}`);
            // Aggiorno prezzo medio acquisto
            this.strategiaUpdate.AvgBuy = (parseFloat(this.strategiaUpdate.AvgBuy)*Number(this.strategia.numAzioniBuy) +   parseFloat(this.filledOrder.order.filled_avg_price) * parseFloat(this.filledOrder.order.filled_qty)) / (Number(this.strategia.numAzioniBuy)+ parseFloat(this.filledOrder.order.filled_qty));
            // Aggiorno numero azioni acquistate
            this.strategiaUpdate.numAzioniBuy +=  Number(this.filledOrder.order.filled_qty);
            // Aggiorno Capitale Investito

            this.strategiaUpdate.CapitaleInvestito += parseFloat(this.filledOrder.order.filled_qty) * parseFloat(this.filledOrder.order.filled_avg_price);          // Aggiorno il capitale investito
            this.strategiaUpdate.CapitaleResiduo += parseFloat(this.filledOrder.order.filled_qty) * parseFloat(this.filledOrder.order.filled_avg_price);            // Aggiorno capitale residuo
            this.transactionUpdate.operation='BUY'
            if(Number(this.openOrders) === 0 && this.caller === "fill")
                // Se e' l'unico ordine aperto e viene fatto fill completo mi aspetto che OpenOrder vada a zero o quasi. Porebbe
                // esserci una piccola differenza tra il prezzo dell'ordine e quello di acquisto che potrebbe far non azzerare OpenOrders
                this.strategiaUpdate.OpenOrders = 0;                     // OpenOrders viene decrementato Da verificare fill o partial fill
            else
                this.strategiaUpdate.OpenOrders -= parseFloat(this.filledOrder.order.filled_qty) * parseFloat(this.filledOrder.order.filled_avg_price);

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
            this.strategiaUpdate.AvgSell = (parseFloat(this.strategiaUpdate.AvgSell)*Number(this.strategia.numAzioniSell) +   parseFloat(this.filledOrder.order.filled_avg_price)* parseFloat(this.filledOrder.order.filled_qty)) / (Number(this.strategia.numAzioniSell)+ parseFloat(this.filledOrder.order.filled_qty));
            // Aggiorno numero azioni vendute
            this.strategiaUpdate.numAzioniSell +=  parseFloat(this.filledOrder.order.filled_qty);

            this.transactionUpdate.operation='SELL'

            // Calcolo del Profit/Loss della singola operazione tabella transazioni
            this.transactionUpdate.PLPerc = (parseFloat(this.strategiaUpdate.AvgSell) / parseFloat(this.strategiaUpdate.AvgBuy) ) -1 ;                              // Quanto ho perso o guadagnato in percentuale su questa transazione
            this.transactionUpdate.PLAzione = parseFloat(this.strategiaUpdate.AvgSell) - parseFloat(this.strategiaUpdate.AvgBuy);                                   // Quanto ho perso o guadagnato in $ per azione su questa transazione
            this.transactionUpdate.capitale = parseFloat(this.filledOrder.order.filled_avg_price) * parseFloat(this.filledOrder.order.filled_qty);                // Capitale in arrivo da questa transazione
            this.transactionUpdate.PLOperazione = parseFloat(this.transactionUpdate.PLAzione) * parseFloat(this.filledOrder.order.filled_qty);                     // Quanto ho perso o guadagnato in $ su questa transazione
            this.transactionUpdate.PLOperazionePerc = (parseFloat(this.transactionUpdate.capitale) / parseFloat(this.strategiaUpdate.CapitaleInvestito));           // Profit/Loss in percentuale per tutta l'operazione

            // Calcolo del Profit/Loss cumulativo sulla tabella strategies
            this.strategiaUpdate.PLCapitale +=  parseFloat(this.transactionUpdate.PLOperazione)                                                 // Cumulato del Capitale guadagnato o perso
            this.strategiaUpdate.CapitaleResiduo -= parseFloat(this.strategiaUpdate.AvgBuy) * parseFloat(this.filledOrder.order.filled_qty)                // Aggiorno capitale residuo
            // (Capitale Finale - Capitale Iniziale) / Capitale Iniziale
            //this.strategia.PLPerc = ((this.strategia.CapitaleResiduo + this.strategia.PLCapitale) - (this.strategia.CapitaleInvestito)) / this.strategia.CapitaleInvestito


            // Calcolo del Max DrawDown
            this.strategiaUpdate.Drawdown_PeakMax = Math.max(Number(this.strategiaUpdate.Drawdown_PeakMax) , Number(this.strategiaUpdate.CapitaleResiduo) + Number(this.strategiaUpdate.PLCapitale));
            let Drawdown = (Number(this.strategiaUpdate.Drawdown_PeakMax) - Number(this.strategiaUpdate.CapitaleResiduo) + Number(this.strategiaUpdate.PLCapitale));
            this.strategiaUpdate.MaxDrawdown = Math.min(Number(this.strategiaUpdate.MaxDrawdown),  ((Drawdown / Number(this.strategiaUpdate.Drawdown_PeakMax)) * 100).toFixed(2));

            // Quando ho venduto tutte le azioni comprate allora chiudo un ciclo, resetto a zero numAzioniBuy, numAzioniSell, CapitaleInvestito
            // AvgBuy e AvgSell per ricominciare nuovo ciclo
            if(Number(this.strategiaUpdate.numAzioniBuy)=== Number(this.strategiaUpdate.numAzioniSell)){
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
                const rendimento = (Number(this.strategia.PLCapitale) + Number(this.strategiaUpdate.CapitaleInvestito)) / Number(this.strategiaUpdate.CapitaleInvestito)
                let delta = rendimento - Number(this.strategia.Mean);
                this.strategia.mean +=  delta / Number(this.strategiaUpdate.NumeroOperazioni);
                this.strategia.M2 += delta * (rendimento - Number(this.strategia.mean));
                if(Number(this.strategiaUpdate.NumeroOperazioni) > 1) this.strategia.Varianza = Number(this.strategia.M2) / (Number(this.strategiaUpdate.NumeroOperazioni) -1);
                this.strategia.ScartoQuadratico = Math.sqrt(Number(this.strategia.Varianza))

                // Azzero il capitale investito
                this.strategiaUpdate.CapitaleInvestito = 0;
            }
        }
        
    }
    
}

module.exports = fiilOrders;