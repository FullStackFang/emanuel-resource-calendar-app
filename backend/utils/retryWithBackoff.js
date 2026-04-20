/**
 * Retry with Exponential Backoff + Jitter + Circuit Breaker
 *
 * Shared utility for bounded retries against Cosmos DB and other flaky
 * external services. Replaces ad-hoc while loops that advance only on
 * success (the root cause of Issues #1, #8, #9, #10 in the loop audit).
 *
 * Features:
 * - Exponential backoff with jitter to prevent thundering herd at 200+ users
 * - Honors Cosmos DB's RetryAfterMs from error payloads
 * - Process-level circuit breaker that opens after sustained throttling
 * - Broad Cosmos error predicate (code 16500, codeName, message variants)
 * - Non-retryable errors fail fast without consuming retry budget
 *
 * Usage:
 *   const { retryWithBackoff } = require('./retryWithBackoff');
 *   const result = await retryWithBackoff(() => collection.deleteMany(query));
 *
 *   // With options:
 *   await retryWithBackoff(() => collection.updateMany(query, update), {
 *     maxAttempts: 3,
 *     onRetry: ({ attempt, delay }) => logger.log(`Retry ${attempt}, waiting ${delay}ms`),
 *   });
 */

const logger = require('./logger');

// ---------------------------------------------------------------------------
// Cosmos DB error detection
// ---------------------------------------------------------------------------

/**
 * Determine if an error is a retryable Cosmos DB throttling error.
 * The MongoDB driver surfaces Cosmos 429s inconsistently — sometimes as
 * code 16500, sometimes via codeName, sometimes only in the message.
 */
function isCosmosRetryable(err) {
  if (!err) return false;
  if (err.code === 16500) return true;
  if (err.codeName === 'RequestRateTooLarge') return true;
  if (typeof err.message === 'string') {
    if (err.message.includes('Request rate is large')) return true;
    if (err.message.includes('RetryAfterMs')) return true;
    if (err.message.includes('TooManyRequests')) return true;
  }
  return false;
}

/**
 * Extract Cosmos DB's recommended retry delay from the error message.
 * Returns the delay in milliseconds, or null if not present.
 */
