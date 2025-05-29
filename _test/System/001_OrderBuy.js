const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const msg = require('./messages.json');

let AlpacaTestOrders, localOrder, localTransaction, localStrategy, response, orderSimulator;

function generateHighPrecisionTimestamp() {
  const date = new Date();
  const iso = date.toISOString(); // es: 2025-05-21T14:20:16.620Z

  // Estrai la parte base e aggiungi 6 cifre random
  const base = iso.slice(0, -1); // rimuove la "Z"
  const extraDigits = Math.floor(Math.random() * 1e6)
    .toString()
    .padStart(6, '0'); // aggiunge 6 cifre fittizie

  return `${base}${extraDigits}Z`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


describe('Test E2E - Invio messaggio da Market Simulator per con candela che triggera Acquisto', () => {

  beforeAll(async () => {
    // Invia una richiesta POST per creare un nuovo ordine
    response = await axios.post('http://localhost:3003/send', msg["TEST_SELL1"]);

    await sleep(1500);
    // Verifica che l'ordine sia stato inviato ad Alpaca
    const AlpacaOrder = await axios.get(`https://paper-api.alpaca.markets/v2/orders`,
        {
            headers: {
            'APCA-API-KEY-ID': process.env.APCA_API_KEY_ID, 
            'APCA-API-SECRET-KEY': process.env.APCA_API_SECRET_KEY
            }
        }
    );

    AlpacaTestOrders = AlpacaOrder.data.filter(order =>
      order.client_order_id && 
      order.client_order_id.includes('-TEST-') && 
      order.symbol === msg.TEST_BUY1[0].S &&
      order.side === "buy"
    )

      // Setto il messaggio per i test successivi
    msg.TEST_NEW1.data.order.id = AlpacaTestOrders[0].id;
    msg.TEST_NEW1.data.order.client_order_id =AlpacaTestOrders[0].client_order_id;
    msg.TEST_NEW1.data.order.created_at = generateHighPrecisionTimestamp();
    msg.TEST_NEW1.data.order.submitted_at = generateHighPrecisionTimestamp();
    msg.TEST_NEW1.data.order.updated_at = generateHighPrecisionTimestamp();
    msg.TEST_NEW1.data.order.symbol = AlpacaTestOrders[0].symbol;
    msg.TEST_NEW1.data.order.qty = AlpacaTestOrders[0].qty;

    msg.TEST_FILL1.data.order.id = AlpacaTestOrders[0].id;
    msg.TEST_FILL1.data.order.client_order_id =AlpacaTestOrders[0].client_order_id;
    msg.TEST_FILL1.data.order.created_at = generateHighPrecisionTimestamp();
    msg.TEST_FILL1.data.order.submitted_at = generateHighPrecisionTimestamp();
    msg.TEST_FILL1.data.order.updated_at = generateHighPrecisionTimestamp();
    msg.TEST_FILL1.data.order.filled_at = generateHighPrecisionTimestamp();

    msg.TEST_FILL1.data.order.symbol = AlpacaTestOrders[0].symbol;
    msg.TEST_FILL1.data.order.qty = AlpacaTestOrders[0].qty; 
    msg.TEST_FILL1.data.order.filled_qty = AlpacaTestOrders[0].qty;
    msg.TEST_FILL1.data.order.filled_avg_price = AlpacaTestOrders[0].limit_price;
    msg.TEST_FILL1.data.order.limit_price = AlpacaTestOrders[0].limit_price;

    // Verifica che l'ordine sia stato correttamente inserito nel DB
    localOrder = await axios.get(`http://localhost:3002/order/${AlpacaTestOrders[0].id}`);

    // Verifico che ci sia la transazione nel DB
    localTransaction = await axios.get(`http://localhost:3002/transactions/${AlpacaTestOrders[0].id}`);

    // Verifico che sia stata aggiornata la tabella strategy
    localStrategy = await axios.get(`http://localhost:3002/getStrategyCapitalAndOrders/${localTransaction.data[0].ScenarioID}`);
  });
  
  it('Invia un messaggio da MarketSimulator con candela che triggera BUY operation', async () => {
    expect(response.status).toBe(200);
  });
  it("Verifico che l'ordine sia stato correttamente inserito in Alpaca", async () => {
    expect(AlpacaTestOrders.length).toBeGreaterThan(0);
  });

  it('Verifico che ordine BUY sia stato correttamente inserito nella tabella Ordini', async () => {
    expect(localOrder.data).toBeDefined();
  });

  it('Verifico che ordine BUY sia stato correttamente inserito nella tabella Transazioni', async () => {
    expect(localTransaction.data.length).toBeGreaterThan(0);
    expect(localTransaction.data[0].operation).toBe('BUY ORDER');
    expect(Number(localTransaction.data[0].Price)).toBeGreaterThan(0);
    expect(Number(localTransaction.data[0].NumAzioni)).toBeGreaterThan(0);
  });

  it('Verifico che ordine BUY sia stato correttamente inserito nella tabella Strategy', async () => {
    expect(Number(localStrategy.data[0].OpenOrders)).toBeGreaterThan(0);
    expect(Number(localStrategy.data[0].CapitaleInvestito)).toBe(0);
  });
});


describe('Test E2E - Invio messaggio da Order Simulator come ordine NEW', () => {

  beforeAll(async () => {
    // Invia una richiesta POST per creare un nuovo ordine
    await sleep(200);
    orderSimulator = await axios.post(`http://localhost:3004/send`,msg.TEST_NEW1);

      // Verifico che ci sia la transazione nel DB
    await sleep(200);
    localTransaction = await axios.get(`http://localhost:3002/transactions/${AlpacaTestOrders[0].id}`);

  });

  it('Invia un messaggio da OrderSimulator come ordine BUY new', async () => {
    expect(orderSimulator.data.message).toBe("Payload inviato");
  });

  it('Verifico che l tabella transazioni sia correttamente cambiata', async () => {
    expect(localTransaction.data[0].operation).toBe('BUY NEW');
  });
});


describe('Test E2E - Invio messaggio da Order Simulator come ordine FILL', () => {

  let localTrans2, orderSimul2, localStrategy2, localOrder2;

  beforeAll(async () => {
    // Invia una richiesta POST per creare un nuovo ordine
    await sleep(200);
    orderSimul2 = await axios.post(`http://localhost:3004/send`,msg.TEST_FILL1);

    // Verifico che ci sia la transazione nel DB
    await sleep(1200);
    localTrans2 = await axios.get(`http://localhost:3002/transactions/${AlpacaTestOrders[0].id}`);

      // Verifico che sia stata aggiornata la tabella strategy
    await sleep(1200);
    localStrategy2 = await axios.get(`http://localhost:3002/getStrategyCapitalAndOrders/${localTrans2.data[0].ScenarioID}`);

    // Verifica che l'ordine sia stato correttamente inserito nel DB
    await sleep(1200);
    localOrder2 = await axios.get(`http://localhost:3002/order/${AlpacaTestOrders[0].id}`);
  });

  it('Verifico che invio di BUY FILL siaandato a buon fine', async () => {
    expect(orderSimul2.data.message).toBe("Payload inviato");
  });

  it('Verifico che l tabella transazioni sia correttamente cambiata', async () => {
    expect(localTrans2.data[0].operation).toBe('BUY');
    expect(localTrans2.data[0].NumAzioni).toBeGreaterThan(0);
  });

  it('Verifico che sia stata modificata la tabella Strategy', async () => {
    expect(Number(localStrategy2.data[0].OpenOrders)).toBe(0);
    expect(Number(localStrategy2.data[0].CapitaleInvestito)).toBeGreaterThan(0);
    expect(Number(localStrategy2.data[0].numAzioniBuy)).toBeGreaterThan(0);
    expect(localStrategy2.data[0].posizioneMercato).toBe("ON");
  });

  it('Verifico sia stato valorizzato il campo filled_ad nella tabella Ordini', async () => {
    expect(localOrder2.data.filled_at).toBeDefined();
  });
});
