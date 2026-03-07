"use strict";

const path = require("path");
const InMemoryLiquidityScoreRepository = require("./impl/inMemoryLiquidityScoreRepository");
const FileLiquidityScoreRepository = require("./impl/fileLiquidityScoreRepository");

function createLiquidityScoreRepository({ logger } = {}) {
  const mode = String(process.env.LIQUIDITY_REPOSITORY_MODE || "memory").toLowerCase();

  if (mode === "file") {
    return new FileLiquidityScoreRepository({
      logger,
      filePath:
        process.env.LIQUIDITY_HISTORY_FILE_PATH ||
        path.resolve(__dirname, "..", "data", "liquidity-score-history.json"),
    });
  }

  return new InMemoryLiquidityScoreRepository({ logger });
}

module.exports = {
  createLiquidityScoreRepository,
};