function parseRetryAfterMs(err) {
  if (!err || typeof err.message !== 'string') return null;
  const match = err.message.match(/RetryAfterMs=(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// ---------------------------------------------------------------------------
// Circuit breaker (process-level singleton)
// ---------------------------------------------------------------------------

const DEFAULT_BREAKER_OPTIONS = {
  threshold: 15,          // throttle events to trip the breaker
  warnThreshold: 8,       // 50% — log warning when breaker is "breathing"
  cooldownMs: 60_000,     // how long the breaker stays open
  decayIntervalMs: 10_000, // how often one throttle event decays
};

function createCircuitBreaker(options = {}) {
  const config = { ...DEFAULT_BREAKER_OPTIONS, ...options };

  return {
    throttleEvents: 0,
    openUntil: 0,
    lastDecay: Date.now(),
    config,
  };
}

// Module-level breaker instance — shared across all callers in this process
let breaker = createCircuitBreaker();

/**
 * Decay stale throttle events based on elapsed time.
 * Called before every retry attempt so the breaker doesn't trip on
 * bursts that have already passed.
 */
function decayBreaker() {
  if (breaker.throttleEvents === 0) return; // nothing to decay
  const now = Date.now();
  const elapsed = now - breaker.lastDecay;
  if (elapsed >= breaker.config.decayIntervalMs) {
    const steps = Math.floor(elapsed / breaker.config.decayIntervalMs);
    breaker.throttleEvents = Math.max(0, breaker.throttleEvents - steps);
    breaker.lastDecay = now;
  }
}

/**
 * Record a throttle event (called on every retryable error, not just exhaustion).
 * Opens the breaker after sustained throttling across all callers.
 */
function recordThrottle() {
  decayBreaker();
  breaker.throttleEvents++;

  if (breaker.throttleEvents >= breaker.config.threshold) {
    breaker.openUntil = Date.now() + breaker.config.cooldownMs;
    logger.error(
      '[retryWithBackoff] Circuit breaker OPEN — halting Cosmos retries for %dms (%d throttle events)',
      breaker.config.cooldownMs, breaker.throttleEvents
    );
    breaker.throttleEvents = 0;
  } else if (breaker.throttleEvents >= breaker.config.warnThreshold) {
    logger.warn(
      '[retryWithBackoff] Circuit breaker at %d/%d — Cosmos under pressure',
      breaker.throttleEvents, breaker.config.threshold
    );
  }
}

/**
 * Check if the circuit breaker is currently open.
 */
function isBreakerOpen() {
  return Date.now() < breaker.openUntil;
}

// ---------------------------------------------------------------------------
// Core retry function
// ---------------------------------------------------------------------------

/**
 * Execute an async function with bounded retries, exponential backoff + jitter,
 * and circuit breaker protection.
 *
 * @param {Function} fn - Async function to execute. Called with no arguments.
 * @param {Object} [options]
 * @param {number} [options.maxAttempts=5] - Total attempts (1 = no retries)
 * @param {number} [options.initialDelayMs=1000] - Base delay for exponential backoff
 * @param {number} [options.maxDelayMs=30000] - Ceiling for backoff delay
 * @param {Function} [options.retryableError] - Predicate: (err) => boolean. Defaults to isCosmosRetryable.
 * @param {Function} [options.onRetry] - Called before each retry with { attempt, delay, error }
 * @returns {Promise<*>} Result of fn()
 * @throws The last error if all attempts fail, or immediately for non-retryable errors
 */
async function retryWithBackoff(fn, options = {}) {
  const {
    maxAttempts = 5,
    initialDelayMs = 1000,
    maxDelayMs = 30_000,
    retryableError = isCosmosRetryable,
    onRetry = null,
  } = options;

  // Circuit breaker: fail fast during sustained outage
  if (isBreakerOpen()) {
    const err = new Error('Circuit breaker open — Cosmos DB under sustained pressure');
    err.code = 'CIRCUIT_BREAKER_OPEN';
    err.reopensAt = breaker.openUntil;
    throw err;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      // Success: relieve one unit of breaker pressure
      if (breaker.throttleEvents > 0) breaker.throttleEvents--;
      return result;
    } catch (err) {
      // Non-retryable errors fail fast — don't consume retry budget
      if (!retryableError(err) || attempt === maxAttempts) {
        throw err;
      }

      // Record throttle event for circuit breaker (every 429 counts)
      recordThrottle();

      // Check if breaker just opened from this event
      if (isBreakerOpen()) {
        const breakerErr = new Error('Circuit breaker opened during retry — Cosmos DB under sustained pressure');
        breakerErr.code = 'CIRCUIT_BREAKER_OPEN';
        breakerErr.reopensAt = breaker.openUntil;
        breakerErr.cause = err;
        throw breakerErr;
      }

      // Calculate delay: honor server-provided RetryAfterMs, fall back to exponential + jitter
      const serverDelay = parseRetryAfterMs(err);
      const exponential = initialDelayMs * Math.pow(2, attempt - 1);
      const base = serverDelay != null ? serverDelay : Math.min(exponential, maxDelayMs);
      // Jitter: randomize between 50%-100% of base to desynchronize concurrent retriers
      const jittered = Math.round(base * (0.5 + Math.random() * 0.5));

      if (onRetry) {
        onRetry({ attempt, delay: jittered, error: err, maxAttempts });
      }

      await new Promise(r => setTimeout(r, jittered));
    }
  }
}

// ---------------------------------------------------------------------------
// Test support: reset breaker state between tests
// ---------------------------------------------------------------------------

function _resetBreakerForTest(options) {
  breaker = createCircuitBreaker(options);
}

function _getBreakerState() {
  return { ...breaker };
}

module.exports = {
  retryWithBackoff,
  isCosmosRetryable,
  parseRetryAfterMs,
  isBreakerOpen,
};

// Test-only exports — guarded so production code cannot accidentally reset the breaker
if (process.env.NODE_ENV !== 'production') {
  module.exports._resetBreakerForTest = _resetBreakerForTest;
  module.exports._getBreakerState = _getBreakerState;
}
