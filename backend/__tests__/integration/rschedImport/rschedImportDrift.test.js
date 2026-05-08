/**
 * Resource Scheduler Drift Detection / All-Time Reconciliation Tests (DR-1 through DR-11).
 *
 * Covers the all-time scope, field-level drift detection at validate time,
 * and the drift report endpoint. Companion suite to rschedImportService.test.js
 * and rschedImportEndpoints.test.js.
 *
 * Test layout (incrementally filled in across commits 1-7):
 *   DR-1   all-time scope: no date filter applied to existing-events query
 *   DR-2   validate computes materialDiffs for matched rows with material differences
 *   DR-3   validate marks driftType: 'no_op' when zero material diffs
 *   DR-4   validate marks driftType: 'human_edit_conflict' (audit-side branch)
 *   DR-5   drift report JSON endpoint returns correct buckets
 *   DR-6   drift report CSV endpoint returns valid CSV
 *   DR-7   all-time mode with empty CSV treats all rsched-source events as removals
 *   DR-8   batchInsertStagingDocs batches at 500 rows
 *   DR-9   materialDiffs persistence truncates to MAX_DIFF_VALUE_LENGTH
 *   DR-10  computeStagingRowDrift bulk-prefetches existing events (one find call)
 *   DR-11  batchInsertStagingDocs retries on Cosmos 429
 */

const rschedImportService = require('../../../services/rschedImportService');
const { _resetBreakerForTest } = require('../../../utils/retryWithBackoff');

const { batchInsertStagingDocs } = rschedImportService;

