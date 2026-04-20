/**
 * Unit tests for batchDelete.js
 *
 * Tests the extracted batch delete utility that replaces inline while loops
 * in route handlers. Validates bounded retry behavior, partial progress
 * reporting, and non-retryable fast-fail.
 *
 * Test IDs: BD-1 through BD-8
 */

const { batchDelete } = require('../../../utils/batchDelete');
const { _resetBreakerForTest } = require('../../../utils/retryWithBackoff');

// Suppress logger output during tests
jest.mock('../../../utils/logger', () => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  isDebugEnabled: () => false,
}));

beforeEach(() => {
  _resetBreakerForTest();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers: mock MongoDB collection
// ---------------------------------------------------------------------------

/**
 * Create a mock collection with configurable find/deleteMany behavior.
 * @param {Array} docs - Documents to "store". find() returns slices; deleteMany() removes by _id.
 * @param {Object} [overrides] - Override deleteMany behavior
 */
function mockCollection(docs, overrides = {}) {
  let remaining = [...docs];

  const collection = {
    find: jest.fn((query, options) => ({
      limit: jest.fn((n) => ({
        toArray: jest.fn(async () => remaining.slice(0, n)),
      })),
    })),
    deleteMany: overrides.deleteMany || jest.fn(async ({ _id }) => {
      const idsToDelete = _id.$in;
      const before = remaining.length;
      remaining = remaining.filter(d => !idsToDelete.some(id => id === d._id));
      return { deletedCount: before - remaining.length };
    }),
  };

  // Expose for assertions
  collection._getRemaining = () => remaining;
  return collection;
}

function makeDocs(n) {
  return Array.from({ length: n }, (_, i) => ({ _id: `id-${i}` }));
}

function cosmosError(retryAfterMs = null) {
  const err = new Error(
    retryAfterMs != null
      ? `Request rate is large. RetryAfterMs=${retryAfterMs}`
      : 'Request rate is large'
  );
  err.code = 16500;
  return err;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('batchDelete', () => {
  it('BD-1: deletes all documents in batches and reports progress', async () => {
    const docs = makeDocs(5);
    const collection = mockCollection(docs);
    const onProgress = jest.fn();

    const result = await batchDelete(collection, { isCSVImport: true }, {
      batchSize: 2,
      batchDelayMs: 0,
      onProgress,
    });

    expect(result.totalDeleted).toBe(5);
    expect(result.totalProcessed).toBe(5);
    expect(result.errors).toHaveLength(0);
    // 3 batches: [2, 2, 1] then empty batch exits
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(collection._getRemaining()).toHaveLength(0);
  });

  it('BD-2: returns immediately with zero counts when no documents match', async () => {
    const collection = mockCollection([]);
    const onProgress = jest.fn();

    const result = await batchDelete(collection, { isCSVImport: true }, {
      batchDelayMs: 0,
      onProgress,
    });

    expect(result.totalDeleted).toBe(0);
    expect(result.totalProcessed).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('BD-3: exits after persistent deleteMany failure instead of looping', async () => {
    const docs = makeDocs(10);
    // deleteMany always fails with a non-Cosmos error (no retries)
    const deleteMany = jest.fn().mockRejectedValue(new Error('persistent disk failure'));
    const collection = mockCollection(docs, { deleteMany });

    const result = await batchDelete(collection, {}, {
      batchSize: 3,
      batchDelayMs: 0,
      retryOptions: { maxAttempts: 2, initialDelayMs: 1 },
    });

    // Non-retryable error: fails fast, 1 attempt only, then breaks
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(result.totalDeleted).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('persistent disk failure');
  });

  it('BD-4: reports partial progress when mid-batch failure occurs', async () => {
    // 10 docs, batchSize 3 → batches of [3, 3, 3, 1]
    // Batches 1-2 succeed, batch 3 fails persistently
    const docs = makeDocs(10);
    let callCount = 0;
    const deleteMany = jest.fn(async ({ _id }) => {
      callCount++;
      if (callCount >= 3) {
        throw cosmosError();
      }
      const idsToDelete = _id.$in;
      return { deletedCount: idsToDelete.length };
    });

    // Override find to always return a fresh batch (simulates docs not being removed on mock)
    let findCallCount = 0;
    const collection = {
      find: jest.fn(() => ({
        limit: jest.fn((n) => ({
          toArray: jest.fn(async () => {
            const start = findCallCount * 3;
            findCallCount++;
            const batch = docs.slice(start, start + n);
            return batch;
          }),
        })),
      })),
      deleteMany,
    };

    const onProgress = jest.fn();
    const result = await batchDelete(collection, {}, {
      batchSize: 3,
      batchDelayMs: 0,
      onProgress,
      // maxAttempts: 2 with Cosmos error → 2 attempts on batch 3, then gives up
      retryOptions: { maxAttempts: 2, initialDelayMs: 1 },
    });

    // 2 successful batches of 3 = 6 deleted, then batch 3 fails
    expect(result.totalDeleted).toBe(6);
    expect(result.totalProcessed).toBe(6);
    expect(result.errors).toHaveLength(1);
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it('BD-5: non-retryable error does not consume retry budget', async () => {
    const docs = makeDocs(3);
    const authError = new Error('Unauthorized');
    authError.code = 13;
    const deleteMany = jest.fn().mockRejectedValue(authError);
    const collection = mockCollection(docs, { deleteMany });

    const result = await batchDelete(collection, {}, {
      batchSize: 3,
      batchDelayMs: 0,
      retryOptions: { maxAttempts: 5, initialDelayMs: 1 },
    });

    // Auth error is not retryable — should fail on first attempt
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(result.totalDeleted).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('Unauthorized');
  });

  it('BD-6: retries Cosmos 16500 then succeeds', async () => {
    const docs = makeDocs(2);
    let attempt = 0;
    const deleteMany = jest.fn(async ({ _id }) => {
      attempt++;
      if (attempt === 1) throw cosmosError(10); // small RetryAfterMs for fast test
      const count = _id.$in.length;
      // Actually remove from the backing store so the loop terminates
      return { deletedCount: count };
    });

    // Need find to return empty on second call (after deletion)
    let findCall = 0;
    const collection = {
      find: jest.fn(() => ({
        limit: jest.fn((n) => ({
          toArray: jest.fn(async () => {
            findCall++;
            return findCall === 1 ? docs : [];
          }),
        })),
      })),
      deleteMany,
    };

    const result = await batchDelete(collection, {}, {
      batchSize: 10,
      batchDelayMs: 0,
      retryOptions: { maxAttempts: 3, initialDelayMs: 1 },
    });

    expect(deleteMany).toHaveBeenCalledTimes(2); // 1 fail + 1 success
    expect(result.totalDeleted).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it('BD-7: respects batchSize parameter', async () => {
    const docs = makeDocs(7);
    const collection = mockCollection(docs);

    await batchDelete(collection, {}, { batchSize: 3, batchDelayMs: 0 });

    // find() should be called with limit(3) each time
    for (const call of collection.find.mock.results) {
      const limitFn = call.value.limit;
      expect(limitFn).toHaveBeenCalledWith(3);
    }
  });

  it('BD-8: passes query to find() correctly', async () => {
    const docs = makeDocs(2);
    const collection = mockCollection(docs);
    const query = { userId: 'user-123', isCSVImport: true };

    await batchDelete(collection, query, { batchDelayMs: 0 });

    // First call to find should use the provided query
    expect(collection.find).toHaveBeenCalledWith(
      query,
      { projection: { _id: 1 } }
    );
  });
});
