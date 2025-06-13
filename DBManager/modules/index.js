// modules/index.js

module.exports = {
  ...require('./core'),
  ...require('./bots'),
  ...require('./logs'),
  ...require('./orders'),
  ...require('./positions'),
  ...require('./strategies'),
  ...require('./symbols'),
  ...require('./simul_position'),
  ...require('./simul_orders'),
  ...require('./simul_account'),
  ...require('./transactions'),
  ...require('./settings'),
  ...require('./strategy_stats')
};
