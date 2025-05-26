// shared/dbManager.js
const mysql = require('mysql2/promise');
const createLogger = require('../shared/logger');

// Costanti globali di modulo
const MODULE_NAME = 'DBManager';
const MODULE_VERSION = '1.1';
const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL || 'info');

class DBManager {

  constructor() {
    this.host = process.env.MYSQL_HOST || 'localhost';
    this.port = process.env.MYSQL_PORT || '3306';
    this.user = process.env.MYSQL_USER || 'root';
    this.password = process.env.MYSQL_PASSWORD || '';
    this.database = process.env.MYSQL_DATABASE || 'Trading';

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
  }

  // Apre una connessione al database
  async getDbConnection() {
    try {
      return await mysql.createConnection({
        host: this.host,
        port: this.port,
        user: this.user,
        password: this.password,
        database: this.database
      });
      logger.info('Connect to DB estabilished');
    } catch (err) {
      logger.error(`[getDbConnection] Errore apertura DB:`, err.message);
      throw err;
    } 
  }

  // Ritorna le informazioni del modulo
  getInfo() {
    return {
      module: MODULE_NAME,
      version: MODULE_VERSION,
      logLevel: process.env.LOG_LEVEL,
      status: 'OK'
    };
  }

    // Recupera il valore di un'impostazione attiva dalla tabella settings
    async getSettingValue(key) {
        logger.log(`[getSettingValue] Recupero setting attivo per chiave: ${key}`);
    
        const connection = await this.getDbConnection();
    
        try {
        const [rows] = await connection.query(
            `SELECT param_value FROM settings WHERE param_key = ? AND active = true LIMIT 1`,
            [key]
        );
    
        if (rows.length === 0) {
            logger.warning(`[getSettingValue] Nessun valore attivo trovato per chiave: ${key}`);
            return null;
        }
    
        return rows[0].param_value;
        } catch (err) {
            logger.error(`[getSettingValue] Errore select:`, err.message);
        throw err;
        } finally {
            await connection.end();
        }
    }
  

  // Inserisce uno scenario di strategia nella tabella strategy_runs
  async insertScenario(strategyParams, strategy) {
    const connection = await this.getDbConnection();
    const params_json = { TF: strategyParams.tf, MA: strategyParams.period, SL: strategyParams.SL, TP: strategyParams.TP };
    try {
      await connection.query(`
        INSERT INTO strategy_runs 
        (id, strategy, symbol, start_date, end_date, capital, status, started_at, params_json) 
        VALUES (?, ?, ?, ?, ?, ?, 'running', NOW(), ?)
      `, [
        strategyParams.id, strategy, strategyParams.symbol,
        strategyParams.startDate, strategyParams.endDate,
        strategyParams.capitaleIniziale, JSON.stringify(params_json)
      ]);
    } catch (err) {
      logger.error(`[insertScenario] Errore insert:`, err.message);
      throw err;
    } finally {
      await connection.end();
    }
  }

  // Aggiorna lo scenario a fine strategia
  async updateScenarioResult(strategyParams, minDay, maxDay, capitaleFinale, profitto, efficienza) {
    const connection = await this.getDbConnection();
    const profittoAnnuo = profitto ? profitto * 12 : 0;
    try {
      await connection.query(`
        UPDATE strategy_runs
        SET status = 'done', completed_at = NOW(),
            profit = ?, efficienza = ?, profittoAnnuo = ?, dayMin = ?, dayMax = ?
        WHERE id = ?
      `, [profitto, efficienza, profittoAnnuo, minDay, maxDay, strategyParams.id]);
    } catch (err) {
        logger.error(`[updateScenarioResult] Errore update:`, err.message);
      throw err;
    } finally {
      await connection.end();
    }
  }

