/**
 * Admin Save Graph payload — CHARACTERIZATION suite (CHAR-1..13)
 *
 * Captured on HEAD before the Save Graph block moved into
 * services/publishedMasterGraphSync.js (edit-request-approval-graph-sync D1).
 * These snapshots are the contract the extraction must keep byte-identical:
 * the exact updateCalendarEvent payloads and their order, the response's
 * graphSynced flag, and the graphData merge persisted with the write.
 *
 * They pin CURRENT behaviour, including two latent bugs documented here rather
 * than fixed (both out of scope for that change):
 *   - CHAR-12: a 409 on the Mongo write happens AFTER Graph was patched.
 *   - CHAR-9:  Save's thisEvent branch skips Graph entirely when no instance
 *              resolves (correct: patching the master would edit every date).
 *
 * If a snapshot changes, the change is a behaviour change to admin Save.
 * Update it only when that is the intent, never to make a refactor pass.
 *
 * Note: graphApiMock.assertCalled compares whole values, so these tests read
 * getCallHistory() and snapshot it.
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPublishedEventWithGraph,
  createPublishedSeriesMaster,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, ENDPOINTS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

// Deterministic identifiers so snapshots do not churn on generated ids.
const SINGLE_GRAPH_ID = 'AAMkChar-single';
const SERIES_GRAPH_ID = 'AAMkChar-series';
const ROOM_A_ID = new ObjectId('64b000000000000000000a01');
const ROOM_B_ID = new ObjectId('64b000000000000000000a02');

function sanitize(value) {
  return JSON.parse(JSON.stringify(value, (key, v) => {
    if (typeof v === 'string') {
      return v
        .replace(/changeKey-\d+/g, 'changeKey-<ts>')
        .replace(/AAMkAMock[0-9a-z]+/gi, 'AAMkAMock<id>');
    }
    return v;
  }));
}

describe('Admin Save Graph payload characterization (CHAR-1..13)', () => {
  let mongoClient, db, app, adminToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('adminSaveGraphPayloadChar'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.LOCATIONS).deleteMany({});
    graphApiMock.resetMocks();

    const admin = createAdmin();
    await insertUsers(db, [admin]);
    adminToken = await createMockToken(admin);

    await db.collection(COLLECTIONS.LOCATIONS).insertMany([
      { _id: ROOM_A_ID, name: 'Sanctuary', displayName: 'Sanctuary', isReservable: true, active: true },
      { _id: ROOM_B_ID, name: 'Greenwald Hall', displayName: 'Greenwald Hall', isReservable: true, active: true },
    ]);
  });

  async function seedSingle({ graphData: graphDataOverride, ...options } = {}) {
    const [saved] = await insertEvents(db, [createPublishedEventWithGraph({
      eventId: 'char-single',
      graphId: SINGLE_GRAPH_ID,
      eventTitle: 'Char Single',
      startDateTime: new Date(2026, 4, 5, 10, 0, 0),
      endDateTime: new Date(2026, 4, 5, 11, 0, 0),
      // createPublishedEventWithGraph spreads options last, so a graphData
      // passed here REPLACES the one it builds — the id must be included.
      graphData: {
        id: SINGLE_GRAPH_ID,
        start: { dateTime: '2026-05-05T10:00:00.0000000', timeZone: 'America/New_York' },
        end: { dateTime: '2026-05-05T11:00:00.0000000', timeZone: 'America/New_York' },
        location: { displayName: 'Graph Room', locationType: 'default' },
        ...(graphDataOverride || {}),
      },
      ...options,
    })]);
    return saved;
  }

  async function seedSeries(options = {}) {
    const [saved] = await insertEvents(db, [createPublishedSeriesMaster({
      eventId: 'char-series',
      graphId: SERIES_GRAPH_ID,
      eventTitle: 'Char Series',
      ...options,
    })]);
    return saved;
  }

  async function save(saved, body, expected = 200) {
    return request(app)
      .put(ENDPOINTS.UPDATE_EVENT(saved._id))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ _version: saved._version, ...body })
      .expect(expected);
  }

  async function capture(saved, res) {
    const stored = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
    return sanitize({
      status: res.status,
      graphSynced: res.body.graphSynced,
      updateCalls: graphApiMock.getCallHistory('updateCalendarEvent'),
      createCalls: graphApiMock.getCallHistory('createCalendarEvent'),
      deleteCalls: graphApiMock.getCallHistory('deleteCalendarEvent'),
      instanceLookups: graphApiMock.getCallHistory('getRecurringEventInstances').length,
      graphData: stored.graphData,
    });
  }

  it('CHAR-1: hold (no event times) gets a [Hold] subject', async () => {
    const saved = await seedSingle();
    const res = await save(saved, {
      eventTitle: 'Held Room',
      startDate: '2026-05-05', startTime: '', endDate: '2026-05-05', endTime: '',
      reservationStartTime: '09:00', reservationEndTime: '12:00',
    });
    expect(await capture(saved, res)).toMatchSnapshot();
  });

  it('CHAR-2: offsite builds the full Graph location', async () => {
    const saved = await seedSingle();
    const res = await save(saved, {
      isOffsite: true,
      offsiteName: 'Central Park',
      offsiteAddress: '14 E 60th St, New York, NY 10022',
      offsiteLat: 40.7648,
      offsiteLon: -73.9724,
    });
    expect(await capture(saved, res)).toMatchSnapshot();
  });

  it('CHAR-3: changed rooms resolve to display names', async () => {
    const saved = await seedSingle();
    const res = await save(saved, { locations: [ROOM_A_ID.toString(), ROOM_B_ID.toString()] });
    expect(await capture(saved, res)).toMatchSnapshot();
  });

  it('CHAR-4: cleared rooms send the "Unspecified" placeholder', async () => {
    const saved = await seedSingle({ locations: [ROOM_A_ID] });
    const res = await save(saved, { locations: [] });
    expect(await capture(saved, res)).toMatchSnapshot();
  });

  it('CHAR-5: changed recurrence is sent and start/end aligned to range.startDate', async () => {
    const saved = await seedSeries();
    const res = await save(saved, {
      startDate: '2026-03-17', startTime: '10:00', endDate: '2026-03-17', endTime: '11:00',
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-17', endDate: '2026-07-28' },
        additions: [],
        exclusions: [],
      },
    });
    expect(await capture(saved, res)).toMatchSnapshot();
  });

  it('CHAR-6: removed recurrence is sent as null', async () => {
    const saved = await seedSeries();
    const res = await save(saved, { eventTitle: 'Now A Single', recurrence: null });
    expect(await capture(saved, res)).toMatchSnapshot();
  });

  it('CHAR-7a: body object (text) maps to Graph Text', async () => {
    const saved = await seedSingle();
    // body alone is NOT in graphChanges, so a body-only save never reaches
    // Graph (current behaviour); the title change makes the PATCH happen.
    const res = await save(saved, { eventTitle: 'Body Text', body: { contentType: 'text', content: 'Plain body' } });
    expect(await capture(saved, res)).toMatchSnapshot();
  });

  it('CHAR-7b: eventDescription maps to Graph HTML body', async () => {
    const saved = await seedSingle();
    const res = await save(saved, { eventDescription: '<p>Rich</p>' });
    expect(await capture(saved, res)).toMatchSnapshot();
  });

  it('CHAR-7c: legacy description maps to Graph HTML body', async () => {
    const saved = await seedSingle();
    const res = await save(saved, { eventTitle: 'With Legacy Desc', description: 'Legacy text' });
    expect(await capture(saved, res)).toMatchSnapshot();
  });

  it('CHAR-8: categories fall back to graphData.categories when not sent', async () => {
    const saved = await seedSingle({ graphData: { categories: ['GraphCat'] } });
    const res = await save(saved, { eventTitle: 'Retitled' });
    expect(await capture(saved, res)).toMatchSnapshot();
  });

  it('CHAR-9: thisEvent with no resolvable instance skips Graph', async () => {
    const saved = await seedSeries();
    const res = await save(saved, {
      editScope: 'thisEvent',
      occurrenceDate: '2026-03-17',
      eventTitle: 'Only March 17',
    });
    const snap = await capture(saved, res);
    expect(snap.updateCalls).toHaveLength(0);
    expect(snap).toMatchSnapshot();
  });

  it('CHAR-10: a Graph throw still lets the Mongo write happen', async () => {
    const saved = await seedSingle();
    graphApiMock.setMockError('updateCalendarEvent', graphApiMock.graphError(503, 'busy'));
    const res = await save(saved, { eventTitle: 'Saved Despite Graph' });
    const stored = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
    expect(stored.calendarData.eventTitle).toBe('Saved Despite Graph');
    expect(await capture(saved, res)).toMatchSnapshot();
  });

  it('CHAR-11: added date on a published series is materialized and created in Graph', async () => {
    const saved = await seedSeries();
    const res = await save(saved, {
      recurrence: {
        ...saved.recurrence,
        additions: ['2026-03-12'],
      },
    });
    const child = await db.collection(COLLECTIONS.EVENTS).findOne({
      seriesMasterEventId: saved.eventId, occurrenceDate: '2026-03-12',
    });
    expect(child.eventType).toBe('addition');
    expect(child.graphEventId).toMatch(/^AAMkAMock/);
    expect(await capture(saved, res)).toMatchSnapshot();
  });

  it('CHAR-12: a 409 on the Mongo write happens AFTER Graph was patched (current behaviour)', async () => {
    const saved = await seedSingle();
    // Reproduce the race deterministically: a concurrent writer bumps the
    // version while Save is talking to Graph. The OCC-first check has already
    // passed by then, so only conditionalUpdate can catch it.
    const originalUpdate = graphApiMock.updateCalendarEvent;
    graphApiMock.updateCalendarEvent = async (...args) => {
      await db.collection(COLLECTIONS.EVENTS).updateOne({ _id: saved._id }, { $inc: { _version: 1 } });
      return originalUpdate(...args);
    };
    try {
      const res = await save(saved, { eventTitle: 'Lost Race' }, 409);
      const stored = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(stored.calendarData.eventTitle).toBe('Char Single');
      const snap = await capture(saved, res);
      expect(snap.updateCalls).toHaveLength(1);
      expect(snap).toMatchSnapshot();
    } finally {
      graphApiMock.updateCalendarEvent = originalUpdate;
    }
  });
});
