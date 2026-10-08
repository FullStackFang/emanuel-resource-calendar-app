/**
 * Admin Save: newly excluded dates reach Outlook (REX-1..5)
 *
 * Before edit-request-approval-graph-sync, excluding a date from the
 * Recurrence tab of a published series and saving changed only MongoDB; the
 * Outlook instance stayed. Save now runs reconcilePublishedSeries, which
 * cancels the instance (or, for a date with a child document, removes the
 * child and its own Graph event).
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, insertUsers } = require('../../__helpers__/userFactory');
const { createPublishedSeriesMaster, createAdditionDocument, insertEvents } = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, ENDPOINTS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Admin Save exclusion Graph sync (REX-1..5)', () => {
  let mongoClient, db, app, adminToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('adminSaveExclusionGraph'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    graphApiMock.resetMocks();
    const admin = createAdmin();
    await insertUsers(db, [admin]);
    adminToken = await createMockToken(admin);
  });

  const instances = dates => dates.map(d => ({ id: `inst-${d}`, start: { dateTime: `${d}T10:00:00.0000000` } }));

  async function saveExclusions(saved, exclusions, extra = {}) {
    return request(app)
      .put(ENDPOINTS.UPDATE_EVENT(saved._id))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ _version: saved._version, recurrence: { ...saved.recurrence, ...extra, exclusions } })
      .expect(200);
  }

  it('REX-1: a new exclusion cancels the instance and records it', async () => {
    const [saved] = await insertEvents(db, [createPublishedSeriesMaster({ graphId: 'G-rex1' })]);
    graphApiMock.setMockResponse('getRecurringEventInstances', instances(['2026-10-14']));

    await saveExclusions(saved, ['2026-10-14']);

    expect(graphApiMock.getCallHistory('deleteCalendarEvent').map(d => d.eventId)).toEqual(['inst-2026-10-14']);
    const after = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
    expect(after.graphData.cancelledOccurrences).toEqual(
      expect.arrayContaining([{ date: '2026-10-14', graphId: 'inst-2026-10-14' }])
    );
  });

  it('REX-2: earlier cancellations are preserved', async () => {
    const master = createPublishedSeriesMaster({ graphId: 'G-rex2' });
    master.recurrence = { ...master.recurrence, exclusions: ['2026-03-17'] };
    master.graphData.cancelledOccurrences = [{ date: '2026-03-17', graphId: 'inst-publish' }];
    const [saved] = await insertEvents(db, [master]);
    graphApiMock.setMockResponse('getRecurringEventInstances', instances(['2026-03-24']));

    await saveExclusions(saved, ['2026-03-17', '2026-03-24']);

    const after = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
    expect(after.graphData.cancelledOccurrences).toEqual(expect.arrayContaining([
      { date: '2026-03-17', graphId: 'inst-publish' },
      { date: '2026-03-24', graphId: 'inst-2026-03-24' },
    ]));
  });

  it('REX-3: an instance that is already gone is a no-op', async () => {
    const [saved] = await insertEvents(db, [createPublishedSeriesMaster({ graphId: 'G-rex3' })]);

    await saveExclusions(saved, ['2026-03-17']);

    graphApiMock.assertNotCalled('deleteCalendarEvent');
  });

  it('REX-4: the lookup carries the series timezone and a one-day window either side', async () => {
    const [saved] = await insertEvents(db, [createPublishedSeriesMaster({ graphId: 'G-rex4', timeZone: 'Eastern Standard Time' })]);

    await saveExclusions(saved, ['2026-03-17']);

    const lookup = graphApiMock.getCallHistory('getRecurringEventInstances')[0];
    expect(lookup.timeZone).toBe('Eastern Standard Time');
    expect([lookup.startDateTime, lookup.endDateTime]).toEqual(['2026-03-16T00:00:00', '2026-03-18T23:59:59']);
  });

  it('REX-5: excluding an added date soft-deletes the child and deletes its Graph event', async () => {
    const master = createPublishedSeriesMaster({ graphId: 'G-rex5' });
    master.recurrence = { ...master.recurrence, additions: ['2026-03-12'] };
    await insertEvents(db, [createAdditionDocument(master, '2026-03-12', {}, { graphEventId: 'G-add' })]);
    const [saved] = await insertEvents(db, [master]);

    await saveExclusions(saved, ['2026-03-12']);

    const child = await db.collection(COLLECTIONS.EVENTS).findOne({ seriesMasterEventId: saved.eventId, occurrenceDate: '2026-03-12' });
    expect(child.isDeleted).toBe(true);
    expect(graphApiMock.getCallHistory('deleteCalendarEvent').map(d => d.eventId)).toEqual(['G-add']);
    expect(graphApiMock.getCallHistory('getRecurringEventInstances')).toHaveLength(0);
  });
});
