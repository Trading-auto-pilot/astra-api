module.exports = ({ db, logger, cache }) => {
    const log = logger.forModule(__filename);
    const KEY_ALL = 'strategies:v2:all';


    async function readKeyAll() {
        try {
            log.info('[readKeyAll] landed!');
            let val = await cache.get(KEY_ALL);
            if (val == null) return null;                  // key assente
            if (typeof val === 'string') {
            try { return JSON.parse(val); } catch { return val; } // stringa non-JSON? restituiscila così com'è
            }
            return val; // alcuni wrapper già deserializzano
        } catch (e) {
            // opzionale: log warning
            // logger?.warning?.(`[redis] get ${KEY_ALL} failed: ${e.message}`);
            return null;
        }
    }

  return {
    readKeyAll,
    KEY_ALL,
  };
}