  // Inserisce una transazione BUY
  async insertBuyTransaction(scenarioId, element, capitaleInvestito, prezzo, operation = 'BUY', MA, orderId, NumAzioni) {
    const connection = await this.getDbConnection();
    try {
      await connection.query(`
        INSERT INTO transazioni 
        (ScenarioID, operation, operationDate, Price, capitale, MA, orderId, NumAzioni)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [scenarioId, operation, this.formatDateForMySQL(element.t), prezzo, capitaleInvestito, MA, orderId, NumAzioni]);
    } catch (err) {
      logger.error(`[insertBuyTransaction] Errore insert:`, err.message);
      throw err;
    } finally {
      await connection.end();
    }
  }

  // Inserisce una transazione SELL
  async insertSellTransaction(scenarioId, element, state, result) {
    const connection = await this.getDbConnection();
    try {
      await connection.query(`
        INSERT INTO transazioni 
        (ScenarioID, operationDate, operation, Price, capitale, exit_reason, profitLoss, days)
        VALUES (?, ?, 'SELL', ?, ?, ?, ?, ?)`,
        [scenarioId, this.formatDateForMySQL(element.t), result.prezzo, state.capitaleLibero, result.motivo, result.profitLoss, result.days]);
    } catch (err) {
      logger.error(`[insertSellTransaction] Errore insert:`, err.message);
      throw err;
    } finally {
      await connection.end();
    }
  }

    // Restituisce l'ordine con orderId
    async getOrder(orderId) {  
      const connection = await this.getDbConnection();
      try {
        const [rows] = await connection.query(`
          SELECT * FROM orders 
          WHERE id = ? 
          ORDER BY id DESC 
          LIMIT 1
        `, [orderId]);
  
        return rows[0];
      } catch (err) {
        logger.error(`[getOrder] Errore select:`, err.message);
        throw err;
      } finally {
        await connection.end();
      }
    }

  // Restituisce l'ultima transazione per uno ScenarioID
  async getLastTransactionByScenario(scenarioId) {  
    const connection = await this.getDbConnection();
    try {
      const [rows] = await connection.query(`
        SELECT * FROM transazioni 
        WHERE ScenarioID = ? 
        ORDER BY id DESC 
        LIMIT 1
      `, [scenarioId]);

      return rows.length > 0 ? rows[0] : null;
    } catch (err) {
      logger.error(`[getLastTransactionByScenario] Errore select:`, err.message);
      throw err;
    } finally {
      await connection.end();
    }
  }

    // Recupera lo scenario Id di un certo ortdine
    async getScenarioIdByOrderId(orderId) {  
      const connection = await this.getDbConnection();
      try {
        const [rows] = await connection.query(`
          SELECT * FROM transazioni 
          WHERE orderId = ? 
          ORDER BY id DESC 
          LIMIT 1
        `, [orderId]);
  
        return rows.length > 0 ? rows[0] : null;
      } catch (err) {
        logger.error(`[getScenarioIdByOrderId] Errore select:`, err.message);
        throw err;
      } finally {
        await connection.end();
      }
    }

  async getActiveBots(){
    const connection = await this.getDbConnection();

    try {
      const [rows] = await connection.execute("SELECT * FROM bots WHERE status = 'active'");
      return rows;
    } catch (error) {
      logger.error('[getActiveBots] Errore durante il recupero dei bot attivi:', error);
      throw error;
    } finally {
      await connection.end();
    }

  }
  // Inserisce o aggiorna un bot sulla base dei campi name + ver
  async insertOrUpdateBotByNameVer(name, ver) {
    const connection = await this.getDbConnection();

    try {
      // Verifica se esiste già un bot con stesso name e ver
      const [rows] = await connection.query(
        `SELECT id FROM bots WHERE name = ? AND ver = ?`,
        [name, ver]
      );

      if (rows.length > 0) {
        const existingId = rows[0].id;

        // Aggiorna solo date_release
        await connection.query(
          `UPDATE bots SET date_release = NOW() WHERE id = ?`,
          [existingId]
        );

        logger.log(`[insertOrUpdateBotByNameVer] Bot esistente aggiornato (id=${existingId})`);
        return existingId;
      }

      // Altrimenti crea un nuovo bot
      const [result] = await connection.query(
        `INSERT INTO bots (name, ver, status, date_release, totalProfitLoss)
        VALUES (?, ?, 'inactive', NOW(), 0)`,
        [name, ver]
      );

      logger.log(`[insertOrUpdateBotByNameVer] bot creato con id ${result.insertId}`);
      return result.insertId;

    } catch (err) {
      logger.error(`[insertOrUpdateBotByNameVer] Errore:`, err.message);
      throw err;
    } finally {
      await connection.end();
    }
  }



// Recupera tutte le strategie attive, eventualmente filtrando per simbolo
async getActiveStrategies(symbol = null) {
  const connection = await this.getDbConnection();

  try {
    const [rows] = await connection.query(`SELECT * FROM vstrategies WHERE status = 'active'`);

    // Parsing del campo params + filtro se symbol è specificato
    const strategies = rows
      .map(row => {
        if (row.params) {
          try {
            row.params = JSON.parse(row.params);
          } catch (err) {
            logger.error(`[getActiveStrategies] Errore parsing JSON su params per id ${row.id}:`, err.message);
            row.params = {}; // fallback
          }
        }
        return row;
      })
      .filter(row => !symbol || row.symbol === symbol); // Applica il filtro solo se symbol è definito

    return strategies;

  } catch (err) {
    logger.error(`[getActiveStrategies] Errore select:`, err.message);
    throw err;
  } finally {
    await connection.end();
  }
}


  

  // Recupera la lista dei simboli
  async getSymbolsList() {
    const connection = await this.getDbConnection();
    try {
      const [rows] = await connection.query('SELECT name FROM Symbols');
      return rows.map(row => row.name);
    } catch (err) {
      logger.error(`[getSymbolsList] Errore select:`, err.message);
      throw err;
    } finally {
      await connection.end();
    }
  }

async resolveBotIdByName(name) {
  const connection = await this.getDbConnection();
  const [rows] = await connection.execute('SELECT id FROM bots WHERE name = ? LIMIT 1', [name]);
  await connection.end();
  if (rows.length > 0) {
    return rows[0].id;
  } else {
    throw new Error(`Bot con nome "${name}" non trovato`);
  }
}

async resolveSymbolIdByName(name) {
  const connection = await this.getDbConnection();
  const [rows] = await connection.execute('SELECT id FROM Symbols WHERE name = ? LIMIT 1', [name]);
  await connection.end();
  if (rows.length > 0) {
    return rows[0].id;
  } else {
    throw new Error(`Simbolo con nome "${name}" non trovato`);
  }
}

  async  updateStrategies(strategiesUpdate) {
  
    if (!strategiesUpdate.id) {
      logger.error('[updateStrategies] ID mancante o nessun campo da aggiornare');
      return null;
    }

    if (strategiesUpdate.idBotIn) {
      strategiesUpdate.idBotIn = await this.resolveBotIdByName(strategiesUpdate.idBotIn);
    }

    if (strategiesUpdate.idBotOut) {
      strategiesUpdate.idBotOut = await this.resolveBotIdByName(strategiesUpdate.idBotOut);
    }

    if (strategiesUpdate.idSymbol) {
      strategiesUpdate.idSymbol = await this.resolveSymbolIdByName(strategiesUpdate.idSymbol);
    }

    const excludedFields = ['id', 'TotalCommitted'];
    const fields = Object.keys(strategiesUpdate).filter(field => !excludedFields.includes(field));

    const setClauses = fields
      .map(field => `${field} = ?`)
      .join(', ');

    const values = fields.map(field => {
      if (field === 'params') {
        return JSON.stringify(strategiesUpdate[field]);
      }
      return strategiesUpdate[field];
    });
  
    const sql = `UPDATE strategies SET ${setClauses} WHERE id = ?`;
  
    try {
      const connection = await this.getDbConnection();
      await connection.execute(sql, [...values, strategiesUpdate.id]);
      await connection.end();
      logger.info(`[updateStrategies] Ordine ${strategiesUpdate.id} aggiornato con successo`);
      return { success: true, id:strategiesUpdate.id };
    } catch (error) {
      logger.error(`[updateStrategies] Errore: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async  updateTransaction(transactionUpdate) {
  
    if (!transactionUpdate.id) {
      logger.error('[updateTransaction] ID mancante o nessun campo da aggiornare');
      return null;
    }
  
    const fields = Object.keys(transactionUpdate).filter(field => field !== 'id');

    const setClauses = fields
      .map(field => `${field} = ?`)
      .join(', ');

    const values = fields.map(field => {
      if (field === 'operationDate') {
        return this.formatDateForMySQL(transactionUpdate[field]);
      }
      return transactionUpdate[field];
    });
  
    const sql = `UPDATE transazioni SET ${setClauses} WHERE id = ?`;
  
    try {
      const connection = await this.getDbConnection();
      await connection.execute(sql, [...values, transactionUpdate.id]);
      await connection.end();
      logger.info(`[updateOrder] Ordine ${transactionUpdate.id} aggiornato con successo`);
      return { success: true, id:transactionUpdate.id };
    } catch (error) {
      logger.error(`[updateOrder] Errore: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async  updateOrder(orderUpdate) {
  
    if (!orderUpdate.id) {
      logger.error('[updateOrder] ID mancante o nessun campo da aggiornare');
      return null;
    }

    const fields = Object.keys(orderUpdate).filter(field => field !== 'id');
    const setClauses = fields.map(field => `${field} = ?`).join(', ');

    const values = fields.map(field => {
      const value = orderUpdate[field];
      return field.endsWith('_at') && value
        ? this.formatDateForMySQL(value)
        : value;
    });
  
    const sql = `UPDATE orders SET ${setClauses} WHERE id = ?`;
  
    try {
      const connection = await this.getDbConnection();
      await connection.execute(sql, [...values, orderUpdate.id]);
      await connection.end();
      logger.info(`[updateOrder] Ordine ${orderUpdate.id} aggiornato con successo`);
      return { success: true, id:orderUpdate.id };
    } catch (error) {
      logger.error(`[updateOrder] Errore: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // Inserisce un ordine nella tabella orders
  async insertOrder(orderData) {

    const order=orderData;
    const connection = await this.getDbConnection();
    try {
      const query = `INSERT INTO orders (id, client_order_id, created_at, updated_at, submitted_at, filled_at, expired_at, 
          canceled_at, failed_at, replaced_at, replaced_by, replaces, asset_id, symbol, asset_class, notional, qty, 
          filled_qty, filled_avg_price, order_class, order_type, type, side, position_intent, time_in_force, 
          limit_price, stop_price, status, extended_hours, legs, trail_percent, trail_price, hwm, subtag, source, expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
      const values = [
        order.id,
        order.client_order_id,
        order.created_at ? new Date(order.created_at) : null,
        order.updated_at ? new Date(order.updated_at) : null,
        order.submitted_at ? new Date(order.submitted_at) : null,
        order.filled_at ? new Date(order.filled_at) : null,
        order.expired_at ? new Date(order.expired_at) : null,
        order.canceled_at ? new Date(order.canceled_at) : null,
        order.failed_at ? new Date(order.failed_at) : null,
        order.replaced_at ? new Date(order.replaced_at) : null,
        this.safe(order.replaced_by),
        this.safe(order.replaces),
        this.safe(order.asset_id),
        this.safe(order.symbol),
        this.safe(order.asset_class),
        this.safe(order.notional),
        this.safe(order.qty),
        this.safe(order.filled_qty),
        this.safe(order.filled_avg_price),
        this.safe(order.order_class),
        this.safe(order.order_type),
        this.safe(order.type),
        this.safe(order.side),
        this.safe(order.position_intent),
        this.safe(order.time_in_force),
        this.safe(order.limit_price),
        this.safe(order.stop_price),
        this.safe(order.status),
        this.safe(order.extended_hours ? 1 : 0),
        order.legs ? JSON.stringify(order.legs) : null,
        this.safe(order.trail_percent),
        this.safe(order.trail_price),
        this.safe(order.hwm),
        this.safe(order.subtag),
        this.safe(order.source),
        order.expires_at ? new Date(order.expires_at) : null
      ];
      await connection.query(query, values);
      logger.info(`[insertOrder] Ordine ${orderData.id} inserito con successo`);
      return (orderData.id);
    } catch (err) {
      logger.error(`[insertOrder] Errore insert ordine:`, err.message);
      throw err;
    } finally {
      await connection.end();
    }
  }

  // Ritorna la somma del capitale delle strategie attive
async getTotalActiveCapital() {
  const connection = await this.getDbConnection();

  try {
    const [rows] = await connection.query(`
      SELECT SUM(CapitaleInvestito) + SUM(OpenOrders) AS totalCapital 
      FROM strategies 
      WHERE status = 'active'
    `);

    return rows[0].totalCapital || 0;
  } catch (err) {
    logger.error(`[getTotalActiveCapital] Errore SELECT:`, err.message);
    throw err;
  } finally {
    await connection.end();
  }
}

// Aggiorna capitaleInvestito e OpenOrders per una strategia specifica, solo se forniti
async updateStrategyCapitalAndOrders(id, capitaleInvestito, openOrders) {
  const connection = await this.getDbConnection();

  try {
    if (!id) {
      throw new Error('ID strategia mancante');
    }

    const updates = [];
    const values = [];

    if (capitaleInvestito !== undefined && capitaleInvestito !== null) {
      updates.push('capitaleInvestito = CapitaleInvestito + ?');
      values.push(capitaleInvestito);
    }

    if (openOrders !== undefined && openOrders !== null) {
      updates.push('OpenOrders = OpenOrders + ?');
      values.push(openOrders);
    }

    if (updates.length === 0) {
      throw new Error('Nessun campo da aggiornare');
    }

    const query = `
      UPDATE strategies
      SET ${updates.join(', ')}
      WHERE id = ?
    `;
    values.push(id);

    await connection.query(query, values);
  } catch (err) {
    logger.error(`[updateStrategyCapitalAndOrders] Errore UPDATE:`, err.message);
    throw err;
  } finally {
    await connection.end();
  }
}

 parseParamsInRows(rows) {
  return rows.map(row => {
    if (row.params) {
      try {
        row.params = JSON.parse(row.params);
      } catch (err) {
        logger.warning(`[parseParamsInRows] Errore nel parsing JSON per ID ${row.id}: ${err.message}`);
      }
    }
    return row;
  });
}

// Recupera transazione con orderId
async getTransaction(orderId) {
  const connection = await this.getDbConnection();
  try {
    const [rows] = await connection.execute(
      `SELECT * FROM transazioni WHERE orderId = ?`,
      [orderId]
    );
    return rows;
  } catch (error) {
    console.error('❌ Errore durante la query getTransaction:', error.message);
    return [];
  } finally {
    await connection.end();
  }
}


// Verifico quanti ordini aperti appartengono a StrategyId
async  countTransactionsByStrategyAndOrders(scenarioId, orderIds) {
  const connection = await this.getDbConnection();
  try {
    const [rows] = await connection.execute(
      `SELECT COUNT(*) AS count FROM transazioni WHERE scenarioId = ? AND orderId IN (${orderIds.map(() => '?').join(',')})`,
      [scenarioId, ...orderIds]
    );
    return rows[0].count;
  } catch (error) {
    console.error('Errore durante la query:', error.message);
    return 0;
  } finally {
    await connection.end();
  }
}

// Recupera capitaleInvestito e OpenOrders per una strategia specifica
async getStrategyCapitalAndOrders(id) {
  const connection = await this.getDbConnection();

  try {
    const [rows] = await connection.query(
      `SELECT *  FROM vstrategies WHERE status = "active"`,
    );

    const totalCommitted = rows.reduce((acc, row) => {
      const capitale = Number(row.CapitaleInvestito) || 0;
      const ordini = Number(row.OpenOrders) || 0;
      return acc + capitale + ordini;
    }, 0);

    const risultati = rows
    .filter(row => (Number(row.id) === Number(id)))
    .map(row => {
      return {
        ...row,
        TotalCommitted: totalCommitted
      };
    });

    if (risultati === 0) {
      logger.warning(`[parseParamsInRows] Nessuna strategia trovata con id: ${id}`);
      throw new Error(`Nessuna strategia trovata con id: ${id}`);
    }

    return this.parseParamsInRows(risultati);
  } catch (err) {
    logger.error(`[getStrategyCapitalAndOrders] Errore SELECT:`, err.message);
    throw err;
  } finally {
    await connection.end();
  }
}

async  updateAccount(accountUpdate) {
  if (!accountUpdate.id) {
    logger.error('[updateAccount] ID mancante');
    return { success: false, error: 'ID obbligatorio per aggiornare l\'account' };
  }

  const fields = Object.keys(accountUpdate).filter(
    key => key !== 'id' && accountUpdate[key] !== undefined
  );

  if (fields.length === 0) {
    logger.warn('[updateAccount] Nessun campo da aggiornare');
    return { success: false, error: 'Nessun campo da aggiornare' };
  }

  const setClause = fields.map(field => `${field} = ?`).join(', ');
  const values = fields.map(field => {
    const value = accountUpdate[field];
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'string' && !isNaN(value)) return parseFloat(value);
    if (field.endsWith('_at') && value) return new Date(value);
    return value;
  });

  const sql = `UPDATE Simul.Account SET ${setClause} WHERE id = ?`;

  try {
    const connection = await this.getDbConnection();
    await connection.execute(sql, [...values, accountUpdate.id]);
    await connection.end();

    logger.info(`[updateAccount] Account ${accountUpdate.id} aggiornato`);
    return { success: true };
  } catch (error) {
    logger.error(`[updateAccount] Errore: ${error.message}`);
    return { success: false, error: error.message };
  }
}


async  getAccountAsJson() {
  const connection = await this.getDbConnection();

  try {
    const [rows] = await connection.execute('SELECT * FROM Simul.Account LIMIT 1');
    if (rows.length === 0) return null;

    const row = rows[0];

    return {
      id: row.id,
      account_number: row.account_number,
      status: row.status,
      currency: row.currency,
      buying_power: row.buying_power?.toString(),
      cash: row.cash?.toString(),
      cash_withdrawable: row.cash_withdrawable?.toString(),
      cash_transferable: row.cash_transferable?.toString(),
      portfolio_value: row.portfolio_value?.toString(),
      pattern_day_trader: !!row.pattern_day_trader,
      trading_blocked: !!row.trading_blocked,
      transfers_blocked: !!row.transfers_blocked,
      account_blocked: !!row.account_blocked,
      created_at: row.created_at?.toISOString(),
      trade_suspended_by_user: !!row.trade_suspended_by_user,
      multiplier: row.multiplier,
      shorting_enabled: !!row.shorting_enabled,
      equity: row.equity?.toString(),
      last_equity: row.last_equity?.toString(),
      long_market_value: row.long_market_value?.toString(),
      short_market_value: row.short_market_value?.toString(),
      initial_margin: row.initial_margin?.toString(),
      maintenance_margin: row.maintenance_margin?.toString(),
      last_maintenance_margin: row.last_maintenance_margin?.toString(),
      sma: row.sma?.toString(),
      daytrade_count: row.daytrade_count
    };
  } catch (error) {
    logger.error(`[getAccountAsJson] Errore durante la lettura: ${error.message}`);
    throw error;
  } finally {
    await connection.end();
  }
}

async insertPosition(position) {
  const connection = await this.getDbConnection();

  const sql = `
    INSERT INTO Simul.Positions (
      asset_id,
      symbol,
      exchange,
      asset_class,
      qty,
      avg_entry_price,
      side,
      market_value,
      cost_basis,
      unrealized_pl,
      unrealized_plpc,
      unrealized_intraday_pl,
      unrealized_intraday_plpc,
      current_price,
      lastday_price,
      change_today,
      qty_available
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    position.asset_id,
    position.symbol,
    position.exchange || null,
    position.asset_class || null,
    parseFloat(position.qty),
    parseFloat(position.avg_entry_price),
    position.side,
    parseFloat(position.market_value),
    parseFloat(position.cost_basis),
    parseFloat(position.unrealized_pl),
    parseFloat(position.unrealized_plpc),
    parseFloat(position.unrealized_intraday_pl),
    parseFloat(position.unrealized_intraday_plpc),
    parseFloat(position.current_price),
    parseFloat(position.lastday_price),
    parseFloat(position.change_today),
    parseFloat(position.qty_available)
  ];

  try {
    await connection.execute(sql, values);
    logger.info(`[insertPosition] Posizione ${position.symbol} inserita con successo`);
    return { success: true, symbol: position.symbol };
  } catch (error) {
    logger.error(`[insertPosition] Errore: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    await connection.end();
  }
}

async  updatePosition(positionUpdate) {
  if (!positionUpdate.asset_id || !positionUpdate.symbol) {
    logger.error('[updatePosition] id o symbol mancante');
    return { success: false, error: 'Chiavi primarie mancanti' };
  }

  const fields = Object.keys(positionUpdate).filter(
    key => key !== 'asset_id' && key !== 'symbol' && positionUpdate[key] !== undefined
  );

  if (fields.length === 0) {
    logger.warn('[updatePosition] Nessun campo da aggiornare');
    return { success: false, error: 'Nessun campo da aggiornare' };
  }

  const setClause = fields.map(field => `${field} = ?`).join(', ');
  const values = fields.map(field => {
    let value = positionUpdate[field];

    if (value === undefined) return null; // evita errore di bind

    if (typeof value === 'boolean') return value ? 1 : 0;
    if (field.endsWith('_at') && value) return new Date(value);
    if (typeof value === 'object' && value !== null && field === 'legs') return JSON.stringify(value);
    if (typeof value === 'string' && !isNaN(value)) return parseFloat(value);
    
    return value;
  });


  const sql = `
    UPDATE Simul.Positions
    SET ${setClause}
    WHERE asset_id = ? AND symbol = ?
  `;

  try {
    const connection = await this.getDbConnection();
    await connection.execute(sql, [...values, positionUpdate.asset_id, positionUpdate.symbol]);
    await connection.end();

    logger.info(`[updatePosition] Posizione ${positionUpdate.symbol} aggiornata`);
    return { success: true };
  } catch (error) {
    logger.error(`[updatePosition] Errore: ${error.message}`);
    return { success: false, error: error.message };
  }
}


async getAllPositionsAsJson() {
  const connection = await this.getDbConnection();

  try {
    const [rows] = await connection.execute('SELECT * FROM Simul.Positions where softDel=0');

    const positions = rows.map(row => ({
      asset_id: row.asset_id,
      symbol: row.symbol,
      exchange: row.exchange,
      asset_class: row.asset_class,
      qty: row.qty.toString(),
      avg_entry_price: row.avg_entry_price.toString(),
      side: row.side,
      market_value: row.market_value.toString(),
      cost_basis: row.cost_basis.toString(),
      unrealized_pl: row.unrealized_pl.toString(),
      unrealized_plpc: row.unrealized_plpc.toString(),
      unrealized_intraday_pl: row.unrealized_intraday_pl.toString(),
      unrealized_intraday_plpc: row.unrealized_intraday_plpc.toString(),
      current_price: row.current_price.toString(),
      lastday_price: row.lastday_price.toString(),
      change_today: row.change_today.toString(),
      qty_available: row.qty_available.toString(),
      softDel: row.softDel.toString()
    }));

    return positions;
  } catch (error) {
    logger.error(`[getAllPositionsAsJson] Errore: ${error.message}`);
    throw error;
  } finally {
    await connection.end();
  }
}

async  getAllOrdersAsJson() {
  const connection = await this.getDbConnection();

  try {
    const [rows] = await connection.execute('SELECT * FROM Simul.Orders');

    const orders = rows.map(row => ({
      id: row.id,
      client_order_id: row.client_order_id,
      created_at: row.created_at?.toISOString(),
      updated_at: row.updated_at?.toISOString(),
      submitted_at: row.submitted_at?.toISOString(),
      filled_at: row.filled_at?.toISOString(),
      expired_at: row.expired_at?.toISOString(),
      canceled_at: row.canceled_at?.toISOString(),
      failed_at: row.failed_at?.toISOString(),
      replaced_at: row.replaced_at?.toISOString(),
      replaced_by: row.replaced_by,
      replaces: row.replaces,
      asset_id: row.asset_id,
      symbol: row.symbol,
      asset_class: row.asset_class,
      notional: row.notional?.toString(),
      qty: row.qty?.toString(),
      filled_qty: row.filled_qty?.toString(),
      filled_avg_price: row.filled_avg_price?.toString(),
      order_class: row.order_class,
      order_type: row.order_type,
      type: row.type,
      side: row.side,
      time_in_force: row.time_in_force,
      limit_price: row.limit_price?.toString(),
      stop_price: row.stop_price?.toString(),
      status: row.status,
      extended_hours: !!row.extended_hours,
      legs: row.legs ? JSON.parse(row.legs) : null,
      trail_percent: row.trail_percent?.toString(),
      trail_price: row.trail_price?.toString(),
      hwm: row.hwm,
      subtag: row.subtag,
      source: row.source
    }));

    return orders;
  } catch (error) {
    logger.error(`[getAllOrdersAsJson] Errore: ${error.message}`);
    throw error;
  } finally {
    await connection.end();
  }
}

async  updateSimulOrder(orderUpdate) {
  if (!orderUpdate.id) {
    logger.error('[updateOrder] ID mancante');
    return { success: false, error: 'Campo id obbligatorio' };
  }

  const fields = Object.keys(orderUpdate).filter(
    key => key !== 'id' && orderUpdate[key] !== undefined
  );

  if (fields.length === 0) {
    logger.warn('[updateOrder] Nessun campo da aggiornare');
    return { success: false, error: 'Nessun campo da aggiornare' };
  }

  const setClause = fields.map(field => `${field} = ?`).join(', ');

  const values = fields.map(field => {
    const value = orderUpdate[field];

    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'object' && field === 'legs') return JSON.stringify(value);
    if (field.endsWith('_at') && value) return new Date(value);
    if (typeof value === 'string' && !isNaN(value)) return parseFloat(value);
    return value;
  });

  const sql = `UPDATE Simul.Orders SET ${setClause} WHERE id = ?`;

  try {
    const connection = await this.getDbConnection();
    await connection.execute(sql, [...values, orderUpdate.id]);
    await connection.end();

    logger.info(`[updateOrder] Ordine ${orderUpdate.id} aggiornato`);
    return { success: true };
  } catch (error) {
    logger.error(`[updateOrder] Errore: ${error.message}`);
    return { success: false, error: error.message };
  }
}


async insertSimulatedOrder(envelop) {
    const order = envelop;

    logger.log(`[insertSimulatedOrder] Ordine ricevuto da inserire nel DB : ${JSON.stringify(order)}`);
    const connection = await this.getDbConnection();

    try {
      const query = `
        INSERT INTO Simul.Orders (
          id, client_order_id, created_at, updated_at, submitted_at, filled_at, expired_at, canceled_at,
          failed_at, replaced_at, replaced_by, replaces, asset_id, symbol, asset_class, notional, qty,
          filled_qty, filled_avg_price, order_class, order_type, type, side, time_in_force,
          limit_price, stop_price, status, extended_hours, legs, trail_percent, trail_price,
          hwm, subtag, source
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `;
      

      const values = [
        this.safe(order.id),
        this.safe(order.client_order_id),
        this.safe(this.formatDateForMySQL(order.created_at)),
        this.safe(this.formatDateForMySQL(order.updated_at)),
        this.safe(this.formatDateForMySQL(order.submitted_at)),
        this.safe(this.formatDateForMySQL(order.filled_at)),
        this.safe(this.formatDateForMySQL(order.expired_at)),
        this.safe(this.formatDateForMySQL(order.canceled_at)),
        this.safe(this.formatDateForMySQL(order.failed_at)),
        this.safe(this.formatDateForMySQL(order.replaced_at)),
        this.safe(order.replaced_by),
        this.safe(order.replaces),
        this.safe(order.asset_id),
        this.safe(order.symbol),
        this.safe(order.asset_class),
        this.safe(order.notional),
        this.safe(order.qty),
        this.safe(order.filled_qty),
        this.safe(order.filled_avg_price),
        this.safe(order.order_class),
        this.safe(order.order_type),
        this.safe(order.type),
        this.safe(order.side),
        this.safe(order.time_in_force),
        this.safe(order.limit_price),
        this.safe(order.stop_price),
        this.safe(order.status),
        order.extended_hours ? 1 : 0,
        order.legs ? JSON.stringify(order.legs) : null,
        this.safe(order.trail_percent),
        this.safe(order.trail_price),
        this.safe(order.hwm),
        this.safe(order.subtag),
        this.safe(order.source)
      ];

      await connection.execute(query, values);
      logger.info(`[insertSimulatedOrder] Ordine ${order.id} inserito con successo`);
      return (order.id);
    } catch (err) {
      logger.error(`[insertSimulatedOrder] Errore inserimento ordine: ${err.message}`);
      throw err;
    } finally {
      await connection.end();
    }

}


  safe(val) {
    return val === undefined ? null : val;
  }



  // Formatta una data per MySQL
  formatDateForMySQL(date) {
    if (!date) return null;
    
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

}

module.exports = DBManager;
