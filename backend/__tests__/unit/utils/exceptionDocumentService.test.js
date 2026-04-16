/**
 * Unit tests for exceptionDocumentService.js
 *
 * Tests CRUD operations for recurring event exception and addition documents.
 * Uses in-memory MongoDB via testSetup.
 *
 * Test IDs: EDS-1 through EDS-20
 */

const { ObjectId } = require('mongodb');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { COLLECTIONS } = require('../../__helpers__/testConstants');
const {
  createRecurringSeriesMaster,
} = require('../../__helpers__/eventFactory');
const {
  mergeDefaultsWithOverrides,
  createExceptionDocument,
  createAdditionDocument,
  updateExceptionDocument,
  findExceptionForDate,
  getExceptionsForMaster,
  cascadeDeleteExceptions,
  cascadeStatusUpdate,
  softDeleteException,
} = require('../../../utils/exceptionDocumentService');

let db;
let mongoClient;
let collection;

// Reusable master event for tests
let master;

beforeAll(async () => {
  ({ db, client: mongoClient } = await connectToGlobalServer('exceptionDocService'));
  collection = db.collection(COLLECTIONS.EVENTS);
});

afterAll(async () => {
  await disconnectFromGlobalServer(mongoClient, db);
});

beforeEach(async () => {
  await collection.deleteMany({});

  // Create a standard series master for most tests
  master = createRecurringSeriesMaster({
    eventTitle: 'Weekly Staff Meeting',
    eventDescription: 'Recurring team sync',
    startTime: '10:00',
    endTime: '11:00',
    locations: [new ObjectId()],
    locationDisplayNames: ['Room A'],
    categories: ['Meeting'],
    status: 'published',
    calendarData: {
      eventTitle: 'Weekly Staff Meeting',
      eventDescription: 'Recurring team sync',
      startDateTime: '2026-03-10T10:00:00',
      endDateTime: '2026-03-10T11:00:00',
      startDate: '2026-03-10',
      startTime: '10:00',
      endDate: '2026-03-10',
      endTime: '11:00',
      locations: [new ObjectId()],
      locationDisplayNames: ['Room A'],
      categories: ['Meeting'],
      setupTime: '15 minutes',
      teardownTime: null,
      doorOpenTime: '09:30',
      doorCloseTime: null,
      reservationStartTime: '',
      reservationEndTime: '',
      attendeeCount: 10,
    },
  });
  await collection.insertOne(master);
});

// ─── mergeDefaultsWithOverrides ─────────────────────────────────────────

