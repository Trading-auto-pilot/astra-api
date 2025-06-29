const axios = require('axios');

const levels = ['trace', 'log', 'info', 'warning', 'error'];
const dbManagerUrl = process.env.DBMANAGER_URL || 'http://localhost:3002';
const enableDbLog = process.env.ENABLE_DB_LOG === 'true';
// ANSI color codes
const COLORS = {
  trace: '\x1b[35m',
  log: '\x1b[36m',
  info: '\x1b[32m',
  error: '\x1b[31m',
  warning: '\x1b[33m',
  reset: '\x1b[0m'
};

// Funzione per generare timestamp
function getTimestamp() { 
  const now = new Date();
  const date = now.toISOString().replace('T', ' ').replace('Z', '');
  const millis = String(now.getMilliseconds());//.padStart(3, '0');
  return `${date}`; //.${millis}`;
}

// Coda per log asincroni
let logQueue = [];

// Simulazione flush asincrono (puoi sostituire con DB)
setInterval(async () => {
  if (!enableDbLog || logQueue.length === 0) return;

  const batch = logQueue;
  logQueue = [];

  try {
    await axios.post(`${dbManagerUrl}/logs`, batch);
  } catch (err) {
    // Se fallisce, re-inserisci i log in testa alla coda
    logQueue = [...batch, ...logQueue];
    console.error('[logger] Failed to send logs:', err.message);
  }
}, 1000);


function createLogger(microservice = '', moduleName = '', moduleVersion = '', level = 'info') {
  let currentIndex = levels.indexOf(level);


  const logToConsoleAndQueue = (levelKey, color, ...args) => {
    const timestamp = getTimestamp();
    const prefix = `[${timestamp}][${microservice}][${moduleName}][${moduleVersion}][${levelKey.toUpperCase()}]`;
    const fullMessage = args.join(' ');

    // stampa su console
    const output = `${color}${prefix} ${fullMessage}${COLORS.reset}`;
    if (levelKey === 'error') console.error(output);
    else if (levelKey === 'warning') console.warn(output);
    else console.log(output);

  // estrae il nome funzione (obbligatorio)
    const funcMatch = fullMessage.match(/^\s*\[([^\]]+)\]\s*/);
    const functionName = funcMatch ? funcMatch[1] : null;
    let message = fullMessage.replace(/^\[[^\]]+\]\s*/, '');

      // estrae JSON finale opzionale dopo pipe |
    let jsonDetails = null;
    const pipeIndex = message.lastIndexOf('|');
    if (pipeIndex !== -1) {
      const maybeJson = message.slice(pipeIndex + 1).trim();
      message = message.slice(0, pipeIndex).trim();
      try {
        jsonDetails = JSON.parse(maybeJson);
      } catch (_) {
        // ignora se non è JSON valido
      }
    }

    // enqueue per scrittura asincrona
    logQueue.push({
      timestamp,
      level: levelKey,
      functionName,
      message: message,
      jsonDetails,
      microservice,
      moduleName,
      moduleVersion
    });
  };



  const logger =  {
    trace: (...args) => currentIndex <= 0 && logToConsoleAndQueue('trace', COLORS.trace, ...args),
    log: (...args) => currentIndex <= 1 && logToConsoleAndQueue('log', COLORS.log, ...args),
    info: (...args) => currentIndex <= 2 && logToConsoleAndQueue('info', COLORS.info, ...args),
    warning: (...args) => currentIndex <= 3 && logToConsoleAndQueue('warning', COLORS.warning, ...args),
    error: (...args) => currentIndex <= 4 && logToConsoleAndQueue('error', COLORS.error, ...args),

    setLevel: (newLevel) => {
      if (!levels.includes(newLevel)) {
        console.warn(`[logger] Livello "${newLevel}" non valido`);
        return;
      }
      currentLevel = newLevel;
      currentIndex = levels.indexOf(currentLevel);
      console.log(`[logger] Livello di log aggiornato a: ${newLevel}`);
    }
  };

  return logger;
}

module.exports = createLogger;
