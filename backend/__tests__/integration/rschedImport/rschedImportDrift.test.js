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

const {
  connectToGlobalServer,
  disconnectFromGlobalServer,
  clearCollections,
} = require('../../__helpers__/testSetup');
const { COLLECTIONS, TEST_CALENDAR_OWNER } = require('../../__helpers__/testConstants');

const rschedImportService = require('../../../services/rschedImportService');
const { _resetBreakerForTest } = require('../../../utils/retryWithBackoff');

const {
  batchInsertStagingDocs,
  computePreview,
  detectRemovedRsIds,
  STAGING_COLLECTION,
  STAGING_STATUS,
  RSCHED_SOURCE,
} = rschedImportService;

const IMPORT_USER_ID = '69fda879-0c61-4aa5-b02d-cad292c0777e';

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
  // Integration tests against MongoDB Memory Server.
  // -------------------------------------------------------------------------
  describe('all-time scope (DR-1, DR-7)', () => {
    let mongoClient;
    let db;

    beforeAll(async () => {
      ({ db, client: mongoClient } = await connectToGlobalServer('rschedImportDrift'));
    });

    afterAll(async () => {
      await disconnectFromGlobalServer(mongoClient, db);
    });

    beforeEach(async () => {
      await clearCollections(db);
    });

    test('DR-1: computePreview in all-time mode finds events outside any date range', async () => {
      const eventsCol = db.collection(COLLECTIONS.EVENTS);
      const stagingCol = db.collection(STAGING_COLLECTION);

      // Seed 3 rsched events spanning ten years — far outside any reasonable date window.
      await eventsCol.insertMany([
        {
          eventId: 'rssched-1001',
          source: RSCHED_SOURCE,
          calendarOwner: TEST_CALENDAR_OWNER.toLowerCase(),
          isDeleted: false,
          startDateTime: '2018-01-15T10:00:00',
          rschedData: { rsId: 1001 },
        },
        {
          eventId: 'rssched-1002',
          source: RSCHED_SOURCE,
          calendarOwner: TEST_CALENDAR_OWNER.toLowerCase(),
          isDeleted: false,
          startDateTime: '2024-06-01T14:00:00',
          rschedData: { rsId: 1002 },
        },
        {
          eventId: 'rssched-1003',
          source: RSCHED_SOURCE,
          calendarOwner: TEST_CALENDAR_OWNER.toLowerCase(),
          isDeleted: false,
          startDateTime: '2030-12-25T09:00:00',
          rschedData: { rsId: 1003 },
        },
      ]);

      // Seed staging session: only 1 row (rsId=1002) so 1001 and 1003 should appear as removals.
      const sessionId = 'test-session-dr1';
      await stagingCol.insertOne({
        sessionId,
        uploadedBy: IMPORT_USER_ID,
        uploadedAt: new Date(),
        calendarOwner: TEST_CALENDAR_OWNER.toLowerCase(),
        rsId: 1002,
        status: STAGING_STATUS.STAGED,
        startDateTime: '2024-06-01T14:00:00',
      });

      // Date-bounded mode for comparison: only events in 2024 are visible.
      const boundedPreview = await computePreview(db, {
        sessionId,
        calendarOwner: TEST_CALENDAR_OWNER,
        dateRangeStart: '2024-01-01',
        dateRangeEnd: '2024-12-31',
      });
      expect(boundedPreview.dateRange.allTime).toBe(false);
      expect(boundedPreview.existingInRange.fromRsched).toBe(1); // only rsId 1002

      // All-time mode: all 3 events found, regardless of year.
      const allTimePreview = await computePreview(db, {
        sessionId,
        calendarOwner: TEST_CALENDAR_OWNER,
        dateRangeStart: null,
        dateRangeEnd: null,
      });
      expect(allTimePreview.dateRange).toEqual({
        allTime: true,
        start: null,
        end: null,
        days: null,
      });
      expect(allTimePreview.existingInRange.fromRsched).toBe(3);
      // 1001 and 1003 are missing from the CSV — both should be removal candidates.
      expect(allTimePreview.plannedActions.willRemove).toBe(2);
      expect(allTimePreview.removalCandidates.map((r) => r.rsId).sort()).toEqual([1001, 1003]);
    });

    test('DR-7: all-time mode with no-match staging treats all rsched events as removals', async () => {
      const eventsCol = db.collection(COLLECTIONS.EVENTS);
      const stagingCol = db.collection(STAGING_COLLECTION);

      // Seed 5 existing rsched events.
      const existing = Array.from({ length: 5 }, (_, i) => ({
        eventId: `rssched-${2000 + i}`,
        source: RSCHED_SOURCE,
        calendarOwner: TEST_CALENDAR_OWNER.toLowerCase(),
        isDeleted: false,
        startDateTime: `2026-0${i + 1}-01T10:00:00`,
        rschedData: { rsId: 2000 + i },
      }));
      await eventsCol.insertMany(existing);

      // Stage 1 row whose rsId DOES NOT match any existing event — every existing rsched
      // event should be a removal candidate.
      const sessionId = 'test-session-dr7';
      await stagingCol.insertOne({
        sessionId,
        uploadedBy: IMPORT_USER_ID,
        uploadedAt: new Date(),
        calendarOwner: TEST_CALENDAR_OWNER.toLowerCase(),
        rsId: 99999,
        status: STAGING_STATUS.STAGED,
        startDateTime: '2099-01-01T00:00:00',
      });

      const preview = await computePreview(db, {
        sessionId,
        calendarOwner: TEST_CALENDAR_OWNER,
        dateRangeStart: null,
        dateRangeEnd: null,
      });

      expect(preview.dateRange.allTime).toBe(true);
      expect(preview.plannedActions.willRemove).toBe(5);
      expect(preview.removalCandidates.map((r) => r.rsId).sort((a, b) => a - b)).toEqual([
        2000, 2001, 2002, 2003, 2004,
      ]);

      // Direct call to detectRemovedRsIds with empty present list — all 5 should come back.
      const removed = await detectRemovedRsIds(
        db,
        {
          calendarOwner: TEST_CALENDAR_OWNER,
          dateRangeStart: null,
          dateRangeEnd: null,
        },
        [],
      );
      expect(removed).toHaveLength(5);
    });
  });

  // -------------------------------------------------------------------------
  // Placeholders for commits 4 and 5.
  // -------------------------------------------------------------------------
  describe.skip('field-level drift (filled in commits 4-5)', () => {
    test('DR-2: validate computes materialDiffs for matched-with-differences rows', () => {});
    test('DR-3: validate marks driftType: no_op for matched-no-diff rows', () => {});
    test('DR-4: validate marks driftType: human_edit_conflict via audit-side branch', () => {});
    test('DR-5: drift report JSON returns correct buckets', () => {});
    test('DR-6: drift report CSV is valid long-format', () => {});
    test('DR-9: materialDiffs truncated to MAX_DIFF_VALUE_LENGTH on persist', () => {});
    test('DR-10: computeStagingRowDrift bulk-prefetches existing events (one find call)', () => {});
  });
});
