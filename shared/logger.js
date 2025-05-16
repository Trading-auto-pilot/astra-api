// shared/logger.js
const levels = ['trace', 'log', 'info', 'warning', 'error'];
//const currentLevel = process.env.LOG_LEVEL || 'info';

// ANSI color codes
const COLORS = {
  trace: '\x1b[35m', // magenta
  log: '\x1b[36m',   // cyan
  info: '\x1b[32m',  // green
  error: '\x1b[31m', // red
  warning: '\x1b[33m',
  reset: '\x1b[0m'   // reset color
};

// Funzione per generare timestamp
function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').replace('Z', '');
}


function createLogger(moduleName = '', level='info' ) {
  const currentIndex = levels.indexOf(level);
  return {
    trace: (...args) => {
      if (currentIndex <= 0) console.log(`${COLORS.trace}[${getTimestamp()}][${moduleName}][TRACE]`, ...args, COLORS.reset);
    },
    log: (...args) => {
      if (currentIndex <= 1) console.log(`${COLORS.log}[${getTimestamp()}][${moduleName}][LOG]`, ...args, COLORS.reset);
    },
    info: (...args) => {
      if (currentIndex <= 2) console.log(`${COLORS.info}[${getTimestamp()}][${moduleName}][INFO]`, ...args, COLORS.reset);
    },
    warning: (...args) => {
      if (currentIndex <= 3) console.warn(`${COLORS.warning}[${getTimestamp()}][${moduleName}][WARNING]`, ...args, COLORS.reset);
    },
    error: (...args) => {
      if (currentIndex <= 3) console.error(`${COLORS.error}[${getTimestamp()}][${moduleName}][ERROR]`, ...args, COLORS.reset);
    }
  };
}

module.exports = createLogger;
