const request = require('supertest');
const app = require('../../DBManager/endpoints'); // assicurati che server.js esporti `app`

describe('DBManager REST API - Full Coverage', () => {
  it('GET /health', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
  });

  it('GET /info', async () => {
    const res = await request(app).get('/info');
    expect(res.statusCode).toBe(200);
  });

  it('GET /symbols', async () => {
    const res = await request(app).get('/symbols');
    expect([200]).toContain(res.statusCode);
  });

//   it('POST /insertScenario', async () => {
//     const body = { TF: "15Min", MA: 25, SL: -0.004, TP: 0.1 }
//     const res = await request(app).post('/insertScenario',body).send({});
//     expect([200, 400]).toContain(res.statusCode);
//   });



  it('GET /getSetting/ALPACA-DEV-BASE', async () => {
    const res = await request(app).get('/getSetting/ALPACA-PAPER-BASE');
    expect([200]).toContain(res.statusCode);
  });

//   it('POST /updateScenario', async () => {
//     const body = { strategyParams : {id:1}, minDay:0, maxDay:0, capitaleFinale:10, profitto:1, efficienza:1 }
//     const res = await request(app).post('/updateScenario').send(body);
//     expect([200]).toContain(res.statusCode);
//   });

  it('GET /simul/account', async () => {
    const res = await request(app).get('/simul/account');
    expect([200]).toContain(res.statusCode);
  });

  it('GET /simul/positions', async () => {
    const res = await request(app).get('/simul/positions');
    expect([200]).toContain(res.statusCode);
  });

  it('POST /simul/positions', async () => {
    const body = {
        "asset_id": "b0b6dd9d-8b9b-48a9-ba46-b9d54906e415",
        "symbol": "MSFT",
        "exchange": "NASDAQ",
        "asset_class": "us_equity",
        "qty": 100,
        "avg_entry_price": 312.50,
        "side": "long",
        "market_value": 31500.00,
        "cost_basis": 31250.00,
        "unrealized_pl": 250.00,
        "unrealized_plpc": 0.008,
        "unrealized_intraday_pl": 100.00,
        "unrealized_intraday_plpc": 0.0032,
        "current_price": 315.00,
        "lastday_price": 314.00,
        "change_today": 0.0032,
        "qty_available": 100    
    }  
    const res = await request(app).post('/simul/positions').send(body);
    expect([200]).toContain(res.statusCode);
  });

  it('PUT /simul/positions', async () => {
    const body = {
        "position_id": "dad32b64-1b9a-42ac-ba38-1b12ed6c7891",
        "qty": 150,
        "avg_entry_price": 310.25,
        "market_value": 46537.50,
        "cost_basis": 46500.00,
        "unrealized_pl": 37.50,
        "unrealized_plpc": 0.0008,
        "unrealized_intraday_pl": 15.00,
        "unrealized_intraday_plpc": 0.0005,
        "current_price": 310.25,
        "lastday_price": 309.50,
        "change_today": 0.0024,
        "qty_available": 150
    }
    const res = await request(app).put('/simul/positions').send(body);
    expect([200]).toContain(res.statusCode);
  });

  it('DELETE /simul/positions/MSFT', async () => {
    const res = await request(app).delete('/simul/positions/MSFT');
    expect([200]).toContain(res.statusCode);
  });


  it('PUT /simul/account', async () => {
    const body = {
        "id": "f7a1b0d0-aaaa-bbbb-cccc-1a2b3c4d5e6f",
        "cash": 128450.75,
        "buying_power": 256901.50,
        "portfolio_value": 178340.25,
        "status": "ACTIVE",
        "trading_blocked": false,
        "transfers_blocked": false,
        "account_blocked": false,
        "created_at": "2025-05-28T12:00:00.000Z"
    }
    const res = await request(app).put('/simul/account').send(body);
    expect([200]).toContain(res.statusCode);
  });

  it('GET /simul/orders', async () => {
    const res = await request(app).get('/simul/orders');
    expect([200]).toContain(res.statusCode);
  });

  it('POST /simul/orders', async () => {
    const body = {
        "id": "dad32b64-1b9a-42ac-ba38-1b12ed6c7891",
        "client_order_id": "2203bf6b-598d-47db-b647-d276fd400851",
        "created_at": "2025-05-10T12:52:49.542Z",
        "updated_at": "2025-05-10T12:52:49.544Z",
        "submitted_at": "2025-05-10T12:52:49.542Z",
        "filled_at": null,
        "expired_at": null,
        "canceled_at": null,
        "failed_at": null,
        "replaced_at": null,
        "replaced_by": null,
        "replaces": null,
        "asset_id": "b6d1aa75-5c9c-4353-a305-9e2caa1925ab",
        "symbol": "MSFT",
        "asset_class": "us_equity",
        "notional": null,
        "qty": "101",
        "filled_qty": "0",
        "filled_avg_price": null,
        "order_class": "",
        "order_type": "limit",
        "type": "limit",
        "side": "buy",
        "time_in_force": "day",
        "limit_price": "383",
        "stop_price": null,
        "status": "accepted",
        "extended_hours": false,
        "legs": null,
        "trail_percent": null,
        "trail_price": null,
        "hwm": null,
        "subtag": null,
        "source": "simulator"
    }
    const res = await request(app).post('/simul/orders').send(body);
    expect([200]).toContain(res.statusCode);
  });

  it('PUT /simul/orders', async () => {
    const body = {
        "id": "dad32b64-1b9a-42ac-ba38-1b12ed6c7891",
        "filled_at": "2025-05-10T13:12:49.542Z",
        "filled_qty": "101",
        "filled_avg_price": "384.12",
        "status": "filled",
        "updated_at": "2025-05-10T13:12:50.000Z",
        "legs": null,
        "extended_hours": false
    }

    const res = await request(app).put('/simul/orders').send(body);
    expect([200]).toContain(res.statusCode);
  });
});
