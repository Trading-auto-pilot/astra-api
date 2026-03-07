// modules/cacheManager.js
"use strict";

const Redis = require("ioredis");

/**
 * CacheManager - Gestisce il caching con Redis
 */
class CacheManager {
  constructor({ logger, config }) {
    this.logger = logger;
    this.config = config;
    this.redis = null;
    this.enabled = false;
  }

  async connect() {
    if (!this.config?.redis?.enabled) {
      this.logger.info("[cacheManager] Redis caching disabled in config");
      this.enabled = false;
      return;
    }

    try {
      const redisConfig = {
        host: this.config.redis.host || "localhost",
        port: this.config.redis.port || 6379,
        password: this.config.redis.password || undefined,
        db: this.config.redis.db || 0,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
      };

      this.logger.info(
        `[cacheManager] Connecting to Redis at ${redisConfig.host}:${redisConfig.port} db=${redisConfig.db}`
      );

      this.redis = new Redis(redisConfig);

      // Test connection
      await this.redis.ping();
      this.enabled = true;
      this.logger.info("[cacheManager] Redis connection established successfully");
    } catch (err) {
      this.logger.error(
        `[cacheManager] Failed to connect to Redis: ${err?.message || String(err)}`
      );
      this.enabled = false;
      this.redis = null;
    }
  }

  async disconnect() {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
      this.enabled = false;
      this.logger.info("[cacheManager] Redis connection closed");
    }
  }

  /**
   * Genera la chiave Redis per una tabella
   */
  generateKey(tableName, params = {}) {
    const prefix = this.config.redis?.keyPrefix || "datahub";

    if (Object.keys(params).length === 0) {
      // Lista completa
      return `${prefix}:${tableName}:list`;
    } else {
      // Record singolo per chiave primaria
      const pkValues = Object.values(params).join(":");
      return `${prefix}:${tableName}:${pkValues}`;
    }
  }

  /**
   * Ottieni dati dalla cache
   */
  async get(key) {
    if (!this.enabled || !this.redis) {
      return null;
    }

    try {
      const data = await this.redis.get(key);
      if (data) {
        this.logger.debug(`[cacheManager] Cache HIT: ${key}`);
        return JSON.parse(data);
      }
      this.logger.debug(`[cacheManager] Cache MISS: ${key}`);
      return null;
    } catch (err) {
      this.logger.error(
        `[cacheManager] Error getting from cache: ${err?.message || String(err)}`
      );
      return null;
    }
  }

  /**
   * Salva dati in cache
   */
  async set(key, data, ttl = 0) {
    if (!this.enabled || !this.redis) {
      return false;
    }

    try {
      const serialized = JSON.stringify(data);

      if (ttl > 0) {
        await this.redis.setex(key, ttl, serialized);
        this.logger.debug(`[cacheManager] Cache SET with TTL=${ttl}s: ${key}`);
      } else {
        await this.redis.set(key, serialized);
        this.logger.debug(`[cacheManager] Cache SET (no TTL): ${key}`);
      }

      return true;
    } catch (err) {
      this.logger.error(
        `[cacheManager] Error setting cache: ${err?.message || String(err)}`
      );
      return false;
    }
  }

  /**
   * Invalida cache per una tabella (elimina tutte le chiavi correlate)
   */
  async invalidateTable(tableName) {
    if (!this.enabled || !this.redis) {
      return;
    }

    try {
      const prefix = this.config.redis?.keyPrefix || "datahub";
      const pattern = `${prefix}:${tableName}:*`;

      // Trova tutte le chiavi che matchano il pattern
      const keys = await this.redis.keys(pattern);

      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.info(
          `[cacheManager] Invalidated ${keys.length} cache keys for table ${tableName}`
        );
      }
    } catch (err) {
      this.logger.error(
        `[cacheManager] Error invalidating cache for ${tableName}: ${err?.message || String(err)}`
      );
    }
  }

  /**
   * Elimina una chiave specifica
   */
  async delete(key) {
    if (!this.enabled || !this.redis) {
      return;
    }

    try {
      await this.redis.del(key);
      this.logger.debug(`[cacheManager] Cache DELETE: ${key}`);
    } catch (err) {
      this.logger.error(
        `[cacheManager] Error deleting cache key: ${err?.message || String(err)}`
      );
    }
  }

  /**
   * Verifica se il caching è abilitato
   */
  isEnabled() {
    return this.enabled;
  }
}

module.exports = { CacheManager };