describe('rsched import drift detection (DR-1 through DR-11)', () => {
  // -------------------------------------------------------------------------
  // Unit tests for batchInsertStagingDocs (DR-8, DR-11)
  // No DB needed — pass a fake collection with a controllable insertMany.
  // -------------------------------------------------------------------------
  describe('batchInsertStagingDocs', () => {
    beforeEach(() => {
      // Reset the process-level circuit breaker so retries from prior tests
      // don't leak into this one.
      if (_resetBreakerForTest) _resetBreakerForTest();
    });

    test('DR-8: batches inserts at 500 rows by default', async () => {
      const fakeCollection = {
        insertMany: jest.fn(async (batch) => ({
          insertedCount: batch.length,
          acknowledged: true,
        })),
      };
      const docs = Array.from({ length: 1234 }, (_, i) => ({
        rsId: i,
        eventTitle: `Event ${i}`,
      }));

      const inserted = await batchInsertStagingDocs(fakeCollection, docs, {
        batchSize: 500,
        delayMs: 0,
        retryOptions: { maxAttempts: 1, initialDelayMs: 1 },
      });

      // 1234 / 500 = 2 full batches + 1 remainder = 3 calls
      expect(fakeCollection.insertMany).toHaveBeenCalledTimes(3);
      const batchSizes = fakeCollection.insertMany.mock.calls.map(([b]) => b.length);
      expect(batchSizes).toEqual([500, 500, 234]);
      expect(inserted).toBe(1234);

      // ordered: false is required so a single duplicate-key error doesn't
      // halt the whole batch. The runRschedStagingPipeline wraps this in a
      // deleteMany first, so duplicates aren't a real concern, but unordered
      // is the safe default.
      fakeCollection.insertMany.mock.calls.forEach(([, opts]) => {
        expect(opts).toMatchObject({ ordered: false });
      });
    });

    test('DR-8: returns 0 and skips insertMany for empty input', async () => {
      const fakeCollection = { insertMany: jest.fn() };
      const inserted = await batchInsertStagingDocs(fakeCollection, [], {
        batchSize: 500,
        delayMs: 0,
        retryOptions: { maxAttempts: 1, initialDelayMs: 1 },
      });
      expect(inserted).toBe(0);
      expect(fakeCollection.insertMany).not.toHaveBeenCalled();
    });

    test('DR-8: smaller batch size respected (e.g. 100)', async () => {
      const fakeCollection = {
        insertMany: jest.fn(async (batch) => ({ insertedCount: batch.length })),
      };
      const docs = Array.from({ length: 250 }, (_, i) => ({ rsId: i }));
      await batchInsertStagingDocs(fakeCollection, docs, {
        batchSize: 100,
        delayMs: 0,
        retryOptions: { maxAttempts: 1, initialDelayMs: 1 },
      });
      expect(fakeCollection.insertMany).toHaveBeenCalledTimes(3);
      const batchSizes = fakeCollection.insertMany.mock.calls.map(([b]) => b.length);
      expect(batchSizes).toEqual([100, 100, 50]);
    });

    test('DR-11: retries on Cosmos 429 (code 16500) and succeeds', async () => {
      const cosmosThrottle = new Error(
        'Request rate is large. More Request Units may be needed. RetryAfterMs=1',
      );
      cosmosThrottle.code = 16500;

      let attempts = 0;
      const fakeCollection = {
        insertMany: jest.fn(async (batch) => {
          attempts++;
          if (attempts === 1) throw cosmosThrottle;
          return { insertedCount: batch.length, acknowledged: true };
        }),
      };
      const docs = Array.from({ length: 5 }, (_, i) => ({ rsId: i }));

      const inserted = await batchInsertStagingDocs(fakeCollection, docs, {
        batchSize: 500,
        delayMs: 0,
        retryOptions: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 5 },
      });

      expect(attempts).toBe(2); // 1 fail + 1 success
      expect(fakeCollection.insertMany).toHaveBeenCalledTimes(2);
      expect(inserted).toBe(5);
    });

    test('DR-11: non-retryable error fails immediately without consuming retry budget', async () => {
      const validationErr = new Error('Document failed validation');
      validationErr.code = 121; // not a Cosmos throttle

      const fakeCollection = {
        insertMany: jest.fn(async () => {
          throw validationErr;
        }),
      };
      const docs = [{ rsId: 1 }, { rsId: 2 }];

      await expect(
        batchInsertStagingDocs(fakeCollection, docs, {
          batchSize: 500,
          delayMs: 0,
          retryOptions: { maxAttempts: 5, initialDelayMs: 1 },
        }),
      ).rejects.toThrow('Document failed validation');

      // Should NOT have retried — non-Cosmos error fails fast
      expect(fakeCollection.insertMany).toHaveBeenCalledTimes(1);
    });

    test('DR-11: throws after exhausting maxAttempts on persistent 429', async () => {
      const cosmosThrottle = new Error('Request rate is large');
      cosmosThrottle.code = 16500;

      const fakeCollection = {
        insertMany: jest.fn(async () => {
          throw cosmosThrottle;
        }),
      };
      const docs = [{ rsId: 1 }];

      await expect(
        batchInsertStagingDocs(fakeCollection, docs, {
          batchSize: 500,
          delayMs: 0,
          retryOptions: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 5 },
        }),
      ).rejects.toThrow(/Request rate is large/);

      expect(fakeCollection.insertMany).toHaveBeenCalledTimes(3);
    });
  });

  // -------------------------------------------------------------------------
  // Integration tests (DR-1, DR-2, DR-3, DR-4, DR-5, DR-6, DR-7, DR-9, DR-10)
  // Filled in by commits 2-5 once the supporting helpers exist.
  // -------------------------------------------------------------------------
  describe.skip('all-time scope and field-level drift (filled in commits 2-5)', () => {
    test('DR-1: upload with allTime=true skips date filter on existing-events query', () => {
      // TODO: filled in commit 3
    });
    test('DR-2: validate computes materialDiffs for matched-with-differences rows', () => {
      // TODO: filled in commit 4
    });
    test('DR-3: validate marks driftType: no_op for matched-no-diff rows', () => {
      // TODO: filled in commit 4
    });
    test('DR-4: validate marks driftType: human_edit_conflict via audit-side branch', () => {
      // TODO: filled in commit 4
    });
    test('DR-5: drift report JSON returns correct buckets', () => {
      // TODO: filled in commit 5
    });
    test('DR-6: drift report CSV is valid long-format', () => {
      // TODO: filled in commit 5
    });
    test('DR-7: all-time mode with empty CSV treats all rsched events as removals', () => {
      // TODO: filled in commit 3
    });
    test('DR-9: materialDiffs truncated to MAX_DIFF_VALUE_LENGTH on persist', () => {
      // TODO: filled in commit 4
    });
    test('DR-10: computeStagingRowDrift bulk-prefetches existing events (one find call)', () => {
      // TODO: filled in commit 4
    });
  });
});
