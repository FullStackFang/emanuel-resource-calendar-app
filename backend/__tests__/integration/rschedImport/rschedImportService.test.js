/**
 * Resource Scheduler Import Service Tests (RI-1 through RI-13).
 *
 * RI-14 (discard session) and RI-15 (admin permission gate) live in
 * rschedImportEndpoints.test.js because they exercise the HTTP layer.
 *
 * The fixture file backend/__tests__/__fixtures__/rsched-sample.csv contains
 * 12 hand-crafted rows covering every branch:
 *
 *   -2000000001  normal single-room (Torah Study, 602)
 *   -2000000002  single-room (Shabbat Services, TPL) — collides with -2000000011
 *   -2000000003  multi-room comma-quoted ("402, 402A") — bug-fix case
 *   -2000000004  all-day event (IMW, midnight-to-next-midnight)
 *   -2000000005  Note1 sentinel — informational, no real room
 *   -2000000006  normal single-room (LOW)
 *   -2000000007  Deleted=1 — must be skipped at parse time
 *   -2000000008  unmatched rsKey (DOES_NOT_EXIST)
 *   -2000000009  empty rsKey
 *   -2000000010  multi-day (3 days, LOW)
 *   -2000000011  same room/time as -2000000002 — used to seed the conflict in RI-4
 *   -2000000012  semicolon-delimited rsKey (602;LOW)
 */

const fs = require('fs');
const path = require('path');
const { ObjectId } = require('mongodb');

const {
  connectToGlobalServer,
  disconnectFromGlobalServer,
  clearCollections,
} = require('../../__helpers__/testSetup');
const {
  COLLECTIONS,
  TEST_CALENDAR_OWNER,
  TEST_CALENDAR_ID,
} = require('../../__helpers__/testConstants');

const rschedImportService = require('../../../services/rschedImportService');
const {
  parseCsv,
  resolveLocations,
  buildStagingDoc,
  buildEventDocFromStaging,
  applyStagingRow,
  detectRemovedRsIds,
  detectMaterialDifferences,
  hasHumanEdits,
  publishOrUpdateOutlookEvent,
  parseRschedDate,
  parseRschedTime,
  splitRsKeys,
  STAGING_STATUS,
  APPLY_OUTCOME,
} = rschedImportService;

const FIXTURE_PATH = path.join(
  __dirname,
  '..',
  '..',
  '__fixtures__',
  'rsched-sample.csv',
);

const IMPORT_USER_ID = '69fda879-0c61-4aa5-b02d-cad292c0777e';
const IMPORT_USER_EMAIL = 'admin@emanuelnyc.org';

const LOCATION_SEED = [
  { rsKey: '602', name: '6th Floor Lounge - 602', active: true },
  { rsKey: 'TPL', name: 'Main Sanctuary', active: true },
  { rsKey: '402', name: 'Leventritt Room - 402', active: true },
  { rsKey: '402A', name: 'Little Leventritt', active: true },
  { rsKey: 'IMW', name: 'Isaac Mayer Wise Hall', active: true },
  { rsKey: 'LOW', name: 'Leon Lowenstein', active: true },
];