describe('mergeDefaultsWithOverrides', () => {
  it('EDS-1: should return master defaults when no overrides provided', () => {
    const { effectiveFields } = mergeDefaultsWithOverrides(master, {}, '2026-03-17');

    expect(effectiveFields.eventTitle).toBe('Weekly Staff Meeting');
    expect(effectiveFields.startDateTime).toBe('2026-03-17T10:00');
    expect(effectiveFields.endDateTime).toBe('2026-03-17T11:00');
    expect(effectiveFields.categories).toEqual(['Meeting']);
  });

  it('EDS-2: should override specific fields while inheriting others', () => {
    const overrides = { eventTitle: 'Special Session', startTime: '14:00' };
    const { effectiveFields } = mergeDefaultsWithOverrides(master, overrides, '2026-03-17');

    expect(effectiveFields.eventTitle).toBe('Special Session');
    expect(effectiveFields.startDateTime).toBe('2026-03-17T14:00');
    expect(effectiveFields.endDateTime).toBe('2026-03-17T11:00'); // inherited
    expect(effectiveFields.categories).toEqual(['Meeting']); // inherited
  });

  it('EDS-3: should allow override to null (explicit clear)', () => {
    const overrides = { setupTime: null, doorOpenTime: null };
    const { effectiveFields } = mergeDefaultsWithOverrides(master, overrides, '2026-03-17');

    expect(effectiveFields.setupTime).toBeNull();
    expect(effectiveFields.doorOpenTime).toBeNull();
  });

  it('EDS-23: should cascade to reservationStartTime/EndTime for Hold events', () => {
    const overrides = { startTime: '', endTime: '', reservationStartTime: '10:30', reservationEndTime: '11:30' };
    const { effectiveFields, effectiveCalendarData } = mergeDefaultsWithOverrides(master, overrides, '2026-03-17');

    expect(effectiveFields.startDateTime).toBe('2026-03-17T10:30');
    expect(effectiveFields.endDateTime).toBe('2026-03-17T11:30');
    expect(effectiveCalendarData.startDateTime).toBe('2026-03-17T10:30');
    expect(effectiveCalendarData.endDateTime).toBe('2026-03-17T11:30');
  });

  it('EDS-24: should cascade to reservationStartTime when startTime is null', () => {
    const overrides = { startTime: null, endTime: null, reservationStartTime: '14:00', reservationEndTime: '15:00' };
    const { effectiveFields } = mergeDefaultsWithOverrides(master, overrides, '2026-03-17');

    expect(effectiveFields.startDateTime).toBe('2026-03-17T14:00');
    expect(effectiveFields.endDateTime).toBe('2026-03-17T15:00');
  });

  it('EDS-4: should produce correct calendarData mirror', () => {
    const overrides = { startTime: '15:00', endTime: '16:30' };
    const { effectiveCalendarData } = mergeDefaultsWithOverrides(master, overrides, '2026-03-24');

    expect(effectiveCalendarData.startDateTime).toBe('2026-03-24T15:00');
    expect(effectiveCalendarData.endDateTime).toBe('2026-03-24T16:30');
    expect(effectiveCalendarData.eventTitle).toBe('Weekly Staff Meeting');
  });
});

// ─── createExceptionDocument ────────────────────────────────────────────

describe('createExceptionDocument', () => {
  it('EDS-5: should create an exception doc with correct eventType and links', async () => {
    const overrides = { startTime: '14:00', endTime: '15:30' };
    const doc = await createExceptionDocument(collection, master, '2026-03-17', overrides);

    expect(doc.eventType).toBe('exception');
    expect(doc.seriesMasterEventId).toBe(master.eventId);
    expect(doc.occurrenceDate).toBe('2026-03-17');
    expect(doc.eventId).toBe(`${master.eventId}-2026-03-17`);
  });

  it('EDS-6: should store overrides separately from effective values', async () => {
    const overrides = { startTime: '14:00' };
    const doc = await createExceptionDocument(collection, master, '2026-03-17', overrides);

    // overrides only has what changed
    expect(doc.overrides).toEqual({ startTime: '14:00' });
    // effective values include inherited fields
    expect(doc.eventTitle).toBe('Weekly Staff Meeting');
    expect(doc.startDateTime).toBe('2026-03-17T14:00');
    expect(doc.endDateTime).toBe('2026-03-17T11:00');
  });

  it('EDS-7: should inherit status and ownership from master', async () => {
    const doc = await createExceptionDocument(collection, master, '2026-03-17', {});

    expect(doc.status).toBe(master.status);
    expect(doc.calendarOwner).toBe(master.calendarOwner);
    expect(doc.userId).toBe(master.userId);
    expect(doc._version).toBe(1);
  });

  it('EDS-8: should be findable in the database', async () => {
    await createExceptionDocument(collection, master, '2026-03-17', { startTime: '09:00' });

    const found = await collection.findOne({ seriesMasterEventId: master.eventId, occurrenceDate: '2026-03-17' });
    expect(found).not.toBeNull();
    expect(found.eventType).toBe('exception');
  });

  it('EDS-9: should store graphEventId when provided', async () => {
    const doc = await createExceptionDocument(collection, master, '2026-03-17', {}, {
      graphEventId: 'AAMk_test_graph_id',
    });
    expect(doc.graphEventId).toBe('AAMk_test_graph_id');
  });
});

// ─── createAdditionDocument ─────────────────────────────────────────────

