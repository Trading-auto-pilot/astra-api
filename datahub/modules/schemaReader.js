// modules/schemaReader.js
"use strict";

const mysql = require("mysql2/promise");

class SchemaReader {
  constructor({ logger, config }) {
    this.logger = logger;
    this.config = config;
    this.pool = null;
  }

  async connect() {
    if (this.pool) {
      return;
    }

    const poolConfig = {
      host: this.config.host || "localhost",
      port: this.config.port || 3306,
      user: this.config.user || "root",
      password: this.config.password || "",
      database: this.config.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      multipleStatements: false,
    };

    this.logger.info(
      `[schemaReader] Connecting to MySQL host=${poolConfig.host} port=${poolConfig.port} database=${poolConfig.database}`
    );

    this.pool = mysql.createPool(poolConfig);

    // Test connection
    try {
      const connection = await this.pool.getConnection();
      connection.release();
      this.logger.info("[schemaReader] MySQL connection pool created successfully");
    } catch (err) {
      this.logger.error(
        `[schemaReader] Failed to connect to MySQL: ${err?.message || String(err)}`
      );
      throw err;
    }
  }

  async disconnect() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.logger.info("[schemaReader] MySQL connection pool closed");
    }
  }

  /**
   * Reads all tables and views from the schema
   * @returns {Promise<Array<{name: string, type: 'table'|'view', columns: Array, primaryKeys: Array}>>}
   */
  async readSchema() {
    if (!this.pool) {
      throw new Error("MySQL pool not initialized. Call connect() first.");
    }

    const database = this.config.database;

    // Get all tables
    const [tables] = await this.pool.query(
      `SELECT TABLE_NAME, TABLE_TYPE
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ?
       AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
       ORDER BY TABLE_NAME`,
      [database]
    );

    this.logger.info(`[schemaReader] Found ${tables.length} tables/views in schema ${database}`);

    const schema = [];

    for (const table of tables) {
      const tableName = table.TABLE_NAME;
      const tableType = table.TABLE_TYPE === "BASE TABLE" ? "table" : "view";

      // Get columns
      const [columns] = await this.pool.query(
        `SELECT
          COLUMN_NAME as name,
          DATA_TYPE as type,
          IS_NULLABLE as nullable,
          COLUMN_KEY as columnKey,
          COLUMN_DEFAULT as defaultValue,
          EXTRA as extra
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [database, tableName]
      );

      // Get primary keys
      const primaryKeys = columns
        .filter((col) => col.columnKey === "PRI")
        .map((col) => col.name);

      // Get foreign keys
      const [foreignKeys] = await this.pool.query(
        `SELECT
          COLUMN_NAME as columnName,
          REFERENCED_TABLE_NAME as referencedTable,
          REFERENCED_COLUMN_NAME as referencedColumn
         FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?
         AND REFERENCED_TABLE_NAME IS NOT NULL`,
        [database, tableName]
      );

      schema.push({
        name: tableName,
        type: tableType,
        columns: columns.map((col) => ({
          name: col.name,
          type: col.type,
          nullable: col.nullable === "YES",
          isPrimaryKey: col.columnKey === "PRI",
          isAutoIncrement: col.extra?.includes("auto_increment") || false,
          defaultValue: col.defaultValue,
        })),
        primaryKeys,
        foreignKeys: foreignKeys.map((fk) => ({
          columnName: fk.columnName,
          referencedTable: fk.referencedTable,
          referencedColumn: fk.referencedColumn,
        })),
      });
    }

    return schema;
  }

  /**
   * Execute a query with parameters
   */
  async query(sql, params = []) {
    if (!this.pool) {
      throw new Error("MySQL pool not initialized. Call connect() first.");
    }
    return this.pool.query(sql, params);
  }

  /**
   * Get a connection from the pool
   */
  async getConnection() {
    if (!this.pool) {
      throw new Error("MySQL pool not initialized. Call connect() first.");
    }
    return this.pool.getConnection();
  }
}

module.exports = { SchemaReader };
