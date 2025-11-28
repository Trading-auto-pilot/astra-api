// modules/stats.js
"use strict";

module.exports = function createStatsModule(cacheManager) {
  return {
    getL1Stats() {
      return {
        provider: process.env.HISTORICAL_PROVIDER || "ALPACA",
        l1_hits: cacheManager.L1Hit || 0,
        last_provider_call: cacheManager.lastProviderCall || null,
      };
    },

    getL2Stats() {
      return {
        l2_hits: cacheManager.L2Hit || 0,
        l2_miss: cacheManager.L2Miss || 0,
        cache_base_path: cacheManager.cacheBasePath,
      };
    },

    getParamsSetting() {
      return {
        provider: process.env.HISTORICAL_PROVIDER || "ALPACA",
        timeframe: cacheManager.tf || "1Day",
        cache_base_path: cacheManager.cacheBasePath,
      };
    },

    getCacheHits() {
      return {
        l1_hits: cacheManager.L1Hit || 0,
        l2_hits: cacheManager.L2Hit || 0,
        l2_miss: cacheManager.L2Miss || 0,
        l3_hits: cacheManager.L3Hit || 0,
        total_requests: cacheManager.totalRequests || 0,
      };
    }
  };
};
