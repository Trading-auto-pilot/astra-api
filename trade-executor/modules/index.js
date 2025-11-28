module.exports = (deps) => {
  const main = require('./main')(deps);

  return {
    ...main
  };
};