const request = require('supertest');
const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createAdmin, createApprover, createRequester, createOtherRequester, createViewer, insertUsers } = require('../../__helpers__/userFactory');
const { createPublishedEvent, insertEvents } = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');

describe('Event audit history access', () => {
  let client, db, app, owner, event;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client } = await connectToGlobalServer('eventAuditHistory'));
    app = await setupTestApp(db);
  });
  afterAll(async () => disconnectFromGlobalServer(client, db));
  beforeEach(async () => {
    for (const name of [COLLECTIONS.USERS, COLLECTIONS.EVENTS, COLLECTIONS.AUDIT_HISTORY, 'templeEvents__ReservationAuditHistory']) {
      await db.collection(name).deleteMany({});
    }
    owner = createRequester();
    await insertUsers(db, [owner]);
    [event] = await insertEvents(db, [createPublishedEvent({ userId: owner.odataId, requesterEmail: owner.email })]);
    await db.collection(COLLECTIONS.AUDIT_HISTORY).insertMany([
      { eventId: event.eventId, action: 'edit-request-submitted', timestamp: new Date('2026-09-08T13:19:18Z') },
      { eventId: event.eventId, action: 'edit-request-approved', timestamp: new Date('2026-09-08T13:20:54Z'), changes: [
        { field: 'startDate', oldValue: '2027-04-26', newValue: '2027-04-29' },
      ] },
      { eventId: 'unrelated-event', action: 'update', timestamp: new Date() },
    ]);
  });

  async function getHistory(user, eventId = event.eventId, query = '') {
    const token = await createMockToken(user);
    return request(app).get(`/api/events/${eventId}/audit-history${query}`).set('Authorization', `Bearer ${token}`);
  }

  it.each([['admin', createAdmin], ['approver', createApprover]])('allows a non-owner %s and returns only this event history', async (_, factory) => {
    const user = factory();
    await insertUsers(db, [user]);
    const res = await getHistory(user, event.eventId, '?limit=1');
    expect(res.status).toBe(200);
    expect(res.body.auditHistory).toHaveLength(1);
    expect(res.body.auditHistory[0].action).toBe('edit-request-approved');
    expect(res.body.auditHistory[0].changes[0].newValue).toBe('2027-04-29');
    expect(res.body.pagination).toEqual({ total: 2, offset: 0, limit: 1, hasMore: true });
  });

  it('allows the requester', async () => {
    expect((await getHistory(owner)).status).toBe(200);
  });

  it('recognizes canonical requester email despite a legacy user ID', async () => {
    await db.collection(COLLECTIONS.EVENTS).updateOne({ _id: event._id }, { $set: {
      userId: 'old-id', 'roomReservationData.requestedBy.userId': 'old-id',
      'roomReservationData.requestedBy.email': owner.email.toUpperCase(),
    } });
    expect((await getHistory(owner)).status).toBe(200);
  });

  it.each([['requester', createOtherRequester], ['viewer', createViewer]])('allows any signed-in %s to read published history', async (_, factory) => {
    const user = factory();
    await insertUsers(db, [user]);
    expect((await getHistory(user)).status).toBe(200);
  });

  it.each(['draft', 'pending', 'rejected', 'deleted'])('does not disclose another requester\'s %s history', async (status) => {
    const user = createOtherRequester();
    await insertUsers(db, [user]);
    await db.collection(COLLECTIONS.EVENTS).updateOne({ _id: event._id }, { $set: { status } });
    expect((await getHistory(user)).status).toBe(404);
  });

  it('does not treat the original creator as owner after reassignment', async () => {
    const nextOwner = createOtherRequester();
    await db.collection(COLLECTIONS.EVENTS).updateOne({ _id: event._id }, { $set: {
      status: 'pending',
      'roomReservationData.requestedBy': { userId: nextOwner.odataId, email: nextOwner.email },
    } });
    expect((await getHistory(owner)).status).toBe(404);
  });

  it('returns 404 for a missing event', async () => {
    expect((await getHistory(owner, 'missing-event')).status).toBe(404);
  });

  it('requires authentication', async () => {
    const res = await request(app).get(`/api/events/${event.eventId}/audit-history`);
    expect(res.status).toBe(401);
  });

  it('includes legacy reservation changes in the same ordered, paginated history', async () => {
    await db.collection('templeEvents__ReservationAuditHistory').insertOne({
      reservationId: event._id, changeType: 'update', userEmail: owner.email,
      timestamp: new Date('2026-09-08T13:20:00Z'),
      changeSet: [{ field: 'eventTitle', oldValue: 'Before', newValue: 'After' }],
    });
    const res = await getHistory(owner, event.eventId, '?limit=1&offset=1');
    expect(res.status).toBe(200);
    expect(res.body.auditHistory[0].changeSet[0].newValue).toBe('After');
    expect(res.body.pagination).toEqual({ total: 3, offset: 1, limit: 1, hasMore: true });
  });

  it('records a direct admin save with before/after values and actor', async () => {
    const admin = createAdmin();
    await insertUsers(db, [admin]);
    const token = await createMockToken(admin);
    await request(app).put(`/api/admin/events/${event._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ _version: event._version, eventTitle: 'Updated rehearsal', startDate: '2027-04-29', startTime: '16:29',
        endDate: '2027-04-29', endTime: '17:30', locations: [] }).expect(200);
    const res = await getHistory(owner);
    const saved = res.body.auditHistory.find(e => e.source === 'Admin Event Save');
    expect(saved).toBeDefined();
    expect(saved.metadata.userEmail).toBe(admin.email);
    expect(saved.changeSet).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'eventTitle', oldValue: event.calendarData.eventTitle, newValue: 'Updated rehearsal' }),
      expect.objectContaining({ field: 'startDateTime', newValue: '2027-04-29T16:29:00' }),
    ]));
  });

  it.each(['?limit=0', '?limit=101', '?limit=abc', '?offset=-1', '?offset=1.5'])('rejects invalid pagination %s', async query => {
    expect((await getHistory(owner, event.eventId, query)).status).toBe(400);
  });

  it('does not audit a save rejected by the version guard', async () => {
    const admin = createAdmin();
    await insertUsers(db, [admin]);
    const token = await createMockToken(admin);
    await request(app).put(`/api/admin/events/${event._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ _version: event._version + 1, eventTitle: 'Not committed' }).expect(409);
    const res = await getHistory(owner);
    expect(res.body.auditHistory.some(e => e.source === 'Admin Event Save')).toBe(false);
  });
});