describe('createAdditionDocument', () => {
  it('EDS-10: should create an addition doc with eventType addition', async () => {
    const doc = await createAdditionDocument(collection, master, '2026-05-01', {
      eventTitle: 'Makeup Session',
      startTime: '13:00',
      endTime: '14:00',
    });

    expect(doc.eventType).toBe('addition');
    expect(doc.seriesMasterEventId).toBe(master.eventId);
    expect(doc.occurrenceDate).toBe('2026-05-01');
    expect(doc.eventId).toBe(`${master.eventId}-add-2026-05-01`);
    expect(doc.eventTitle).toBe('Makeup Session');
    expect(doc.startDateTime).toBe('2026-05-01T13:00');
  });

  it('EDS-11: should inherit master defaults for non-specified fields', async () => {
    const doc = await createAdditionDocument(collection, master, '2026-05-01', {});

    expect(doc.eventTitle).toBe('Weekly Staff Meeting');
    expect(doc.categories).toEqual(['Meeting']);
  });
});

// ─── updateExceptionDocument ────────────────────────────────────────────

describe('updateExceptionDocument', () => {
  it('EDS-12: should merge new overrides with existing ones', async () => {
    const original = await createExceptionDocument(collection, master, '2026-03-17', {
      startTime: '14:00',
    });

    const updated = await updateExceptionDocument(collection, original, master, {
      eventTitle: 'Updated Title',
    });

    expect(updated.overrides).toEqual({ startTime: '14:00', eventTitle: 'Updated Title' });
    expect(updated.eventTitle).toBe('Updated Title');
    expect(updated.startDateTime).toBe('2026-03-17T14:00'); // still from first override
    expect(updated._version).toBe(2);
  });

  it('EDS-13: should respect OCC version check', async () => {
    const original = await createExceptionDocument(collection, master, '2026-03-17', {});

    // Simulate a concurrent update by bumping the version
    await collection.updateOne({ _id: original._id }, { $set: { _version: 5 } });

    const result = await updateExceptionDocument(collection, original, master, { startTime: '16:00' }, {
      expectedVersion: 1, // stale version
    });

    expect(result).toBeNull(); // OCC conflict
  });

  it('EDS-14: should recompute denormalized calendarData on update', async () => {
    const original = await createExceptionDocument(collection, master, '2026-03-17', {
      startTime: '14:00',
    });

    const updated = await updateExceptionDocument(collection, original, master, {
      endTime: '16:30',
    });

    expect(updated.calendarData.startDateTime).toBe('2026-03-17T14:00');
    expect(updated.calendarData.endDateTime).toBe('2026-03-17T16:30');
  });
});

// ─── findExceptionForDate ───────────────────────────────────────────────

describe('findExceptionForDate', () => {
  it('EDS-15: should find an existing exception by master + date', async () => {
    await createExceptionDocument(collection, master, '2026-03-17', { startTime: '09:00' });

    const found = await findExceptionForDate(collection, master.eventId, '2026-03-17');
    expect(found).not.toBeNull();
    expect(found.occurrenceDate).toBe('2026-03-17');
  });

  it('EDS-16: should return null when no exception exists for date', async () => {
    const found = await findExceptionForDate(collection, master.eventId, '2026-03-24');
    expect(found).toBeNull();
  });
});

// ─── getExceptionsForMaster ─────────────────────────────────────────────

describe('getExceptionsForMaster', () => {
  it('EDS-17: should return all exceptions sorted by date', async () => {
    await createExceptionDocument(collection, master, '2026-04-07', { startTime: '08:00' });
    await createExceptionDocument(collection, master, '2026-03-17', { startTime: '09:00' });
    await createAdditionDocument(collection, master, '2026-05-01', { startTime: '10:00' });

    const results = await getExceptionsForMaster(collection, master.eventId);
    expect(results).toHaveLength(3);
    expect(results[0].occurrenceDate).toBe('2026-03-17');
    expect(results[1].occurrenceDate).toBe('2026-04-07');
    expect(results[2].occurrenceDate).toBe('2026-05-01');
  });

  it('EDS-18: should filter by date range when provided', async () => {
    await createExceptionDocument(collection, master, '2026-03-17', { startTime: '09:00' });
    await createExceptionDocument(collection, master, '2026-04-07', { startTime: '08:00' });
    await createExceptionDocument(collection, master, '2026-05-12', { startTime: '11:00' });

    const results = await getExceptionsForMaster(collection, master.eventId, {
      start: '2026-04-01',
      end: '2026-04-30',
    });
    expect(results).toHaveLength(1);
    expect(results[0].occurrenceDate).toBe('2026-04-07');
  });
});

