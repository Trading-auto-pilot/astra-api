const fillOrder = require('./fillOrder');

const event_type = 'fill';
//const data = JSON.parse('{"at":"2023-12-12T14:30:00.000Z","event_id":"01JVSKESVEQERFRR4F0B8V34EH","event":"fill","timestamp":"2023-12-12T14:30:00.000Z","order":{"id":"389e4651-9d23-4272-bf1f-1642be70bd51","client_order_id":"ff46b063-2071-4887-b1dc-39e8979f252e","created_at":"2023-12-12T14:30:00.000Z","updated_at":"2023-12-12T14:30:00.000Z","submitted_at":"2023-12-12T14:30:00.000Z","filled_at":"1970-01-01T00:00:00.000Z","expired_at":"1970-01-01T00:00:00.000Z","canceled_at":"1970-01-01T00:00:00.000Z","failed_at":"1970-01-01T00:00:00.000Z","replaced_at":"1970-01-01T00:00:00.000Z","replaced_by":null,"replaces":null,"asset_id":"b6d1aa75-5c9c-4353-a305-9e2caa1925ab","symbol":"MSFT","asset_class":"us_equity","qty":"66.000000","filled_qty":"66.000000","order_class":"","order_type":"limit","type":"limit","side":"buy","time_in_force":"day","limit_price":"380.000000","status":"accepted","extended_hours":false,"legs":null,"hwm":null,"subtag":null,"source":null,"filled_avg_price":"377.65"},"execution_id":"e2d698fd-367e-4176-bfc6-8928ece9d140"}');
const data = JSON.parse('{"event":"fill","execution_id":"ea7d39af-e2f5-41f0-b35b-6c028739643f","price":"427.30","position_qty":"0","timestamp":"2025-06-12T13:21:23.991Z","order":{"id":"4c8c0d3e-ff3d-4381-b10c-38413b3438df","client_order_id":"c9e3755f-fb4c-4875-86b4-7b402dcab8d2","created_at":"2025-06-12T13:21:23.991Z","updated_at":"2025-06-12T13:21:23.991Z","submitted_at":"2025-06-12T13:21:23.991Z","filled_at":"2025-06-12T13:21:23.991Z","expired_at":null,"canceled_at":null,"failed_at":null,"replaced_at":null,"replaced_by":null,"replaces":null,"asset_id":"b6d1aa75-5c9c-4353-a305-9e2caa1925ab","symbol":"MSFT","asset_class":"us_equity","notional":null,"qty":51,"filled_qty":51,"filled_avg_price":"427.30","order_class":"","order_type":"market","type":"market","side":"sell","time_in_force":"day","limit_price":null,"stop_price":null,"status":"filled","extended_hours":false,"legs":null,"trail_percent":null,"trail_price":null,"hwm":null,"subtag":null,"source":"simulator","position_intent":"sell_to_close"}}')
const strategia = JSON.parse('{"data":[{"id":10,"idBotIn":"SMA","idBotOut":"SLTP","idSymbol":"MSFT","params":{"TP":0.1,"SL":-0.005,"TF":"15Min","MA":25,"buy":{"type":"limit","limit_price":0.005,"time_in_force":"day","stop_price":null,"trail_price":null,"extended_hours":false},"sell":{"exitMode":"close","type":"limit","time_in_force":"gtc","limit_price":0.005,"stop_price":0.004,"trail_price":null,"extended_hours":null}},"status":"active","share":0.25,"CapitaleInvestito":-54294737.95499999,"OpenOrders":79.04999999999927,"NumeroOperazioni":6,"NumeroOperazioniVincenti":3,"AvgBuy":0,"AvgSell":427.3,"PLAzione":0,"PLCapitale":0,"PLPerc":"0.00","CAGR":0,"Drawdown_PeakMax":0,"Drawdown_PeakMin":0,"MaxDrawdown":0,"Mean":0,"M2":0,"Count":0,"Varianza":0,"ScartoQuadratico":0,"ggCapitaleInvestito":0,"MaxDay":0,"MinDay":0,"numAzioniBuy":0,"numAzioniSell":0,"posizioneMercato":"d52722a9-bf2a-43ee-b1b9-0ee977b41e0d","CapitaleResiduo":0}]}')
const transazioni = JSON.parse('{"data" : {}}');
const strategy_runs = JSON.parse('{"strategy_runs_id":"d52722a9-bf2a-43ee-b1b9-0ee977b41e0d","strategy_id":"10","open_date":"2025-06-12T13:21:11.000Z","close_date":null,"update_date":"2025-06-12T13:21:24.000Z","CapitaleInvestito":"19300.950000","AvgBuy":"378.450000","AvgSell":"0.000000","numAzioniBuy":51,"numAzioniSell":0,"PLAzione":"0.000000","PLCapitale":"0.000000","PLPerc":"0.00","CAGR":"0.0000","Drawdown_PeakMax":"427.300000","Drawdown_PeakMin":"427.300000","MaxDrawdown":"0.000000","Mean":"0.000000","M2":"0.000000","Count":0,"Varianza":"0.000000","ScartoQuadratico":"0.000000","ggCapitaleInvestito":0}');
const cache = "100000";
const openOrders = JSON.parse('{"data" : { "count" : 0}}');

console.log("Inizio test");
console.log("data");
console.log(data);
console.log("strategia");
console.log(strategia);

  // Istanzio la calsse comune e gli passo le transazioni e la strategia.
const fillComm = new fillOrder(event_type, data, transazioni.data, strategia.data[0], cache, openOrders.data.count, strategy_runs);

fillComm.updateKPIs();

console.log("Risultato");
console.log("----------------------------");
console.log(fillComm.getStrategia());
console.log("----------------------------");
console.log(fillComm.getNewStrategyRuns());