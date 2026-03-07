"use strict";

const express = require("express");
const { createLiquidityScoreController } = require("../controllers/liquidityScoreController");

function createLiquidityScoreRouter({ getService, logger }) {
  const router = express.Router();
  const controller = createLiquidityScoreController({ getService, logger });

  router.get("/liquidity-score", controller.getLatestScore);
  router.post("/liquidity-score/recompute", controller.recomputeScore);
  router.get("/liquidity-score/history", controller.getScoreHistory);
  router.get("/liquidity-score/providers/status", controller.getProvidersStatus);
  router.get("/liquidity-score/tasks", controller.getTasks);
  router.get("/liquidity-score/tasks/:taskId", controller.getTaskById);

  return router;
}

module.exports = createLiquidityScoreRouter;
