const createLogger = require('../shared/logger');
const { RedisBus } = require('../shared/redisBus');
const createApp = require('./endpoints');
const port = process.env.PORT || 3001;

const MICROSERVICE = 'TradeExecutor';
const MODULE_NAME = 'RESTServer';
const MODULE_VERSION = '1.0';

(async () => {
  const logger = createLogger(MICROSERVICE, MODULE_NAME, MODULE_VERSION, process.env.LOG_LEVEL || 'info', {
    autoModule: true, // opzionale: rileva automaticamente il modulo chiamante
  });

  const bus = new RedisBus({ env: process.env.APP_ENV || 'dev', name: 'api-cache', logger });
  await bus.connect();
  const app = await createApp({ bus, logger });

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
})();

