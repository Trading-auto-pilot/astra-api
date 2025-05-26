// server.js
const express = require('express');
const DBManager = require('./dbManager');
require('dotenv').config({ path: '../.env' }); // Adatta il path se serve

// Costanti globali di modulo
const MODULE_NAME = 'DBManager_RESTServer';
const MODULE_VERSION = '1.0';

const app = express();
const port = process.env.PORT || 3002;
const dbManager = new DBManager();

app.use(express.json());

// Endpoint di health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// Endpoint informazioni sul modulo
app.get('/info', (req, res) => {
  res.status(200).json(dbManager.getInfo());
});

// Endpoint per recuperare lista simboli
app.get('/symbols', async (req, res) => {
  try {
    const symbols = await dbManager.getSymbolsList();
    res.json(symbols);
  } catch (error) {
    console.error('[ERROR] /symbols:', error.message);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// Endpoint per recuperare tutte le strategie o quelle di uno specifico simbolo
app.get('/strategies/:symbol?', async (req, res) => {
  const symbol = req.params.symbol;  // undefined se non specificato
  try {
    const strategies = await dbManager.getActiveStrategies(symbol);
    res.json(strategies);
  } catch (error) {
    console.error('[ERROR] /strategies:', error.message);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// Endpoint per recuperare tutte le strategie o quelle di uno specifico simbolo
app.get('/order/:id?', async (req, res) => {
  const id = req.params.id;  // undefined se non specificato
  try {
    const order = await dbManager.getOrder(id);
    res.json(order);
  } catch (error) {
    console.error('[ERROR] /order:', error.message);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// Recupera il valore di un'impostazione dato il nome chiave
app.get('/getSetting/:key', async (req, res) => {
    const dbManager = new DBManager();
    const key = req.params.key;
  
    if (!key) {
      return res.status(400).json({ error: 'Chiave mancante nella richiesta' });
    }
  
    try {
      const value = await dbManager.getSettingValue(key);
  
      if (value === null) {
        return res.status(404).json({ error: `Setting non trovato o non attivo per la chiave: ${key}` });
      }
  
      res.status(200).json({ value: value });
    } catch (error) {
      console.error(`[${MODULE_NAME}][getSetting] Errore nella richiesta GET:`, error.message);
      res.status(500).json({ error: 'Errore interno durante il recupero del setting', details : error });
    }
  });

// Inserisce un nuovo scenario nella tabella strategy_runs
app.post('/insertScenario', async (req, res) => {
    const dbManager = new DBManager();
    const { strategyParams, strategy } = req.body;
  
    // Validazione veloce dei parametri minimi
    if (!strategyParams || !strategy) {
      return res.status(400).json({ error: 'Parametri strategyParams e strategy obbligatori' });
    }
  
    if (!strategyParams.id || !strategyParams.symbol || !strategyParams.startDate || !strategyParams.endDate || !strategyParams.capitaleIniziale) {
      return res.status(400).json({ error: 'Parametri obbligatori mancanti in strategyParams: id, symbol, startDate, endDate, capitaleIniziale' });
    }
  
    try {
      await dbManager.insertScenario(strategyParams, strategy);
      console.log(`[${MODULE_NAME}][insertScenario] Scenario inserito correttamente: ${strategyParams.id}`);
      res.status(200).json({ message: 'Scenario inserito con successo' });
    } catch (error) {
      console.error(`[${MODULE_NAME}][insertScenario] Errore nella richiesta POST:`, error.message);
      res.status(500).json({ error: 'Errore interno durante l\'inserimento dello scenario' });
    }
  });

  // Aggiorna uno scenario esistente nella tabella strategy_runs
app.post('/updateScenarioResult', async (req, res) => {
    const dbManager = new DBManager();
    const { strategyParams, minDay, maxDay, capitaleFinale, profitto, efficienza } = req.body;
  
    // Validazione veloce
    if (!strategyParams || !strategyParams.id) {
      return res.status(400).json({ error: 'Parametro strategyParams.id obbligatorio' });
    }
  
    if (minDay == null || maxDay == null || capitaleFinale == null || profitto == null || efficienza == null) {
      return res.status(400).json({ error: 'Parametri minDay, maxDay, capitaleFinale, profitto, efficienza obbligatori' });
    }
  
    try {
      await dbManager.updateScenarioResult(strategyParams, minDay, maxDay, capitaleFinale, profitto, efficienza);
      console.log(`[${MODULE_NAME}][updateScenarioResult] Scenario aggiornato correttamente: ${strategyParams.id}`);
      res.status(200).json({ message: 'Scenario aggiornato con successo' });
    } catch (error) {
      console.error(`[${MODULE_NAME}][updateScenarioResult] Errore nella richiesta POST:`, error.message);
      res.status(500).json({ error: 'Errore interno durante l\'aggiornamento dello scenario' });
    }
  });
  
  // Inserisce una transazione BUY
app.post('/insertBuyTransaction', async (req, res) => {
    const dbManager = new DBManager();
    const { scenarioId, element, capitaleInvestito, prezzo, operation, MA, orderId, NumAzioni } = req.body;
  
    // Validazione base
    if (!scenarioId || !prezzo || !orderId) {
      return res.status(400).json({ error: 'Parametri scenarioId, prezzo e orderId obbligatori' });
    }
  
    try {
      await dbManager.insertBuyTransaction(scenarioId, element, capitaleInvestito, prezzo, operation , MA, orderId, NumAzioni);
      console.log(`[${MODULE_NAME}][insertBuyTransaction] Transazione BUY inserita correttamente per ScenarioID: ${scenarioId} orderId ${orderId}`);
      res.status(200).json({ message: 'Transazione BUY inserita con successo scenarioId '+ scenarioId});
    } catch (error) {
      console.error(`[${MODULE_NAME}][insertBuyTransaction] Errore nella richiesta POST:`, error.message);
      res.status(500).json({ error: 'Errore interno durante l\'inserimento della transazione BUY '+error.message});
    }
  });
  
// Inserisce una transazione SELL
app.post('/insertSellTransaction', async (req, res) => {
    const dbManager = new DBManager();
    const { scenarioId, element, state, result } = req.body;
  
    // Validazione base
    if (!scenarioId || !element || !state || !result) {
      return res.status(400).json({ error: 'Parametri scenarioId, element, state e result obbligatori' });
    }
  
    try {
      await dbManager.insertSellTransaction(scenarioId, element, state, result);
      console.log(`[${MODULE_NAME}][insertSellTransaction] Transazione SELL inserita correttamente per ScenarioID: ${scenarioId}`);
      res.status(200).json({ message: 'Transazione SELL inserita con successo' });
    } catch (error) {
      console.error(`[${MODULE_NAME}][insertSellTransaction] Errore nella richiesta POST:`, error.message);
      res.status(500).json({ error: 'Errore interno durante l\'inserimento della transazione SELL' });
    }
  });
  

// Recupera tutte le strategie attive per un simbolo
app.get('/getActiveStrategies/:symbol', async (req, res) => {
    const dbManager = new DBManager();
    const symbol = req.params.symbol;
  
    if (!symbol) {
      return res.status(400).json({ error: 'Parametro symbol obbligatorio nella URL' });
    }
  
    try {
      const strategies = await dbManager.getActiveStrategies(symbol);
      console.log(`[${MODULE_NAME}][getActiveStrategies] Recuperate ${strategies.length} strategie attive per il simbolo ${symbol}`);
      res.status(200).json(strategies);
    } catch (error) {
      console.error(`[${MODULE_NAME}][getActiveStrategies] Errore durante la richiesta GET:`, error.message);
      res.status(500).json({ error: 'Errore interno durante il recupero delle strategie attive' });
    }
  });

  app.get('/getActiveBots', async (req, res) => {
    try {
      const result = await dbManager.getActiveBots();
      res.status(200).json(result);
    } catch (err) {
      res.status(500).json({ error: 'Errore nel recupero dei bot attivi', message: err.message });
    }
  });
  
  app.get('/getTotalActiveCapital', async (req, res) => {
    try {
      const result = await dbManager.getTotalActiveCapital();
      res.json({ totalActiveCapital: result });
    } catch (err) {
      res.status(500).json({ error: 'Errore nel recupero del capitale attivo', message: err.message });
    }
  });

    // GET /getStrategyCapitalAndOrders/:id
  app.get('/getStrategyCapitalAndOrders/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await dbManager.getStrategyCapitalAndOrders(id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Errore nel recupero dei dati', message: err.message });
    }
  });

  // GET /lastTransaction/:scenarioId
  app.get('/lastTransaction/:scenarioId', async (req, res) => {
    const scenarioId = req.params.scenarioId;

    if (!scenarioId) {
      return res.status(400).json({ error: 'scenarioId mancante' });
    }

    try {
      const result = await dbManager.getLastTransactionByScenario(scenarioId);
      res.json(result || {});
    } catch (err) {
      res.status(500).json({ error: 'Errore nel recupero transazione', message: err.message });
    }
  });

  app.get('/getScenarioIdByOrderId/:orderId', async (req, res) => {
    const orderId = req.params.orderId;

    if (!orderId) {
      return res.status(400).json({ error: 'orderId mancante' });
    }

    try {
      const result = await dbManager.getScenarioIdByOrderId(orderId);
      res.json(result || {});
    } catch (err) {
      res.status(500).json({ error: 'Errore nel recupero transazione', message: err.message });
    }
  });

  // POST /bot/insertOrUpdate
  app.post('/bot/registra', async (req, res) => {
    const { name, ver } = req.body;

    if (!name || !ver ) {
      return res.status(400).json({ error: 'Parametri richiesti: name, ver' });
    }

    try {
      const botId = await dbManager.insertOrUpdateBotByNameVer(name, ver);
      res.json({ success: true, botId });
    } catch (err) {
      res.status(500).json({ error: 'Errore gestione bot', message: err.message });
    }
  });

  app.post('/updateStrategyCapitalAndOrders', async (req, res) => {
    const { id, capitaleInvestito, openOrders} = req.body;
  
    if (!id) {
      return res.status(400).json({ error: 'Parametri richiesti: id' });
    }
  
    try {
      await dbManager.updateStrategyCapitalAndOrders(id, capitaleInvestito, openOrders);
      res.json({ status: 'OK', message: 'Strategia aggiornata con successo' });
    } catch (err) {
      res.status(500).json({ error: 'Errore durante aggiornamento strategia', message: err.message });
    }
  });

  app.get('/transactions/:orderId', async (req, res) => {
  const { orderId } = req.params;

  try {
    const transactions = await dbManager.getTransaction(orderId);

    if (transactions.length === 0) {
      return res.status(404).json({ message: 'Nessuna transazione trovata' });
    }

    res.status(200).json(transactions);
  } catch (error) {
    console.error('❌ Errore endpoint /transactions/:orderId:', error.message);
    res.status(500).json({ error: 'Errore del server' });
  }
});


  app.post('/getTransactionCount', async (req, res) => {
    try {
      const { strategyId, orderIds } = req.body;
  
      if (!strategyId || !Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ error: 'strategyId and non-empty orderIds array are required.' });
      }
  
      const count = await dbManager.countTransactionsByStrategyAndOrders(strategyId, orderIds);
  
      return res.status(200).json({ count });
    } catch (error) {
      console.error(`[getTransactionCount] Errore durante il conteggio delle transazioni: ${error.message}`);
      return res.status(500).json({ error: 'Errore durante il conteggio delle transazioni.' });
    }
  });


  app.post('/simul/account', async (req, res) => {
    try {
      const result = await dbManager.updateAccount(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante l\'update dell\'account' });
    }
  });

  app.get('/simul/account', async (req, res) => {
    try {
      const account = await dbManager.getAccountAsJson();

      if (!account) {
        return res.status(404).json({ error: 'Account non trovato' });
      }
      res.json(account);
    } catch (error) {
      console.error(`[GET /simul/account] Errore: ${error.message}`);
      res.status(500).json({ error: 'Errore interno' });
    }
  });

  app.get('/simul/positions', async (req, res) => {
  try {
    const result = await dbManager.getAllPositionsAsJson();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Errore durante la lettura delle posizioni' });
  }
});

  app.post('/simul/positions', async (req, res) => {
    try {
      const result = await dbManager.insertPosition(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante l\'inserimento della posizione' });
    }
  });

  app.put('/simul/positions', async (req, res) => {
    try {
      const result = await dbManager.updatePosition(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Errore durante l\'aggiornamento della posizione' });
    }
  });

  // Inserimento ordine simulato (verrà salvato in DB in futuro)
  app.post('/simul/orders', async (req, res) => {
    try {
      const result = await dbManager.insertSimulatedOrder(req.body);
      res.status(200).json(result);
    } catch (err) {
      console.error(`[insertOrder] ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

    // Inserimento ordine simulato (verrà salvato in DB in futuro)
  app.put('/simul/orders', async (req, res) => {
    try {
      const result = await dbManager.updateSimulOrder(req.body);
      res.status(200).json(result);
    } catch (err) {
      console.error(`[insertOrder] ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // Inserimento ordine simulato (verrà salvato in DB in futuro)
  app.get('/simul/orders', async (req, res) => {
  try {
    const result = await dbManager.getAllOrdersAsJson();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Errore durante la lettura delle posizioni' });
  }
});

    // Inserimento ordine simulato (verrà salvato in DB in futuro)
app.post('/insertOrder', async (req, res) => {
  try {
    const result = await dbManager.insertOrder(req.body);
    res.status(200).json(result);
  } catch (err) {
    console.error(`[insertOrder] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

    // Aggiornamento ordine simulato (verrà salvato in DB in futuro)
  app.post('/updateStrategies', async (req, res) => {
    try {
      const result = await dbManager.updateStrategies(req.body);
      res.status(200).json(result);
    } catch (err) {
      console.error(`[updateStrategies] ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

    // Aggiornamento ordine simulato (verrà salvato in DB in futuro)
  app.post('/updateTransaction', async (req, res) => {
    try {
      const result = await dbManager.updateTransaction(req.body);
      res.status(200).json(result);
    } catch (err) {
      console.error(`[updateTransaction] ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

    // Aggiornamento ordine simulato (verrà salvato in DB in futuro)
  app.post('/updateOrder', async (req, res) => {
    try {
      const result = await dbManager.updateOrder(req.body);
      res.status(200).json(result);
    } catch (err) {
      console.error(`[updateOrder] ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // Inserimento ordine simulato (verrà salvato in DB in futuro)
  app.post('/insertSimulatedOrder', async (req, res) => {
    try {
      const result = await dbManager.insertSimulatedOrder(req.body);
      res.status(200).json(result);
    } catch (err) {
      console.error(`[insertSimulatedOrder] ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  

app.listen(port, () => {
  console.log(`[DBManager] Server in ascolto sulla porta ${port}`);
});
