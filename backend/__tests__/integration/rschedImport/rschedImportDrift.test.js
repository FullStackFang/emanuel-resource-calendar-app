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
  bulkComputeDrift,
  computeStagingRowDrift,
  STAGING_COLLECTION,
  STAGING_STATUS,
  RSCHED_SOURCE,
  DRIFT_TYPE,
  MAX_DIFF_VALUE_LENGTH,
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
  // Field-level drift detection (DR-2, DR-3, DR-4, DR-9, DR-10).
  // -------------------------------------------------------------------------
  describe('field-level drift (DR-2, DR-3, DR-4, DR-9, DR-10)', () => {
    let mongoClient;
    let db;

    beforeAll(async () => {
      ({ db, client: mongoClient } = await connectToGlobalServer('rschedImportDriftField'));
    });

    afterAll(async () => {
      await disconnectFromGlobalServer(mongoClient, db);
    });

    beforeEach(async () => {
      await clearCollections(db);
    });

    // Helper: build a staging-row + matching-event pair where both encode the
    // same logical event. The two share rsId so they will be join-matched by
    // bulkComputeDrift.
    function makeMatchedPair(rsId, overrides = {}) {
      const stagingRow = {
        sessionId: 'test-session-drift',
        uploadedBy: IMPORT_USER_ID,
        uploadedAt: new Date(),
        calendarOwner: TEST_CALENDAR_OWNER.toLowerCase(),
        rsId,
        rowNumber: rsId,
        rawCsv: { rsId: String(rsId) },
        eventTitle: 'Shared Title',
        eventDescription: 'Shared description',
        categories: ['CategoryA'],
        startDate: '2026-05-08',
        endDate: '2026-05-08',
        startTime: '10:00',
        endTime: '11:00',
        startDateTime: '2026-05-08T10:00:00',
        endDateTime: '2026-05-08T11:00:00',
        isAllDay: false,
        rsKey: '602',
        rsKeys: ['602'],
        locationIds: [],
        locationDisplayNames: '',
        locationStatus: 'matched',
        requesterEmail: '',
        requesterName: '',
        status: STAGING_STATUS.STAGED,
        ...overrides.staging,
      };
      const event = {
        eventId: `rssched-${rsId}`,
        source: RSCHED_SOURCE,
        calendarOwner: TEST_CALENDAR_OWNER.toLowerCase(),
        isDeleted: false,
        eventTitle: stagingRow.eventTitle,
        eventDescription: stagingRow.eventDescription,
        categories: [...stagingRow.categories],
        startDateTime: stagingRow.startDateTime,
        endDateTime: stagingRow.endDateTime,
        isAllDayEvent: stagingRow.isAllDay,
        locations: [],
        calendarData: {
          eventTitle: stagingRow.eventTitle,
          eventDescription: stagingRow.eventDescription,
          categories: [...stagingRow.categories],
          startDateTime: stagingRow.startDateTime,
          endDateTime: stagingRow.endDateTime,
          isAllDay: stagingRow.isAllDay,
          locations: [],
        },
        lastModifiedBy: IMPORT_USER_ID,
        rschedData: { rsId },
        ...overrides.event,
      };
      return { stagingRow, event };
    }

    test('DR-2: bulkComputeDrift returns driftType=update with materialDiffs for matched-with-differences rows', async () => {
      const { stagingRow, event } = makeMatchedPair(3001, {
        event: {
          // Existing event title differs from staging row's title.
          eventTitle: 'Old Title — Pre-Edit',
          calendarData: undefined, // overridden below
        },
      });
      // Re-set calendarData with the differing title so getMaterialField picks it up:
      event.calendarData = { ...event.calendarData, eventTitle: 'Old Title — Pre-Edit' };

      await db.collection(COLLECTIONS.EVENTS).insertOne(event);

      const results = await bulkComputeDrift(db, [stagingRow], {
        calendarOwner: TEST_CALENDAR_OWNER,
        importUserId: IMPORT_USER_ID,
      });

      expect(results).toHaveLength(1);
      expect(results[0].driftType).toBe(DRIFT_TYPE.UPDATE);
      expect(results[0].materialDiffs).toBeInstanceOf(Array);
      const titleDiff = results[0].materialDiffs.find((d) => d.field === 'eventTitle');
      expect(titleDiff).toBeDefined();
      expect(titleDiff.previous).toBe('Old Title — Pre-Edit');
      expect(titleDiff.csv).toBe('Shared Title');
      expect(titleDiff.truncated).toBe(false);
    });

    test('DR-3: bulkComputeDrift returns driftType=no_op for matched rows with zero material diffs', async () => {
      const { stagingRow, event } = makeMatchedPair(3002);
      await db.collection(COLLECTIONS.EVENTS).insertOne(event);

      const results = await bulkComputeDrift(db, [stagingRow], {
        calendarOwner: TEST_CALENDAR_OWNER,
        importUserId: IMPORT_USER_ID,
      });

      expect(results).toHaveLength(1);
      expect(results[0].driftType).toBe(DRIFT_TYPE.NO_OP);
      expect(results[0].materialDiffs).toEqual([]);
    });

    test('DR-4: bulkComputeDrift returns driftType=human_edit_conflict via audit-side branch', async () => {
      // Setup: existing event has lastModifiedBy = importUserId (so the cheap
      // lastModifiedBy mismatch check passes), but an audit row with a non-import
      // changeType exists. This forces hasHumanEdits's audit-side branch to fire.
      const { stagingRow, event } = makeMatchedPair(3003);
      await db.collection(COLLECTIONS.EVENTS).insertOne(event);
      await db.collection(COLLECTIONS.AUDIT_HISTORY).insertOne({
        eventId: event.eventId,
        userId: IMPORT_USER_ID,
        changeType: 'update',
        timestamp: new Date(),
      });

      const results = await bulkComputeDrift(db, [stagingRow], {
        calendarOwner: TEST_CALENDAR_OWNER,
        importUserId: IMPORT_USER_ID,
      });

      expect(results).toHaveLength(1);
      expect(results[0].driftType).toBe(DRIFT_TYPE.HUMAN_EDIT_CONFLICT);
    });

    test('DR-9: materialDiffs truncated to MAX_DIFF_VALUE_LENGTH on persist', async () => {
      // Existing description is 5000 chars; CSV description is a different 5000-char string.
      const longExistingDesc = 'X'.repeat(5000);
      const longCsvDesc = 'Y'.repeat(5000);
      const { stagingRow, event } = makeMatchedPair(3004, {
        staging: { eventDescription: longCsvDesc },
        event: { eventDescription: longExistingDesc },
      });
      event.calendarData = { ...event.calendarData, eventDescription: longExistingDesc };
      await db.collection(COLLECTIONS.EVENTS).insertOne(event);

      const results = await bulkComputeDrift(db, [stagingRow], {
        calendarOwner: TEST_CALENDAR_OWNER,
        importUserId: IMPORT_USER_ID,
      });

      const descDiff = results[0].materialDiffs.find((d) => d.field === 'eventDescription');
      expect(descDiff).toBeDefined();
      expect(descDiff.truncated).toBe(true);
      // The persisted value is MAX_DIFF_VALUE_LENGTH chars + '…(truncated)' suffix.
      const expectedLen = MAX_DIFF_VALUE_LENGTH + '…(truncated)'.length;
      expect(descDiff.previous.length).toBe(expectedLen);
      expect(descDiff.csv.length).toBe(expectedLen);
      expect(descDiff.previous.endsWith('…(truncated)')).toBe(true);
      expect(descDiff.csv.endsWith('…(truncated)')).toBe(true);
    });

    test('DR-10: bulkComputeDrift uses one find call against events regardless of row count', async () => {
      // Seed 30 existing events.
      const seedEvents = Array.from({ length: 30 }, (_, i) => {
        const rsId = 4000 + i;
        const { event } = makeMatchedPair(rsId);
        return event;
      });
      await db.collection(COLLECTIONS.EVENTS).insertMany(seedEvents);

      // 50 staging rows (only 30 will match by rsId; rest are "create").
      const stagingRows = Array.from({ length: 50 }, (_, i) => {
        const rsId = 4000 + i;
        const { stagingRow } = makeMatchedPair(rsId);
        return stagingRow;
      });

      // Capture the events + audit collection references ONCE and spy on .find.
      // Wrap db so bulkComputeDrift sees the spied collection (db.collection
      // returns a fresh wrapper each call, so spying on a fresh ref alone wouldn't
      // intercept anything).
      const eventsCollection = db.collection(COLLECTIONS.EVENTS);
      const auditCollection = db.collection(COLLECTIONS.AUDIT_HISTORY);
      const eventsFindSpy = jest.spyOn(eventsCollection, 'find');
      const auditFindSpy = jest.spyOn(auditCollection, 'find');
      const fakeDb = {
        collection: (name) => {
          if (name === 'templeEvents__Events') return eventsCollection;
          if (name === 'templeEvents__EventAuditHistory') return auditCollection;
          return db.collection(name);
        },
      };

      try {
        const results = await bulkComputeDrift(fakeDb, stagingRows, {
          calendarOwner: TEST_CALENDAR_OWNER,
          importUserId: IMPORT_USER_ID,
        });

        // 50 results: 30 matched (no_op, since values are identical) + 20 create.
        expect(results).toHaveLength(50);
        const noOpCount = results.filter((r) => r.driftType === DRIFT_TYPE.NO_OP).length;
        const createCount = results.filter((r) => r.driftType === DRIFT_TYPE.CREATE).length;
        expect(noOpCount).toBe(30);
        expect(createCount).toBe(20);

        // Critical assertion: events.find called ONCE, not 30 times.
        expect(eventsFindSpy).toHaveBeenCalledTimes(1);
        // Audit collection: also called once (since matched events exist).
        expect(auditFindSpy).toHaveBeenCalledTimes(1);
      } finally {
        eventsFindSpy.mockRestore();
        auditFindSpy.mockRestore();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Placeholders for commit 5.
  // -------------------------------------------------------------------------
  describe.skip('drift report endpoint (filled in commit 5)', () => {
    test('DR-5: drift report JSON returns correct buckets', () => {});
    test('DR-6: drift report CSV is valid long-format', () => {});
  });
});