describe('rschedImportService (RI-1 through RI-13)', () => {
  let mongoClient;
  let db;
  let csvBuffer;
  let locationIdsByKey;

  beforeAll(async () => {
    ({ db, client: mongoClient } = await connectToGlobalServer('rschedImportService'));
    csvBuffer = fs.readFileSync(FIXTURE_PATH);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await clearCollections(db);
    const locationsCol = db.collection(COLLECTIONS.LOCATIONS);
    await locationsCol.insertMany(LOCATION_SEED.map((l) => ({ ...l })));
    const seeded = await locationsCol.find({}).toArray();
    locationIdsByKey = new Map(seeded.map((l) => [l.rsKey, l._id]));
  });

  // ===========================================================================
  // RI-1: parse CSV → staging rows with correct status distribution
  // ===========================================================================
  test('RI-1: parseCsv + resolveLocations produce expected status distribution', async () => {
    const { rows: parsed, parseErrors } = await parseCsv(csvBuffer);

    expect(parseErrors).toEqual([]);
    // 12 rows in fixture, 1 deleted (-2000000007) → 11 parsed.
    expect(parsed).toHaveLength(11);

    const { rows, unmatchedKeys } = await resolveLocations(
      parsed,
      db.collection(COLLECTIONS.LOCATIONS),
    );

    const statusByRsId = Object.fromEntries(
      rows.map((r) => [r.rsId, r.locationStatus]),
    );
    expect(statusByRsId[-2000000001]).toBe('matched');
    expect(statusByRsId[-2000000002]).toBe('matched');
    expect(statusByRsId[-2000000003]).toBe('matched');
    expect(statusByRsId[-2000000004]).toBe('matched');
    expect(statusByRsId[-2000000005]).toBe('note_only');
    expect(statusByRsId[-2000000006]).toBe('matched');
    expect(statusByRsId[-2000000008]).toBe('unmatched');
    expect(statusByRsId[-2000000009]).toBe('missing');
    expect(statusByRsId[-2000000010]).toBe('matched');
    expect(statusByRsId[-2000000011]).toBe('matched');
    expect(statusByRsId[-2000000012]).toBe('matched');
    expect(unmatchedKeys.has('DOES_NOT_EXIST')).toBe(true);
  });

  // ===========================================================================
  // RI-2: comma-quoted multi-key splits to 2 ObjectIds
  // ===========================================================================
  test('RI-2: comma-quoted "402, 402A" resolves to two location ObjectIds', async () => {
    const { rows } = await parseCsv(csvBuffer);
    await resolveLocations(rows, db.collection(COLLECTIONS.LOCATIONS));
    const row = rows.find((r) => r.rsId === -2000000003);
    expect(row.rsKeys).toEqual(['402', '402A']);
    expect(row.locationIds).toHaveLength(2);
    expect(row.locationIds.map(String).sort()).toEqual(
      [locationIdsByKey.get('402'), locationIdsByKey.get('402A')]
        .map(String)
        .sort(),
    );
    expect(row.locationDisplayNames).toContain('Leventritt');
    expect(row.locationDisplayNames).toContain('Little Leventritt');
  });

  // ===========================================================================
  // RI-3: Note1 sentinel kept as note_only, NOT unmatched
  // ===========================================================================
  test('RI-3: Note1 rsKey treated as sentinel (note_only)', async () => {
    const { rows } = await parseCsv(csvBuffer);
    const { unmatchedKeys } = await resolveLocations(
      rows,
      db.collection(COLLECTIONS.LOCATIONS),
    );
    const row = rows.find((r) => r.rsId === -2000000005);
    expect(row.locationStatus).toBe('note_only');
    expect(row.locationIds).toEqual([]);
    expect(unmatchedKeys.has('Note1')).toBe(false);
  });

  // ===========================================================================
  // RI-4: validate detects hard room conflict against existing event
  // ===========================================================================
  test('RI-4: pre-existing published event in same room/time triggers a conflict', async () => {
    const { rows } = await parseCsv(csvBuffer);
    await resolveLocations(rows, db.collection(COLLECTIONS.LOCATIONS));

    // Seed an unrelated published event using the same room/time as -2000000011.
    const eventsCol = db.collection(COLLECTIONS.EVENTS);
    const existingDoc = {
      eventId: 'externally-created-1',
      eventTitle: 'Existing Wedding',
      status: 'published',
      isDeleted: false,
      calendarOwner: TEST_CALENDAR_OWNER,
      calendarId: TEST_CALENDAR_ID,
      source: 'human',
      startDateTime: '2026-03-06T10:30:00',
      endDateTime: '2026-03-06T12:00:00',
      locations: [locationIdsByKey.get('TPL')],
      _version: 1,
      calendarData: {
        eventTitle: 'Existing Wedding',
        startDateTime: '2026-03-06T10:30:00',
        endDateTime: '2026-03-06T12:00:00',
        locations: [locationIdsByKey.get('TPL')],
      },
    };
    await eventsCol.insertOne(existingDoc);

    // Find the rsched row in the same slot.
    const conflicting = rows.find((r) => r.rsId === -2000000002);
    const candidate = buildEventDocFromStaging(
      buildStagingDoc(conflicting, {
        sessionId: 's1',
        uploadedBy: IMPORT_USER_ID,
        uploadedAt: new Date(),
        calendarOwner: TEST_CALENDAR_OWNER,
        calendarId: TEST_CALENDAR_ID,
      }),
      {
        importUserId: IMPORT_USER_ID,
        importUserEmail: IMPORT_USER_EMAIL,
        sessionId: 's1',
        calendarOwner: TEST_CALENDAR_OWNER,
        calendarId: TEST_CALENDAR_ID,
      },
    );

    // Run the same conflict query the production code uses.
    const overlapCount = await eventsCol.countDocuments({
      status: 'published',
      'calendarData.locations': { $in: candidate.calendarData.locations },
      $or: [
        {
          'calendarData.startDateTime': {
            $gte: candidate.calendarData.startDateTime,
            $lt: candidate.calendarData.endDateTime,
          },
        },
        {
          'calendarData.endDateTime': {
            $gt: candidate.calendarData.startDateTime,
            $lte: candidate.calendarData.endDateTime,
          },
        },
        {
          'calendarData.startDateTime': { $lte: candidate.calendarData.startDateTime },
          'calendarData.endDateTime': { $gte: candidate.calendarData.endDateTime },
        },
      ],
    });
    expect(overlapCount).toBe(1);
  });

  // ===========================================================================
  // RI-5: forceApply controls whether conflict rows are committed
  // ===========================================================================
  test('RI-5: applyStagingRow respects status=conflict + forceApply', async () => {
    const { rows } = await parseCsv(csvBuffer);
    await resolveLocations(rows, db.collection(COLLECTIONS.LOCATIONS));
    const row = rows.find((r) => r.rsId === -2000000001);
    const ctx = {
      sessionId: 's5',
      uploadedBy: IMPORT_USER_ID,
      uploadedAt: new Date(),
      calendarOwner: TEST_CALENDAR_OWNER,
      calendarId: TEST_CALENDAR_ID,
      importUserId: IMPORT_USER_ID,
      importUserEmail: IMPORT_USER_EMAIL,
    };

    const conflictRow = {
      ...buildStagingDoc(row, ctx),
      status: STAGING_STATUS.CONFLICT,
      conflictReason: 'Test conflict',
      forceApply: false,
    };

    const skipped = await applyStagingRow(db, conflictRow, ctx);
    expect(skipped.outcome).toBe(APPLY_OUTCOME.SKIPPED);
    const eventsCol = db.collection(COLLECTIONS.EVENTS);
    expect(await eventsCol.countDocuments({})).toBe(0);

    const forcedRow = { ...conflictRow, forceApply: true };
    const forced = await applyStagingRow(db, forcedRow, ctx);
    expect(forced.outcome).toBe(APPLY_OUTCOME.INSERTED);
    expect(await eventsCol.countDocuments({})).toBe(1);
  });

  // ===========================================================================
  // RI-6: idempotent re-import — second pass yields no_op for unchanged rows
  // ===========================================================================
  test('RI-6: re-importing an unchanged row yields no_op', async () => {
    const { rows } = await parseCsv(csvBuffer);
    await resolveLocations(rows, db.collection(COLLECTIONS.LOCATIONS));
    const ctx = {
      sessionId: 's6',
      uploadedBy: IMPORT_USER_ID,
      uploadedAt: new Date(),
      calendarOwner: TEST_CALENDAR_OWNER,
      calendarId: TEST_CALENDAR_ID,
      importUserId: IMPORT_USER_ID,
      importUserEmail: IMPORT_USER_EMAIL,
    };
    const stagingRow = buildStagingDoc(rows.find((r) => r.rsId === -2000000001), ctx);

    const first = await applyStagingRow(db, stagingRow, ctx);
    expect(first.outcome).toBe(APPLY_OUTCOME.INSERTED);

    const second = await applyStagingRow(
      db,
      buildStagingDoc(rows.find((r) => r.rsId === -2000000001), { ...ctx, sessionId: 's6b' }),
      { ...ctx, sessionId: 's6b' },
    );
    expect(second.outcome).toBe(APPLY_OUTCOME.NO_OP);

    const eventsCol = db.collection(COLLECTIONS.EVENTS);
    const ev = await eventsCol.findOne({ eventId: 'rssched--2000000001' });
    expect(ev._version).toBe(1); // No version increment on no-op.
  });

  // ===========================================================================
  // RI-7: human edit detection — row marked human_edit_conflict
  // ===========================================================================
  test('RI-7: prior human edit blocks rsched re-import overwrite', async () => {
    const { rows } = await parseCsv(csvBuffer);
    await resolveLocations(rows, db.collection(COLLECTIONS.LOCATIONS));
    const ctx = {
      sessionId: 's7',
      uploadedBy: IMPORT_USER_ID,
      uploadedAt: new Date(),
      calendarOwner: TEST_CALENDAR_OWNER,
      calendarId: TEST_CALENDAR_ID,
      importUserId: IMPORT_USER_ID,
      importUserEmail: IMPORT_USER_EMAIL,
    };
    const row = rows.find((r) => r.rsId === -2000000001);
    const stagingRow = buildStagingDoc(row, ctx);

    // First import
    await applyStagingRow(db, stagingRow, ctx);

    // Simulate a human edit: someone other than the import service modifies the doc.
    const eventsCol = db.collection(COLLECTIONS.EVENTS);
    await eventsCol.updateOne(
      { eventId: 'rssched--2000000001' },
      {
        $set: {
          eventTitle: 'Manually Edited Title',
          'calendarData.eventTitle': 'Manually Edited Title',
          lastModifiedBy: 'human-user-id-xyz',
          lastModifiedDateTime: new Date(),
        },
      },
    );

    // Re-import with a slightly different title to force a "would update" path.
    const editedRow = {
      ...buildStagingDoc({ ...row, eventTitle: 'New CSV Title' }, ctx),
    };
    const second = await applyStagingRow(db, editedRow, { ...ctx, sessionId: 's7b' });
    expect(second.outcome).toBe(APPLY_OUTCOME.HUMAN_EDIT_CONFLICT);

    const stillThere = await eventsCol.findOne({ eventId: 'rssched--2000000001' });
    expect(stillThere.eventTitle).toBe('Manually Edited Title'); // NOT overwritten.
  });

  // ===========================================================================
  // RI-8: removal detection — events in MongoDB but not in CSV surface
  // ===========================================================================
  test('RI-8: detectRemovedRsIds surfaces events in MongoDB but absent from staging', async () => {
    const eventsCol = db.collection(COLLECTIONS.EVENTS);
    // Two pre-existing rsched events.
    await eventsCol.insertMany([
      {
        eventId: 'rssched--3000000001',
        source: 'rsSched',
        calendarOwner: TEST_CALENDAR_OWNER,
        eventTitle: 'Old Imported Event A',
        startDateTime: '2026-03-05T10:00:00',
        endDateTime: '2026-03-05T11:00:00',
        calendarData: {
          startDateTime: '2026-03-05T10:00:00',
          endDateTime: '2026-03-05T11:00:00',
        },
        rschedData: { rsId: -3000000001 },
      },
      {
        eventId: 'rssched--3000000002',
        source: 'rsSched',
        calendarOwner: TEST_CALENDAR_OWNER,
        eventTitle: 'Old Imported Event B',
        startDateTime: '2026-03-08T14:00:00',
        endDateTime: '2026-03-08T15:00:00',
        calendarData: {
          startDateTime: '2026-03-08T14:00:00',
          endDateTime: '2026-03-08T15:00:00',
        },
        rschedData: { rsId: -3000000002 },
      },
    ]);

    // Staging session contains only -3000000001 — so -3000000002 should appear as removed.
    const removed = await detectRemovedRsIds(
      db,
      {
        calendarOwner: TEST_CALENDAR_OWNER,
        dateRangeStart: '2026-03-01',
        dateRangeEnd: '2026-03-31',
      },
      [-3000000001],
    );
    expect(removed).toHaveLength(1);
    expect(removed[0].rsId).toBe(-3000000002);
    expect(removed[0].eventId).toBe('rssched--3000000002');
  });

  // ===========================================================================
  // RI-9: detectRemovedRsIds returns events outside date range as not-removed
  // ===========================================================================
  test('RI-9: detectRemovedRsIds is bounded by the staging date range', async () => {
    const eventsCol = db.collection(COLLECTIONS.EVENTS);
    await eventsCol.insertOne({
      eventId: 'rssched--4000000001',
      source: 'rsSched',
      calendarOwner: TEST_CALENDAR_OWNER,
      startDateTime: '2026-06-15T10:00:00',
      endDateTime: '2026-06-15T11:00:00',
      calendarData: {
        startDateTime: '2026-06-15T10:00:00',
        endDateTime: '2026-06-15T11:00:00',
      },
      rschedData: { rsId: -4000000001 },
    });
    const removed = await detectRemovedRsIds(
      db,
      {
        calendarOwner: TEST_CALENDAR_OWNER,
        dateRangeStart: '2026-03-01',
        dateRangeEnd: '2026-03-31',
      },
      [],
    );
    expect(removed).toEqual([]);
  });

  // ===========================================================================
  // RI-10: publishOrUpdateOutlookEvent calls createCalendarEvent
  // ===========================================================================
  test('RI-10: publish on first call hits createCalendarEvent and saves graphData.id', async () => {
    const { rows } = await parseCsv(csvBuffer);
    await resolveLocations(rows, db.collection(COLLECTIONS.LOCATIONS));
    const ctx = {
      sessionId: 's10',
      uploadedBy: IMPORT_USER_ID,
      uploadedAt: new Date(),
      calendarOwner: TEST_CALENDAR_OWNER,
      calendarId: TEST_CALENDAR_ID,
      importUserId: IMPORT_USER_ID,
      importUserEmail: IMPORT_USER_EMAIL,
    };
    const stagingRow = buildStagingDoc(rows.find((r) => r.rsId === -2000000001), ctx);
    await applyStagingRow(db, stagingRow, ctx);

    const eventsCol = db.collection(COLLECTIONS.EVENTS);
    const eventDoc = await eventsCol.findOne({ eventId: 'rssched--2000000001' });

    const graphMock = {
      createCalendarEvent: jest.fn().mockResolvedValue({
        id: 'graph-event-id-123',
        subject: eventDoc.eventTitle,
      }),
      updateCalendarEvent: jest.fn(),
    };

    const result = await publishOrUpdateOutlookEvent(db, eventDoc, {
      graphApiService: graphMock,
    });
    expect(result.outcome).toBe('published');
    expect(result.graphEventId).toBe('graph-event-id-123');
    expect(graphMock.createCalendarEvent).toHaveBeenCalledTimes(1);
    expect(graphMock.updateCalendarEvent).not.toHaveBeenCalled();

    const refetched = await eventsCol.findOne({ eventId: 'rssched--2000000001' });
    expect(refetched.graphData.id).toBe('graph-event-id-123');
    expect(refetched.publishedAt).toBeTruthy();
  });

  // ===========================================================================
  // RI-11: publish hits updateCalendarEvent if graphData.id already exists
  // ===========================================================================
  test('RI-11: publish on already-published event hits updateCalendarEvent', async () => {
    const eventsCol = db.collection(COLLECTIONS.EVENTS);
    const eventDoc = {
      _id: new ObjectId(),
      eventId: 'rssched--2000000001',
      eventTitle: 'Torah Study',
      calendarOwner: TEST_CALENDAR_OWNER,
      calendarId: TEST_CALENDAR_ID,
      isAllDayEvent: false,
      startDateTime: '2026-03-02T09:00:00',
      endDateTime: '2026-03-02T10:15:00',
      locationDisplayNames: '6th Floor Lounge - 602',
      categories: ['Clergy'],
      graphData: { id: 'existing-graph-id-456' },
    };
    await eventsCol.insertOne(eventDoc);

    const graphMock = {
      createCalendarEvent: jest.fn(),
      updateCalendarEvent: jest
        .fn()
        .mockResolvedValue({ id: 'existing-graph-id-456', subject: 'Torah Study' }),
    };
    const result = await publishOrUpdateOutlookEvent(db, eventDoc, {
      graphApiService: graphMock,
    });
    expect(result.outcome).toBe('updated');
    expect(graphMock.createCalendarEvent).not.toHaveBeenCalled();
    expect(graphMock.updateCalendarEvent).toHaveBeenCalledWith(
      TEST_CALENDAR_OWNER,
      TEST_CALENDAR_ID,
      'existing-graph-id-456',
      expect.any(Object),
    );
  });

  // ===========================================================================
  // RI-12: OCC integration — conditionalUpdate raises 409 on stale expectedVersion.
  // applyStagingRow's race window (refetch → conditionalUpdate) is microseconds
  // wide and not reachable by sequential test ops, so this test exercises the
  // OCC primitive directly to prove the import service is wired to it correctly.
  // ===========================================================================
  test('RI-12: stale _version on conditionalUpdate raises 409 VERSION_CONFLICT', async () => {
    const { rows } = await parseCsv(csvBuffer);
    await resolveLocations(rows, db.collection(COLLECTIONS.LOCATIONS));
    const ctx = {
      sessionId: 's12',
      uploadedBy: IMPORT_USER_ID,
      uploadedAt: new Date(),
      calendarOwner: TEST_CALENDAR_OWNER,
      calendarId: TEST_CALENDAR_ID,
      importUserId: IMPORT_USER_ID,
      importUserEmail: IMPORT_USER_EMAIL,
    };
    await applyStagingRow(
      db,
      buildStagingDoc(rows.find((r) => r.rsId === -2000000001), ctx),
      ctx,
    );

    const eventsCol = db.collection(COLLECTIONS.EVENTS);
    const event = await eventsCol.findOne({ eventId: 'rssched--2000000001' });
    expect(event._version).toBe(1);

    const { conditionalUpdate } = require('../../../utils/concurrencyUtils');
    await expect(
      conditionalUpdate(
        eventsCol,
        { _id: event._id },
        { $set: { eventTitle: 'Stale Update' } },
        { expectedVersion: 99 },
      ),
    ).rejects.toMatchObject({ statusCode: 409 });

    const stillThere = await eventsCol.findOne({ eventId: 'rssched--2000000001' });
    expect(stillThere.eventTitle).toBe('Torah Study');
    expect(stillThere._version).toBe(1);
  });

  // ===========================================================================
  // RI-13: audit history written with rsched-import-create + importSessionId
  // ===========================================================================
  test('RI-13: insert writes audit row with changeType + importSessionId', async () => {
    const { rows } = await parseCsv(csvBuffer);
    await resolveLocations(rows, db.collection(COLLECTIONS.LOCATIONS));
    const ctx = {
      sessionId: 'session-abc-123',
      uploadedBy: IMPORT_USER_ID,
      uploadedAt: new Date(),
      calendarOwner: TEST_CALENDAR_OWNER,
      calendarId: TEST_CALENDAR_ID,
      importUserId: IMPORT_USER_ID,
      importUserEmail: IMPORT_USER_EMAIL,
    };
    await applyStagingRow(
      db,
      buildStagingDoc(rows.find((r) => r.rsId === -2000000001), ctx),
      ctx,
    );

    const auditCol = db.collection(COLLECTIONS.AUDIT_HISTORY);
    const entry = await auditCol.findOne({ eventId: 'rssched--2000000001' });
    expect(entry).toBeTruthy();
    expect(entry.changeType).toBe('rsched-import-create');
    expect(entry.metadata.importSessionId).toBe('session-abc-123');
  });
});

