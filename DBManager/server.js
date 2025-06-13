const app = require('./endpoints');

const port = process.env.PORT || 3002;

const server = app.listen(port, () => console.log('Server listening on port '+port));


// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[server] Terminazione SIGTERM ricevuta. Chiusura server...');
  server.close(() => {
    console.log('[server] Server chiuso correttamente.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[server] Terminazione SIGINT ricevuta (CTRL+C). Chiusura server...');
  server.close(() => {
    console.log('[server] Server chiuso correttamente.');
    process.exit(0);
  });
});