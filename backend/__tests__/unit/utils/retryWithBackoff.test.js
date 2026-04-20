/**
 * Unit tests for retryWithBackoff.js
 *
 * Tests the shared retry utility including exponential backoff with jitter,
 * Cosmos DB error detection, and process-level circuit breaker.
 *
 * Test IDs: RB-1 through RB-18
 */

const {
  retryWithBackoff,
  isCosmosRetryable,
  parseRetryAfterMs,
  isBreakerOpen,
  _resetBreakerForTest,
  _getBreakerState,
} = require('../../../utils/retryWithBackoff');

// Suppress logger output during tests
jest.mock('../../../utils/logger', () => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  isDebugEnabled: () => false,
}));

const logger = require('../../../utils/logger');

beforeEach(() => {
  _resetBreakerForTest();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: create a Cosmos-style 16500 error
// ---------------------------------------------------------------------------
function cosmosError(retryAfterMs = null) {
  const err = new Error(
    retryAfterMs != null
      ? `Request rate is large. More Request Units may be needed. RetryAfterMs=${retryAfterMs}`
      : 'Request rate is large'
  );
  err.code = 16500;
  return err;
}

function nonRetryableError(message = 'Unauthorized') {
  const err = new Error(message);
  err.code = 13;
  return err;
}

// ---------------------------------------------------------------------------
// isCosmosRetryable
// ---------------------------------------------------------------------------
describe('isCosmosRetryable', () => {
  it('RB-1: detects code 16500', () => {
    expect(isCosmosRetryable({ code: 16500, message: '' })).toBe(true);
  });

  it('RB-2: detects codeName RequestRateTooLarge', () => {
    expect(isCosmosRetryable({ codeName: 'RequestRateTooLarge', message: '' })).toBe(true);
  });

  it('RB-3: detects message containing RetryAfterMs', () => {
    expect(isCosmosRetryable({ message: 'blah RetryAfterMs=1234 blah' })).toBe(true);
  });

  it('RB-4: detects message containing TooManyRequests', () => {
    expect(isCosmosRetryable({ message: 'TooManyRequests' })).toBe(true);
  });

  it('RB-5: returns false for non-Cosmos errors', () => {
    expect(isCosmosRetryable({ code: 13, message: 'Unauthorized' })).toBe(false);
    expect(isCosmosRetryable(null)).toBe(false);
    expect(isCosmosRetryable(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseRetryAfterMs
// ---------------------------------------------------------------------------
describe('parseRetryAfterMs', () => {
  it('RB-6: extracts delay from Cosmos error message', () => {
    const err = { message: 'Request rate is large. RetryAfterMs=3400. Please retry.' };
    expect(parseRetryAfterMs(err)).toBe(3400);
  });

  it('RB-7: returns null when not present', () => {
    expect(parseRetryAfterMs({ message: 'some other error' })).toBeNull();
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs({ message: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// retryWithBackoff — happy path
// ---------------------------------------------------------------------------
describe('retryWithBackoff — success paths', () => {
  it('RB-8: succeeds on first attempt without retry', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('RB-9: succeeds after transient Cosmos 16500 failure', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(cosmosError())
      .mockResolvedValue('recovered');

    const onRetry = jest.fn();
    const result = await retryWithBackoff(fn, {
      maxAttempts: 3,
      initialDelayMs: 10,
      onRetry,
    });

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
      attempt: 1,
      maxAttempts: 3,
    }));
  });
});

// ---------------------------------------------------------------------------
// retryWithBackoff — failure paths
// ---------------------------------------------------------------------------
describe('retryWithBackoff — failure paths', () => {
  it('RB-10: throws after exhausting maxAttempts', async () => {
    const err = cosmosError();
    const fn = jest.fn().mockRejectedValue(err);

    await expect(retryWithBackoff(fn, { maxAttempts: 3, initialDelayMs: 10 }))
      .rejects.toThrow('Request rate is large');

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('RB-11: non-retryable error fails fast on first attempt', async () => {
    const fn = jest.fn().mockRejectedValue(nonRetryableError());

    await expect(retryWithBackoff(fn, { maxAttempts: 5, initialDelayMs: 10 }))
      .rejects.toThrow('Unauthorized');

    // Must NOT consume retry budget — only 1 call
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('RB-12: non-retryable error after successful retries still fails fast', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(cosmosError())       // attempt 1: retryable
      .mockRejectedValueOnce(nonRetryableError()); // attempt 2: not retryable

    await expect(retryWithBackoff(fn, { maxAttempts: 5, initialDelayMs: 10 }))
      .rejects.toThrow('Unauthorized');

    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// retryWithBackoff — delay behavior
// ---------------------------------------------------------------------------
describe('retryWithBackoff — delay behavior', () => {
  it('RB-13: honors Cosmos RetryAfterMs over exponential backoff', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(cosmosError(5000)) // server says wait 5000ms
      .mockResolvedValue('ok');

    const onRetry = jest.fn();
    await retryWithBackoff(fn, {
      maxAttempts: 3,
      initialDelayMs: 100,
      onRetry,
    });

    // Jittered delay should be between 50%-100% of 5000ms = [2500, 5000]
    const { delay } = onRetry.mock.calls[0][0];
    expect(delay).toBeGreaterThanOrEqual(2500);
    expect(delay).toBeLessThanOrEqual(5000);
  });

  it('RB-14: exponential backoff with jitter stays within bounds', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(cosmosError()) // no RetryAfterMs
      .mockRejectedValueOnce(cosmosError())
      .mockResolvedValue('ok');

    const delays = [];
    await retryWithBackoff(fn, {
      maxAttempts: 4,
      initialDelayMs: 100,
      maxDelayMs: 500,
      onRetry: ({ delay }) => delays.push(delay),
    });

    // Attempt 1: base = min(100 * 2^0, 500) = 100 → jitter [50, 100]
    expect(delays[0]).toBeGreaterThanOrEqual(50);
    expect(delays[0]).toBeLessThanOrEqual(100);

    // Attempt 2: base = min(100 * 2^1, 500) = 200 → jitter [100, 200]
    expect(delays[1]).toBeGreaterThanOrEqual(100);
    expect(delays[1]).toBeLessThanOrEqual(200);
  });
});

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------
describe('circuit breaker', () => {
  it('RB-15: opens after threshold throttle events across callers', async () => {
    // Set low threshold for testing
    _resetBreakerForTest({ threshold: 3, warnThreshold: 2, cooldownMs: 60_000, decayIntervalMs: 999_999 });

    // Each call fails on attempt 1 with retryable error, exhausts 2 attempts = 2 throttle events per call
    const fn = jest.fn().mockRejectedValue(cosmosError());

    // Call 1: 1 throttle event (attempt 1 is retryable, attempt 2 exhausts = throw, not recorded)
    // Actually: attempt 1 fails → recordThrottle (events=1) → attempt 2 fails → throw (non-retry path)
    await expect(retryWithBackoff(fn, { maxAttempts: 2, initialDelayMs: 1 })).rejects.toThrow();

    // Call 2: throttle events = 2 → warning logged
    await expect(retryWithBackoff(fn, { maxAttempts: 2, initialDelayMs: 1 })).rejects.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Circuit breaker at'),
      expect.any(Number), expect.any(Number)
    );

    // Call 3: throttle events = 3 → breaker opens
    await expect(retryWithBackoff(fn, { maxAttempts: 2, initialDelayMs: 1 })).rejects.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Circuit breaker OPEN'),
      expect.any(Number), expect.any(Number)
    );

    expect(isBreakerOpen()).toBe(true);
  });

  it('RB-16: rejects immediately when breaker is open', async () => {
    _resetBreakerForTest({ threshold: 1, warnThreshold: 1, cooldownMs: 60_000, decayIntervalMs: 999_999 });

    // Trip the breaker
    const fn = jest.fn().mockRejectedValue(cosmosError());
    await expect(retryWithBackoff(fn, { maxAttempts: 2, initialDelayMs: 1 })).rejects.toThrow();

    // Next call should fail immediately without calling fn
    const fn2 = jest.fn().mockResolvedValue('should not be called');
    await expect(retryWithBackoff(fn2)).rejects.toThrow('Circuit breaker open');
    expect(fn2).not.toHaveBeenCalled();

    // Error should include reopensAt and code
    try {
      await retryWithBackoff(fn2);
    } catch (err) {
      expect(err.code).toBe('CIRCUIT_BREAKER_OPEN');
      expect(typeof err.reopensAt).toBe('number');
    }
  });

  it('RB-17: breaker closes after cooldown expires', async () => {
    _resetBreakerForTest({ threshold: 1, warnThreshold: 1, cooldownMs: 50, decayIntervalMs: 999_999 });

    // Trip the breaker
    const fn = jest.fn().mockRejectedValue(cosmosError());
    await expect(retryWithBackoff(fn, { maxAttempts: 2, initialDelayMs: 1 })).rejects.toThrow();
    expect(isBreakerOpen()).toBe(true);

    // Wait for cooldown
    await new Promise(r => setTimeout(r, 60));

    expect(isBreakerOpen()).toBe(false);

    // Should be able to call again
    const fn2 = jest.fn().mockResolvedValue('recovered');
    const result = await retryWithBackoff(fn2);
    expect(result).toBe('recovered');
  });

  it('RB-18: throttle events decay over time', async () => {
    _resetBreakerForTest({ threshold: 5, warnThreshold: 3, cooldownMs: 60_000, decayIntervalMs: 50 });

    // Record 2 throttle events
    const fn = jest.fn().mockRejectedValue(cosmosError());
    await expect(retryWithBackoff(fn, { maxAttempts: 2, initialDelayMs: 1 })).rejects.toThrow();
    await expect(retryWithBackoff(fn, { maxAttempts: 2, initialDelayMs: 1 })).rejects.toThrow();

    const before = _getBreakerState().throttleEvents;
    expect(before).toBe(2);

    // Wait for decay intervals to pass
    await new Promise(r => setTimeout(r, 120));

    // Trigger decay by calling a successful operation
    const fn2 = jest.fn().mockResolvedValue('ok');
    await retryWithBackoff(fn2);

    const after = _getBreakerState().throttleEvents;
    expect(after).toBeLessThan(before);
  });
});