// ─── cascadeDeleteExceptions ────────────────────────────────────────────

describe('cascadeDeleteExceptions', () => {
  it('EDS-19: should soft-delete all exceptions for a master', async () => {
    await createExceptionDocument(collection, master, '2026-03-17', {});
    await createExceptionDocument(collection, master, '2026-03-24', {});
    await createAdditionDocument(collection, master, '2026-05-01', {});

    const count = await cascadeDeleteExceptions(collection, master.eventId, {
      deletedBy: 'admin@emanuelnyc.org',
      reason: 'Series deleted',
    });

    expect(count).toBe(3);

    // Verify all are soft-deleted
    const remaining = await getExceptionsForMaster(collection, master.eventId);
    expect(remaining).toHaveLength(0); // getExceptionsForMaster excludes isDeleted

    // But they still exist in the database
    const allDocs = await collection.find({ seriesMasterEventId: master.eventId }).toArray();
    expect(allDocs).toHaveLength(3);
    expect(allDocs.every(d => d.isDeleted === true)).toBe(true);
    expect(allDocs.every(d => d.status === 'deleted')).toBe(true);
  });
});

// ─── cascadeStatusUpdate ────────────────────────────────────────────────

describe('cascadeStatusUpdate', () => {
  it('EDS-20: should cascade status change to all exceptions', async () => {
    // Start with draft exceptions
    const draftMaster = createRecurringSeriesMaster({ status: 'draft', eventTitle: 'Draft Series' });
    draftMaster.calendarData = { ...master.calendarData, eventTitle: 'Draft Series' };
    await collection.insertOne(draftMaster);

    await createExceptionDocument(collection, draftMaster, '2026-03-17', { startTime: '14:00' });
    await createAdditionDocument(collection, draftMaster, '2026-05-01', {});

    const count = await cascadeStatusUpdate(collection, draftMaster.eventId, 'published', {
      changedBy: 'admin@emanuelnyc.org',
      reason: 'Series published',
    });

    expect(count).toBe(2);

    const exceptions = await collection.find({
      seriesMasterEventId: draftMaster.eventId,
      eventType: { $in: ['exception', 'addition'] },
    }).toArray();

    expect(exceptions.every(e => e.status === 'published')).toBe(true);
    expect(exceptions.every(e => e.statusHistory.length >= 1)).toBe(true);
  });
});

// ─── softDeleteException ────────────────────────────────────────────────

describe('softDeleteException', () => {
  it('EDS-21: should soft-delete a single exception by date', async () => {
    await createExceptionDocument(collection, master, '2026-03-17', { startTime: '14:00' });
    await createExceptionDocument(collection, master, '2026-03-24', { startTime: '15:00' });

    const deleted = await softDeleteException(collection, master.eventId, '2026-03-17', {
      deletedBy: 'admin@emanuelnyc.org',
      reason: 'Occurrence cancelled',
    });

    expect(deleted).not.toBeNull();
    expect(deleted.isDeleted).toBe(true);
    expect(deleted.status).toBe('deleted');

    // Other exception should be unaffected
    const other = await findExceptionForDate(collection, master.eventId, '2026-03-24');
    expect(other).not.toBeNull();
    expect(other.isDeleted).not.toBe(true);
  });

  it('EDS-22: should return null when no exception exists for date', async () => {
    const result = await softDeleteException(collection, master.eventId, '2026-03-17');
    expect(result).toBeNull();
  });
});

// ─── DATE_IMMUTABLE guard (requirement D) ─────────────────────────────────
//
// The helpers enforce date-immutability structurally: any attempt to create or
// update an exception whose overrides.startDate / overrides.endDate differs
// from the dateKey anchor throws { statusCode: 400, code: 'DATE_IMMUTABLE' }.
// This makes the guarantee endpoint-agnostic — every write path that uses the
// helpers inherits the check automatically.

