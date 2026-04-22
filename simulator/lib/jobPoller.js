"use strict";

// ---------------------------------------------------------------------------
// lib/jobPoller.js — Poll an async job endpoint until completion or timeout
//
// Tickerscanner jobs (update-market-daily, user-daily-scores) are async: the
// POST returns immediately with { jobId } and the caller must poll for status.
//
// Usage:
//   const result = await pollUntilDone({
//     fetchStatus: () => axios.get(`${url}/jobs/${jobId}`).then(r => r.data),
//     isDone:      (data) => ["completed","error","cancelled"].includes(data?.status),
//     isError:     (data) => ["error","cancelled"].includes(data?.status),
//     errorMsg:    (data) => data?.error || data?.status,
//     intervalMs:  2000,
//     timeoutMs:   120000,
//   });
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {function():Promise<any>} opts.fetchStatus  — fetches current job status
 * @param {function(any):boolean}   opts.isDone        — returns true when job is finished
 * @param {function(any):boolean}   [opts.isError]     — returns true when job failed
 * @param {function(any):string}    [opts.errorMsg]    — extracts error message
 * @param {number}                  [opts.intervalMs]  — poll interval (default 2000)
 * @param {number}                  [opts.timeoutMs]   — max wait (default 120000)
 * @returns {Promise<any>}  final status payload
 */
async function pollUntilDone({
  fetchStatus,
  isDone,
  isError = () => false,
  errorMsg = (d) => d?.error || "Job failed",
  intervalMs = 2000,
  timeoutMs = 120000,
}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const data = await fetchStatus();
    if (isDone(data)) {
      if (isError(data)) throw new Error(errorMsg(data));
      return data;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Job polling timed out after ${timeoutMs}ms`);
}

module.exports = { pollUntilDone };
