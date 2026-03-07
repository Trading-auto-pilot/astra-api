"use strict";

const InMemoryYahooCacheRepository = require("./impl/inMemoryYahooCacheRepository");

let singleton = null;

function createYahooCacheRepository() {
  if (!singleton) singleton = new InMemoryYahooCacheRepository();
  return singleton;
}

module.exports = {
  createYahooCacheRepository,
};