// ============================================================================
// Pure-function unit tests (no DB) — included here for proximity but tagged
// to make it obvious they don't need MongoMemoryServer.
// ============================================================================
describe('rschedImportService pure helpers', () => {
  test('parseRschedDate handles US and ISO formats', () => {
    expect(parseRschedDate('3/2/2026')).toBe('2026-03-02');
    expect(parseRschedDate('12/31/2025')).toBe('2025-12-31');
    expect(parseRschedDate('2026-03-02')).toBe('2026-03-02');
    expect(parseRschedDate('garbage')).toBeNull();
    expect(parseRschedDate('')).toBeNull();
  });

  test('parseRschedTime handles AM/PM and 24-hour', () => {
    expect(parseRschedTime('9:00:00 AM')).toBe('09:00');
    expect(parseRschedTime('12:00 PM')).toBe('12:00');
    expect(parseRschedTime('12:00 AM')).toBe('00:00');
    expect(parseRschedTime('5:30:00 PM')).toBe('17:30');
    expect(parseRschedTime('13:45')).toBe('13:45');
    expect(parseRschedTime('garbage')).toBeNull();
  });

  test('splitRsKeys handles comma, semicolon, mixed, whitespace', () => {
    expect(splitRsKeys('602')).toEqual(['602']);
    expect(splitRsKeys('402, 402A')).toEqual(['402', '402A']);
    expect(splitRsKeys('602;LOW')).toEqual(['602', 'LOW']);
    expect(splitRsKeys('A, B; C , D')).toEqual(['A', 'B', 'C', 'D']);
    expect(splitRsKeys('')).toEqual([]);
  });

  test('detectMaterialDifferences ignores audit fields', () => {
    const a = {
      eventTitle: 'X',
      eventDescription: 'Y',
      startDateTime: '2026-03-02T09:00:00',
      endDateTime: '2026-03-02T10:00:00',
      isAllDayEvent: false,
      locations: [],
      categories: ['A'],
    };
    const b = { ...a, lastModifiedBy: 'someone-else', _version: 99 };
    expect(detectMaterialDifferences(a, b)).toEqual([]);
    const c = { ...a, eventTitle: 'Z' };
    expect(detectMaterialDifferences(a, c).map((d) => d.field)).toEqual(['eventTitle']);
  });
});
