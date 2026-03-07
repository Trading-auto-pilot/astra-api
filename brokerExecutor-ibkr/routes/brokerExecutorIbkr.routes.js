"use strict";

const express = require("express");
const { createBrokerExecutorIbkrController } = require("../controllers/brokerExecutorIbkr.controller");

module.exports = function buildBrokerExecutorIbkrRouter({ logger, getService }) {
  const router = express.Router();

  // Lazy proxy: risolve getService().ordersService a request time (non alla costruzione del router),
  // perché serviceInstance è null quando la factory viene chiamata la prima volta.
  const serviceProxy = {
    listPositions:      (...a) => getService().ordersService.listPositions(...a),
    listOpenOrders:     (...a) => getService().ordersService.listOpenOrders(...a),
    createBracketOrder: (...a) => getService().ordersService.createBracketOrder(...a),
    updateBracketOrder: (...a) => getService().ordersService.updateBracketOrder(...a),
    deleteOrder:        (...a) => getService().ordersService.deleteOrder(...a),
  };

  const controller = createBrokerExecutorIbkrController({
    service: serviceProxy,
    logger,
    wsStatusProvider: () => getService?.()?.getWsOrdersListenerStatus?.(),
  });

  // Access control is handled by Traefik forwardAuth (same pattern as other microservices).
  router.get("/positions", controller.getPositions);
  router.get("/orders", controller.getOrders);
  router.get("/ws/status", controller.getWsStatus);
  router.post("/order", controller.postOrder);
  router.put("/order/:orderId", controller.putOrder);
  router.delete("/order/:orderId", controller.deleteOrder);

  return router;
};
