// modules/cachingTableManager.js
"use strict";

/**
 * CachingTableManager - Gestisce la tabella di sistema __caching
 * Questa tabella contiene la configurazione del caching per ogni tabella del database
 */
class CachingTableManager {
  constructor({ logger, schemaReader }) {
    this.logger = logger;
    this.schemaReader = schemaReader;
    this.tableName = "__caching";
  }

  /**
   * Inizializza la tabella __caching
   * Crea la tabella se non esiste e sincronizza con lo schema
   */
  async initialize(schema) {
    await this.ensureTableExists();
    await this.syncWithSchema(schema);
  }

  /**
   * Crea la tabella __caching se non esiste
   */
  async ensureTableExists() {
    try {
      // Verifica se la tabella esiste
      const [tables] = await this.schemaReader.query(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [this.tableName]
      );

      if (tables.length === 0) {
        this.logger.info(`[cachingTableManager] Creating system table ${this.tableName}`);

        // Crea la tabella
        await this.schemaReader.query(`
          CREATE TABLE ?? (
            table_name VARCHAR(255) PRIMARY KEY,
            enabled BOOLEAN NOT NULL DEFAULT FALSE,
            ttl INT NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          )
        `, [this.tableName]);

        this.logger.info(`[cachingTableManager] System table ${this.tableName} created successfully`);
      } else {
        this.logger.info(`[cachingTableManager] System table ${this.tableName} already exists`);
      }
    } catch (err) {
      this.logger.error(
        `[cachingTableManager] Error ensuring table exists: ${err?.message || String(err)}`
      );
      throw err;
    }
  }

  /**
   * Sincronizza la tabella __caching con lo schema corrente
   * - Aggiunge nuove tabelle con caching disabled
   * - Rimuove tabelle che non esistono più
   */
  async syncWithSchema(schema) {
    try {
      // Ottieni tutte le tabelle esistenti nello schema (escludendo le tabelle di sistema)
      const existingTables = schema
        .filter((table) => !table.name.startsWith("__"))
        .map((table) => table.name);

      // Ottieni le configurazioni attuali
      const [currentConfigs] = await this.schemaReader.query(
        `SELECT table_name FROM ?? ORDER BY table_name`,
        [this.tableName]
      );

      const configuredTables = currentConfigs.map((row) => row.table_name);

      // Trova tabelle da aggiungere (esistono nello schema ma non in __caching)
      const tablesToAdd = existingTables.filter((t) => !configuredTables.includes(t));

      // Trova tabelle da rimuovere (esistono in __caching ma non nello schema)
      const tablesToRemove = configuredTables.filter((t) => !existingTables.includes(t));

      // Aggiungi nuove tabelle
      for (const tableName of tablesToAdd) {
        await this.schemaReader.query(
          `INSERT INTO ?? (table_name, enabled, ttl) VALUES (?, FALSE, 0)`,
          [this.tableName, tableName]
        );
        this.logger.info(
          `[cachingTableManager] Added caching config for table: ${tableName} (disabled by default)`
        );
      }

      // Rimuovi tabelle obsolete
      for (const tableName of tablesToRemove) {
        await this.schemaReader.query(
          `DELETE FROM ?? WHERE table_name = ?`,
          [this.tableName, tableName]
        );
        this.logger.info(
          `[cachingTableManager] Removed caching config for deleted table: ${tableName}`
        );
      }

      this.logger.info(
        `[cachingTableManager] Sync completed: ${tablesToAdd.length} added, ${tablesToRemove.length} removed`
      );
    } catch (err) {
      this.logger.error(
        `[cachingTableManager] Error syncing with schema: ${err?.message || String(err)}`
      );
      throw err;
    }
  }

  /**
   * Ottieni la configurazione del caching per una tabella specifica
   */
  async getCachingConfig(tableName) {
    try {
      const [rows] = await this.schemaReader.query(
        `SELECT table_name, enabled, ttl, created_at, updated_at FROM ?? WHERE table_name = ?`,
        [this.tableName, tableName]
      );

      if (rows.length === 0) {
        return null;
      }

      return {
        tableName: rows[0].table_name,
        enabled: Boolean(rows[0].enabled),
        ttl: rows[0].ttl,
        createdAt: rows[0].created_at,
        updatedAt: rows[0].updated_at,
      };
    } catch (err) {
      this.logger.error(
        `[cachingTableManager] Error getting caching config for ${tableName}: ${err?.message || String(err)}`
      );
      return null;
    }
  }

  /**
   * Ottieni tutte le configurazioni del caching
   */
  async getAllCachingConfigs() {
    try {
      const [rows] = await this.schemaReader.query(
        `SELECT table_name, enabled, ttl, created_at, updated_at FROM ?? ORDER BY table_name`,
        [this.tableName]
      );

      return rows.map((row) => ({
        tableName: row.table_name,
        enabled: Boolean(row.enabled),
        ttl: row.ttl,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    } catch (err) {
      this.logger.error(
        `[cachingTableManager] Error getting all caching configs: ${err?.message || String(err)}`
      );
      return [];
    }
  }

  /**
   * Aggiorna la configurazione del caching per una tabella
   */
  async updateCachingConfig(tableName, { enabled, ttl }) {
    try {
      const updates = [];
      const values = [];

      if (enabled !== undefined) {
        updates.push("enabled = ?");
        values.push(Boolean(enabled));
      }

      if (ttl !== undefined) {
        updates.push("ttl = ?");
        values.push(parseInt(ttl) || 0);
      }

      if (updates.length === 0) {
        throw new Error("No fields to update");
      }

      const [result] = await this.schemaReader.query(
        `UPDATE ?? SET ${updates.join(", ")} WHERE table_name = ?`,
        [this.tableName, ...values, tableName]
      );

      if (result.affectedRows === 0) {
        return null;
      }

      return await this.getCachingConfig(tableName);
    } catch (err) {
      this.logger.error(
        `[cachingTableManager] Error updating caching config for ${tableName}: ${err?.message || String(err)}`
      );
      throw err;
    }
  }

  /**
   * Crea una nuova configurazione del caching
   */
  async createCachingConfig(tableName, { enabled = false, ttl = 0 }) {
    try {
      await this.schemaReader.query(
        `INSERT INTO ?? (table_name, enabled, ttl) VALUES (?, ?, ?)`,
        [this.tableName, tableName, Boolean(enabled), parseInt(ttl) || 0]
      );

      return await this.getCachingConfig(tableName);
    } catch (err) {
      this.logger.error(
        `[cachingTableManager] Error creating caching config for ${tableName}: ${err?.message || String(err)}`
      );
      throw err;
    }
  }

  /**
   * Elimina la configurazione del caching per una tabella
   */
  async deleteCachingConfig(tableName) {
    try {
      const [result] = await this.schemaReader.query(
        `DELETE FROM ?? WHERE table_name = ?`,
        [this.tableName, tableName]
      );

      return result.affectedRows > 0;
    } catch (err) {
      this.logger.error(
        `[cachingTableManager] Error deleting caching config for ${tableName}: ${err?.message || String(err)}`
      );
      throw err;
    }
  }
}

module.exports = { CachingTableManager };
