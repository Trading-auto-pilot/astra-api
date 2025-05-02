// shared/dbManager.js
const mysql = require('mysql2/promise');

// Costanti globali di modulo
const MODULE_NAME = 'DBManager';
const MODULE_VERSION = '1.0';

class DBManager {

  constructor() {
    this.host = process.env.DB_HOST || 'localhost';
    this.user = process.env.DB_USER || 'root';
    this.password = process.env.DB_PASSWORD || '';
    this.database = process.env.DB_NAME || 'Trading';
  }

  // Apre una connessione al database
  async getDbConnection() {
    try {
      return await mysql.createConnection({
        host: this.host,
        user: this.user,
        password: this.password,
        database: this.database
      });
    } catch (err) {
      console.error(`[${MODULE_NAME}][getDbConnection] Errore apertura DB:`, err.message);
      throw err;
    }
  }

  // Ritorna le informazioni del modulo
  getInfo() {
    return {
      module: MODULE_NAME,
      version: MODULE_VERSION,
      status: 'OK'
    };
  }

    // Recupera il valore di un'impostazione attiva dalla tabella settings
    async getSettingValue(key) {
        console.log(`[${MODULE_NAME}][getSettingValue] Recupero setting attivo per chiave: ${key}`);
    
        const connection = await this.getDbConnection();
    
        try {
        const [rows] = await connection.query(
            `SELECT param_value FROM settings WHERE param_key = ? AND active = true LIMIT 1`,
            [key]
        );
    
        if (rows.length === 0) {
            console.warn(`[${MODULE_NAME}][getSettingValue] Nessun valore attivo trovato per chiave: ${key}`);
            return null;
        }
    
        return rows[0].param_value;
        } catch (err) {
            console.error(`[${MODULE_NAME}][getSettingValue] Errore select:`, err.message);
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
      console.error(`[${MODULE_NAME}][insertScenario] Errore insert:`, err.message);
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
      console.error(`[${MODULE_NAME}][updateScenarioResult] Errore update:`, err.message);
      throw err;
    } finally {
      await connection.end();
    }
  }

