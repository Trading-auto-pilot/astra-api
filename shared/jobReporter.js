"use strict";

// ---------------------------------------------------------------------------
// jobReporter – notifica il completamento di un task asincrono via Redis bus
//
// Il task pubblica su <ENV>.<MICROSERVICE>.status.HOOK con i dettagli.
// Lo scheduler è in ascolto su quel pattern e aggiorna il proprio stato.
//
// Uso:
//   const { reportJobDone } = require('../shared/jobReporter');
//   await reportJobDone(this.bus, this.redisStatusChannel, jobId, {
//     status: "COMPLETED",
//     summary: { processed: 100, errors: 2 }
//   });
// ---------------------------------------------------------------------------

/**
 * Pubblica un messaggio di completamento job sul canale status.HOOK.
 * @param {object} bus        - Istanza RedisBus del microservizio
 * @param {string} channel    - Canale status base (es. DEV.tickerscanner.status)
 * @param {string} jobId      - ID del job restituito dal POST iniziale
 * @param {object} result     - Dettagli completamento
 * @param {string} result.status  - "COMPLETED" | "FAILED" | "CANCELLED"
 * @param {object} [result.summary] - Dati di riepilogo (processed, inserted, errors, ecc.)
 * @param {string} [result.error]   - Messaggio di errore (se status=FAILED)
 */
async function reportJobDone(bus, channel, jobId, result) {
  if (!bus || !channel || !jobId) return;
  const hookChannel = `${channel}.HOOK`;
  const payload = {
    type: "job.done",
    jobId: String(jobId),
    status: result?.status || "COMPLETED",
    summary: result?.summary || {},
    error: result?.error || null,
    finishedAt: new Date().toISOString(),
  };
  try {
    await bus.publish(hookChannel, payload);
  } catch (err) {
    // non bloccare il task se il publish fallisce
    const log = bus.logger || console;
    (log.warning || log.warn || log.error).call(
      log,
      `[jobReporter] publish failed on ${hookChannel}: ${err?.message || err}`
    );
  }
}

module.exports = { reportJobDone };
