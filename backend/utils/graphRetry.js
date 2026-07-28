// backend/utils/graphRetry.js
//
// The shared retry policy for Microsoft Graph calls: one predicate, one
// dedicated circuit breaker, one wrapper.
//
// Every Graph caller previously inlined this four-line predicate:
//
//     err?.statusCode === 429 || err?.statusCode === 503 ||
//     err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET'
//
// ...and every clause of it was dead. graphApiService throws `status`, never
// `statusCode` (see utils/graphError.js), and undici's fetch never puts an OS
// error code on the thrown error itself. Consolidating here means the predicate
// is fixed once and cannot rot back into five divergent copies.

const { retryWithBackoff, createCircuitBreaker } = require('./retryWithBackoff');

/**
 * Node's fetch is undici, which does NOT surface the underlying socket error
 * directly. Verified against Node v22.16.0 by probing real failures:
 *
 *   DNS failure          TypeError('fetch failed')  err.code undefined
 *                                                   err.cause.code 'ENOTFOUND'
 *   connection refused   TypeError('fetch failed')  err.cause.code 'ECONNREFUSED'
 *   reset while connecting                          err.cause.code 'ECONNRESET' / 'ETIMEDOUT'
 *   socket closed mid-response
 *                        TypeError('terminated')    err.cause.code 'UND_ERR_SOCKET'
 *                                                   err.cause.name 'SocketError'
 *   AbortSignal.timeout  DOMException               err.name 'TimeoutError'
 *                                                   err.code 23  (numeric, NOT a string)
 *
 * Two consequences encoded below: the OS code must be read from `err.cause.code`,
 * and `err.code` must be string-checked before comparison so the numeric
 * DOMException code (23) cannot collide with a future string entry.
 */
const RETRYABLE_NETWORK_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/**
 * Is this Graph failure worth another attempt?
 *
 * `status` is what graphApiService actually throws; `statusCode` is accepted
 * too because a few older call sites construct errors that way.
 *
 * @param {Error|null|undefined} err
 * @returns {boolean}
 */
function isRetryableGraphError(err) {
  if (!err) return false;

  const status = err.status ?? err.statusCode;
  if (status === 429 || status === 503) return true;

  const code = typeof err.code === 'string' ? err.code : null;
  const causeCode = typeof err.cause?.code === 'string' ? err.cause.code : null;
  if (code && RETRYABLE_NETWORK_CODES.has(code)) return true;
  if (causeCode && RETRYABLE_NETWORK_CODES.has(causeCode)) return true;

  if (err.name === 'TimeoutError' || err.cause?.name === 'TimeoutError') return true;

  return false;
}

/**
 * Graph's own breaker, deliberately NOT the shared Cosmos one.
 *
 * Graph throttles per-mailbox and recovers on its own schedule; Cosmos throttles
 * on provisioned RU. Sharing one breaker meant a Graph 429 burst could open the
 * breaker that gates every database retry in the process — an unrelated
 * dependency taking the database offline for a full cooldown.
 */
let graphBreaker = createCircuitBreaker({ label: 'Graph' });

/**
 * Run a Graph operation with bounded retries on its own breaker.
 *
 * Note graphApiService.graphRequest ALREADY retries transient statuses
 * internally with Retry-After support, so this wrapper's main job is the
 * network-level failures that never reach that loop.
 *
 * @param {Function} op - async thunk performing the Graph call
 * @param {object} [options] - forwarded to retryWithBackoff
 * @returns {Promise<*>}
 */
function withGraphRetry(op, options = {}) {
  return retryWithBackoff(op, {
    maxAttempts: 3,
    retryableError: isRetryableGraphError,
    ...options,
    breaker: graphBreaker,
  });
}

function _resetGraphBreakerForTest(options) {
  graphBreaker = createCircuitBreaker({ label: 'Graph', ...options });
}

function _getGraphBreakerState() {
  return { ...graphBreaker };
}

module.exports = {
  withGraphRetry,
  isRetryableGraphError,
  RETRYABLE_NETWORK_CODES,
};

// Test-only exports — guarded so production code cannot reset the breaker.
if (process.env.NODE_ENV !== 'production') {
  module.exports._resetGraphBreakerForTest = _resetGraphBreakerForTest;
  module.exports._getGraphBreakerState = _getGraphBreakerState;
}