  // Inserisce una transazione BUY
  async insertBuyTransaction(scenarioId, element, state, result, operation = 'BUY') {
    const connection = await this.getDbConnection();
    try {
      await connection.query(`
        INSERT INTO transazioni 
        (ScenarioID, operation, operationDate, Price, capitale, days, MA)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [scenarioId, operation, this.formatDateForMySQL(element.t), result.prezzo, state.capitaleInvestito, result.days, result.MA]);
    } catch (err) {
      console.error(`[${MODULE_NAME}][insertBuyTransaction] Errore insert:`, err.message);
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
      console.error(`[${MODULE_NAME}][getLastTransactionByScenario] Errore select:`, err.message);
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

        console.log(`[${MODULE_NAME}][insertOrUpdateBotByNameVer] Bot esistente aggiornato (id=${existingId})`);
        return existingId;
      }

      // Altrimenti crea un nuovo bot
      const [result] = await connection.query(
        `INSERT INTO Bots (name, ver, status, date_release, totalProfitLoss)
        VALUES (?, ?, 'inactive', NOW(), 0)`,
        [name, ver]
      );

      console.log(`[${MODULE_NAME}][insertOrUpdateBotByNameVer] Bot creato con id ${result.insertId}`);
      return result.insertId;

    } catch (err) {
      console.error(`[${MODULE_NAME}][insertOrUpdateBotByNameVer] Errore:`, err.message);
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
      console.error(`[${MODULE_NAME}][insertSellTransaction] Errore insert:`, err.message);
      throw err;
    } finally {
      await connection.end();
    }
  }

// Recupera tutte le strategie attive per un simbolo e parsifica i parametri JSON
async getActiveStrategies(symbol) {
    const connection = await this.getDbConnection();
    try {
      const [rows] = await connection.query(`SELECT * FROM vstrategies WHERE status = 'active' AND symbol = ?`, [symbol]);
  
      // Parsing del campo params
      const strategies = rows.map(row => {
        if (row.params) {
          try {
            row.params = JSON.parse(row.params);
          } catch (err) {
            console.error(`[${MODULE_NAME}][getActiveStrategies] Errore parsing JSON su params per id ${row.id}:`, err.message);
            row.params = {}; // fallback
          }
        }
        return row;
      });
  
      return strategies;
  
    } catch (err) {
      console.error(`[${MODULE_NAME}][getActiveStrategies] Errore select:`, err.message);
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
      console.error(`[${MODULE_NAME}][getSymbolsList] Errore select:`, err.message);
      throw err;
    } finally {
      await connection.end();
    }
  }

  // Inserisce un ordine nella tabella orders
  async insertOrder(orderData) {
    const connection = await this.getDbConnection();
    try {
      const query = `INSERT INTO orders (id, client_order_id, created_at, updated_at, submitted_at, filled_at, expired_at, 
          canceled_at, failed_at, replaced_at, replaced_by, replaces, asset_id, symbol, asset_class, notional, qty, 
          filled_qty, filled_avg_price, order_class, order_type, type, side, position_intent, time_in_force, 
          limit_price, stop_price, status, extended_hours, legs, trail_percent, trail_price, hwm, subtag, source, expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
      const values = [
        orderData.id,
        orderData.client_order_id,
        orderData.created_at ? new Date(orderData.created_at) : null,
        orderData.updated_at ? new Date(orderData.updated_at) : null,
        orderData.submitted_at ? new Date(orderData.submitted_at) : null,
        orderData.filled_at ? new Date(orderData.filled_at) : null,
        orderData.expired_at ? new Date(orderData.expired_at) : null,
        orderData.canceled_at ? new Date(orderData.canceled_at) : null,
        orderData.failed_at ? new Date(orderData.failed_at) : null,
        orderData.replaced_at ? new Date(orderData.replaced_at) : null,
        orderData.replaced_by,
        orderData.replaces,
        orderData.asset_id,
        orderData.symbol,
        orderData.asset_class,
        orderData.notional,
        orderData.qty,
        orderData.filled_qty,
        orderData.filled_avg_price,
        orderData.order_class,
        orderData.order_type,
        orderData.type,
        orderData.side,
        orderData.position_intent,
        orderData.time_in_force,
        orderData.limit_price,
        orderData.stop_price,
        orderData.status,
        orderData.extended_hours ? 1 : 0,
        orderData.legs ? JSON.stringify(orderData.legs) : null,
        orderData.trail_percent,
        orderData.trail_price,
        orderData.hwm,
        orderData.subtag,
        orderData.source,
        orderData.expires_at ? new Date(orderData.expires_at) : null
      ];
      await connection.query(query, values);
    } catch (err) {
      console.error(`[${MODULE_NAME}][insertOrder] Errore insert ordine:`, err.message);
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
    console.error(`[${MODULE_NAME}][getTotalActiveCapital] Errore SELECT:`, err.message);
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
      updates.push('capitaleInvestito = ?');
      values.push(capitaleInvestito);
    }

    if (openOrders !== undefined && openOrders !== null) {
      updates.push('OpenOrders = ?');
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
    console.error(`[${MODULE_NAME}][updateStrategyCapitalAndOrders] Errore UPDATE:`, err.message);
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
        console.warn(`[WARNING] Errore nel parsing JSON per ID ${row.id}: ${err.message}`);
      }
    }
    return row;
  });
}

// Recupera capitaleInvestito e OpenOrders per una strategia specifica
async getStrategyCapitalAndOrders(id) {
  const connection = await this.getDbConnection();

  try {
    const [rows] = await connection.query(
      `SELECT *  FROM vstrategies WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      throw new Error(`Nessuna strategia trovata con id: ${id}`);
    }

    return this.parseParamsInRows(rows);
  } catch (err) {
    console.error(`[${MODULE_NAME}][getStrategyCapitalAndOrders] Errore SELECT:`, err.message);
    throw err;
  } finally {
    await connection.end();
  }
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