describe('DATE_IMMUTABLE — createExceptionDocument', () => {
  it('EDS-DI-1: rejects overrides.startDate that differs from dateKey', async () => {
    await expect(
      createExceptionDocument(
        collection,
        master,
        '2026-03-17', // dateKey
        { startDate: '2026-03-20', eventTitle: 'Moved' } // mismatched override
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'DATE_IMMUTABLE',
    });
  });

  it('EDS-DI-2: rejects overrides.endDate that differs from dateKey', async () => {
    await expect(
      createExceptionDocument(
        collection,
        master,
        '2026-03-17',
        { endDate: '2026-03-18' }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'DATE_IMMUTABLE',
    });
  });

  it('EDS-DI-3: accepts overrides.startDate matching dateKey (no-op diff)', async () => {
    const result = await createExceptionDocument(
      collection,
      master,
      '2026-03-17',
      { startDate: '2026-03-17', startTime: '14:00' }
    );
    expect(result).toBeDefined();
    expect(result.occurrenceDate).toBe('2026-03-17');
    expect(result.code).toBeUndefined(); // not an error
  });

  it('EDS-DI-4: accepts overrides that omit startDate/endDate entirely', async () => {
    const result = await createExceptionDocument(
      collection,
      master,
      '2026-03-17',
      { eventTitle: 'Renamed', startTime: '14:00' } // no date fields
    );
    expect(result).toBeDefined();
    expect(result.occurrenceDate).toBe('2026-03-17');
  });

  it('EDS-DI-5: rejects BEFORE writing any document', async () => {
    const before = await collection.countDocuments({ eventType: 'exception' });
    try {
      await createExceptionDocument(
        collection,
        master,
        '2026-03-17',
        { startDate: '2026-03-25' }
      );
    } catch (_err) {
      // expected
    }
    const after = await collection.countDocuments({ eventType: 'exception' });
    expect(after).toBe(before);
  });
});

describe('DATE_IMMUTABLE — updateExceptionDocument', () => {
  let existingException;

  beforeEach(async () => {
    // Seed an existing exception at 2026-03-17 for update tests
    existingException = await createExceptionDocument(
      collection,
      master,
      '2026-03-17',
      { startTime: '10:00' }
    );
  });

  it('EDS-DI-6: rejects newOverrides.startDate differing from existing occurrenceDate', async () => {
    await expect(
      updateExceptionDocument(
        collection,
        existingException,
        master,
        { startDate: '2026-03-25' }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'DATE_IMMUTABLE',
    });
  });

  it('EDS-DI-7: rejects newOverrides.endDate differing from existing occurrenceDate', async () => {
    await expect(
      updateExceptionDocument(
        collection,
        existingException,
        master,
        { endDate: '2026-03-25' }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'DATE_IMMUTABLE',
    });
  });

  it('EDS-DI-8: accepts newOverrides.startDate matching existing occurrenceDate', async () => {
    const result = await updateExceptionDocument(
      collection,
      existingException,
      master,
      { startDate: '2026-03-17', eventTitle: 'Updated' }
    );
    expect(result).not.toBeNull();
    expect(result.occurrenceDate).toBe('2026-03-17');
  });

  it('EDS-DI-9: accepts time-only updates (no date fields in overrides)', async () => {
    const result = await updateExceptionDocument(
      collection,
      existingException,
      master,
      { startTime: '15:00', endTime: '16:00' }
    );
    expect(result).not.toBeNull();
    expect(result.overrides.startTime).toBe('15:00');
  });

  it('EDS-DI-10: on rejection, does NOT increment _version or modify document', async () => {
    const versionBefore = existingException._version;
    try {
      await updateExceptionDocument(
        collection,
        existingException,
        master,
        { startDate: '2026-03-25' }
      );
    } catch (_err) {
      // expected
    }
    const reread = await collection.findOne({ _id: existingException._id });
    expect(reread._version).toBe(versionBefore);
  });
});
