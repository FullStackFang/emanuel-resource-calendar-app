/**
 * Unit tests for the shared Microsoft Graph retry policy.
 *
 * These lock in the two bugs that made the previous inline predicate dead code:
 *   1. graphApiService throws `status`, every predicate read `statusCode`.
 *   2. undici's fetch never puts the OS error code on the thrown error — it is
 *      one level down on `err.cause.code`.
 * and the breaker isolation that the dead predicate was masking.
 */

const {
  withGraphRetry,
  isRetryableGraphError,
  _resetGraphBreakerForTest,
  _getGraphBreakerState,
} = require('../../../utils/graphRetry');
const {
  isBreakerOpen,
  _resetBreakerForTest,
  _getBreakerState,
} = require('../../../utils/retryWithBackoff');
const { buildGraphError } = require('../../../utils/graphError');
const graphApiMock = require('../../__helpers__/graphApiMock');

// Real backoff sleeps for seconds; these tests only care about call counts.
const FAST = { initialDelayMs: 1, maxDelayMs: 2 };

describe('isRetryableGraphError', () => {
  it('matches the `status` graphApiService actually throws', () => {
    expect(isRetryableGraphError(buildGraphError(429, 'Too many requests'))).toBe(true);
    expect(isRetryableGraphError(buildGraphError(503, 'Service unavailable'))).toBe(true);
  });

  it('still matches the legacy `statusCode` shape', () => {
    expect(isRetryableGraphError(Object.assign(new Error('x'), { statusCode: 429 }))).toBe(true);
  });

  it('does not retry client errors or a plain 500', () => {
    expect(isRetryableGraphError(buildGraphError(404, 'Not found'))).toBe(false);
    expect(isRetryableGraphError(buildGraphError(400, 'Bad request'))).toBe(false);
    expect(isRetryableGraphError(buildGraphError(500, 'Boom'))).toBe(false);
  });

  // Verified against Node v22.16.0: fetch rejects with TypeError('fetch failed')
  // and the OS code lives on err.cause.code, never on err.code.
  it('reads the network code from err.cause, the way undici reports it', () => {
    for (const code of ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'UND_ERR_SOCKET']) {
      expect(isRetryableGraphError(graphApiMock.graphNetworkError(code))).toBe(true);
    }
  });

  it('still matches a top-level code for non-undici clients', () => {
    expect(isRetryableGraphError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toBe(true);
  });

  // AbortSignal.timeout rejects with a DOMException whose `code` is the NUMBER
  // 23, so the predicate must string-check before comparing.
  it('matches an aborted-by-timeout DOMException without tripping on its numeric code', () => {
    const abort = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError', code: 23,
    });
    expect(isRetryableGraphError(abort)).toBe(true);
    expect(isRetryableGraphError(Object.assign(new Error('other'), { code: 23 }))).toBe(false);
  });

  it('is false for nothing', () => {
    expect(isRetryableGraphError(null)).toBe(false);
    expect(isRetryableGraphError(undefined)).toBe(false);
  });
});

describe('withGraphRetry', () => {
  beforeEach(() => {
    _resetGraphBreakerForTest();
    _resetBreakerForTest();
  });

  // The regression: with the old `statusCode` predicate this ran the operation
  // exactly ONCE and surfaced the 429 as a hard failure.
  it('retries a production-shaped 429 up to its attempt budget', async () => {
    const op = jest.fn().mockRejectedValue(graphApiMock.graphError(429, 'Too many requests'));

    await expect(withGraphRetry(op, FAST)).rejects.toThrow('Too many requests');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('retries an undici network failure', async () => {
    const op = jest.fn().mockRejectedValue(graphApiMock.graphNetworkError('ECONNRESET'));

    await expect(withGraphRetry(op, FAST)).rejects.toThrow('fetch failed');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('fails fast on a non-retryable status', async () => {
    const op = jest.fn().mockRejectedValue(graphApiMock.graphError(404, 'Not found'));

    await expect(withGraphRetry(op, FAST)).rejects.toThrow('Not found');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('returns the value on success without touching the breaker', async () => {
    await expect(withGraphRetry(async () => 'ok', FAST)).resolves.toBe('ok');
    expect(_getGraphBreakerState().throttleEvents).toBe(0);
  });
});

describe('Graph breaker isolation from Cosmos', () => {
  beforeEach(() => {
    // Graph trips easily; Cosmos keeps production settings.
    _resetGraphBreakerForTest({ threshold: 3, warnThreshold: 2, cooldownMs: 60_000, decayIntervalMs: 999_999 });
    _resetBreakerForTest({ threshold: 3, warnThreshold: 2, cooldownMs: 60_000, decayIntervalMs: 999_999 });
  });

  afterAll(() => {
    _resetGraphBreakerForTest();
    _resetBreakerForTest();
  });

  // Before the split, a Graph throttling burst opened the SHARED breaker, which
  // then rejected every Cosmos retry in the process for a full cooldown — a
  // completely unrelated dependency taking the database offline.
  it('a Graph 429 burst leaves the Cosmos breaker untouched', async () => {
    const op = jest.fn().mockRejectedValue(graphApiMock.graphError(429, 'Too many requests'));

    // Enough Graph failures to trip the Graph breaker several times over.
    for (let i = 0; i < 4; i++) {
      await withGraphRetry(op, FAST).catch(() => {});
    }

    expect(_getBreakerState().throttleEvents).toBe(0);
    expect(_getBreakerState().openUntil).toBe(0);
    expect(isBreakerOpen()).toBe(false);
  });
});
