const app = require('./endpoints');
const cors = require('cors');
const createLogger = require('../shared/logger');
const port = process.env.PORT || 3002;

const MICROSERVICE = 'DBManager';
const MODULE_NAME = 'RESTServer';
const MODULE_VERSION = '2.0';

const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info');

const server = app.listen(port, () => logger.info('Server listening on port '+port));

// ✅ Log degli errori globali
process.on('uncaughtException', err => {
  logger.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', err => {
  logger.error('Unhandled Rejection:', err);
});


// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('[server] Terminazione SIGTERM ricevuta. Chiusura server...');
  server.close(() => {
    logger.info('[server] Server chiuso correttamente.');
    process.exit(0);
  });
});
