// shared/dbManager.js
const mysql = require('mysql2/promise');
const createLogger = require('../shared/logger');

// Costanti globali di modulo
const MODULE_NAME = 'DBManager';
const MODULE_VERSION = '1.1';
const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL || 'info');

class DBManager {

  constructor() {
    this.host = process.env.DB_HOST || 'localhost';
    this.port = process.env.DB_PORT || '3306';
    this.user = process.env.DB_USER || 'root';
    this.password = process.env.DB_PASSWORD || '';
    this.database = process.env.DB_NAME || 'Trading';

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

  // Inserisce o aggiorna un bot sulla base dei campi name + ver
  async insertOrUpdateBotByNameVer(name, ver) {
    const connection = await this.getDbConnection();

    try {
      // Verifica se esiste già un bot con stesso name e ver
      const [rows] = await connection.query(
        `SELECT id FROM Bots WHERE name = ? AND ver = ?`,
        [name, ver]
      );

      if (rows.length > 0) {
        const existingId = rows[0].id;

        // Aggiorna solo date_release
        await connection.query(
          `UPDATE Bots SET date_release = NOW() WHERE id = ?`,
          [existingId]
        );

        logger.log(`[insertOrUpdateBotByNameVer] Bot esistente aggiornato (id=${existingId})`);
        return existingId;
      }

      // Altrimenti crea un nuovo bot
      const [result] = await connection.query(
        `INSERT INTO Bots (name, ver, status, date_release, totalProfitLoss)
        VALUES (?, ?, 'inactive', NOW(), 0)`,
        [name, ver]
      );

      logger.log(`[insertOrUpdateBotByNameVer] Bot creato con id ${result.insertId}`);
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

  async  updateStrategies(strategiesUpdate) {
  
    if (!strategiesUpdate.id) {
      logger.error('[updateStrategies] ID mancante o nessun campo da aggiornare');
      return null;
    }
  
    const setClauses = Object.keys(strategiesUpdate)
                        .filter(field => field !== 'id')
                        .map(field => `${field} = ?`)
                        .join(', ');
    const values = Object.keys(strategiesUpdate)
                        .filter(field => field !== 'id')
                        .map(field => strategiesUpdate[field]);
  
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
  
    const setClauses = Object.keys(transactionUpdate)
                        .filter(field => field !== 'id')
                        .map(field => `${field} = ?`)
                        .join(', ');
    const values = Object.keys(transactionUpdate)
                        .filter(field => field !== 'id')
                        .map(field => transactionUpdate[field]);
  
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
  
    const setClauses = Object.keys(orderUpdate)
                        .filter(field => field !== 'id')
                        .map(field => `${field} = ?`)
                        .join(', ');
    const values = Object.keys(orderUpdate)
                        .filter(field => field !== 'id')
                        .map(field => orderUpdate[field]);
  
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



async insertSimulatedOrder(envelop) {
    const order = envelop.order;

    logger.log(`[insertSimulatedOrder] Ordine ricevuto da inserire nel DB : ${JSON.stringify(order)}`);
    const connection = await this.getDbConnection();

    try {
      const query = `
        INSERT INTO OrdersSimulated (
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
