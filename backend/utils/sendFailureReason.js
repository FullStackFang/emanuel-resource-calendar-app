// backend/utils/sendFailureReason.js
//
// Classify a per-recipient email send failure into a reason code the UI can
// phrase for a person. The raw error text travels beside the code and is
// console material on the client; this is what goes on screen.
//
// Only the server sees the HTTP status and the network error shape, which is
// why the mapping lives here rather than being guessed from message text in
// the browser. Pure, dependency-free.

/**
 * @param {Error|null|undefined} err
 * @returns {'throttled'|'rejected'|'unavailable'|'unknown'}
 *   throttled   - Graph 429: the sender mailbox is over its concurrency or
 *                 rate limit. Transient; a later re-send will succeed.
 *   rejected    - any other 4xx: the mail server refused THIS message (bad
 *                 address, oversize, etc.). Re-sending unchanged will not help.
 *   unavailable - 5xx, a network failure, or an open Graph circuit breaker:
 *                 the mail server could not be reached. Transient.
 *   unknown     - anything else.
 */
function sendFailureReason(err) {
  if (!err) return 'unknown';

  const status = err.status ?? err.statusCode;
  if (status === 429) return 'throttled';
  if (typeof status === 'number' && status >= 400 && status < 500) return 'rejected';
  if (typeof status === 'number' && status >= 500) return 'unavailable';

  if (err.code === 'CIRCUIT_BREAKER_OPEN') return 'unavailable';
  // undici reports the OS-level failure on err.cause.code (see graphRetry.js).
  const causeCode = typeof err.cause?.code === 'string' ? err.cause.code : null;
  if (causeCode || err.name === 'TimeoutError' || err.cause?.name === 'TimeoutError') return 'unavailable';

  return 'unknown';
}

module.exports = { sendFailureReason };
