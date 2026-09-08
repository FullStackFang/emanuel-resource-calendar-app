const request = require('supertest');
const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const { createPublishedEvent, insertEvents } = require('../../__helpers__/eventFactory');
const { createPendingEditRequest, insertEditRequest } = require('../../__helpers__/editRequestFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');

describe('Calendar reload after approving a date change', () => {
  let client, db, app;
  beforeAll(async () => {
    await initTestKeys();
    ({ db, client } = await connectToGlobalServer('approvedEditCalendarDate'));
    app = await setupTestApp(db);
  });
  afterAll(async () => disconnectFromGlobalServer(client, db));
  beforeEach(async () => {
    for (const name of [COLLECTIONS.USERS, COLLECTIONS.EVENTS, COLLECTIONS.EDIT_REQUESTS, COLLECTIONS.AUDIT_HISTORY]) {
      await db.collection(name).deleteMany({});
    }
  });

  it('displays the approved dates when stored start/end still contain the old dates', async () => {
    const approver = createApprover();
    const owner = createRequester();
    await insertUsers(db, [approver, owner]);
    const event = createPublishedEvent({ userId: owner.odataId, requesterEmail: owner.email });
    event.calendarData = {
      ...event.calendarData, eventTitle: 'Date move reproduction',
      startDateTime: '2027-04-26T16:00:00', endDateTime: '2027-04-26T17:00:00',
      startDate: '2027-04-26', endDate: '2027-04-26', startTime: '16:00', endTime: '17:00',
      locations: [],
    };
    event.start = { dateTime: '2027-04-26T16:00:00', timeZone: 'America/New_York' };
    event.end = { dateTime: '2027-04-26T17:00:00', timeZone: 'America/New_York' };
    event.graphData = { id: 'graph-date-move', start: event.start, end: event.end };
    await insertEvents(db, [event]);
    const edit = await insertEditRequest(db, createPendingEditRequest({
      eventId: event.eventId, eventObjectId: event._id, userId: owner.odataId,
      proposedChanges: {
        startDateTime: '2027-04-29T16:30:00', endDateTime: '2027-04-29T17:30:00',
        startDate: '2027-04-29', endDate: '2027-04-29', startTime: '16:30', endTime: '17:30',
      },
    }));
    const approverToken = await createMockToken(approver);
    await request(app).put(`/api/edit-requests/${edit._id}/approve`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ editRequestVersion: edit._version, eventVersion: event._version }).expect(200);

    const ownerToken = await createMockToken(owner);
    const res = await request(app).post('/api/events/load')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ calendarOwners: [event.calendarOwner], startTime: '2027-04-25T00:00:00', endTime: '2027-05-02T00:00:00' })
      .expect(200);
    const loaded = res.body.events.find(e => e.eventId === event.eventId);
    expect(loaded.calendarData.startDateTime).toBe('2027-04-29T16:30:00');
    expect(loaded.start).toEqual({ dateTime: '2027-04-29T16:30:00', timeZone: 'America/New_York' });
    expect(loaded.end).toEqual({ dateTime: '2027-04-29T17:30:00', timeZone: 'America/New_York' });
  });

  it('keeps reservation display times for Hold events', async () => {
    const owner = createRequester();
    await insertUsers(db, [owner]);
    const event = createPublishedEvent({ userId: owner.odataId, requesterEmail: owner.email });
    event.calendarData = {
      eventTitle: 'Held room', startDateTime: '2027-04-29T00:00:00', endDateTime: '2027-04-29T23:59:00',
      startDate: '2027-04-29', endDate: '2027-04-29', startTime: '', endTime: '',
      reservationStartTime: '16:30', reservationEndTime: '17:30',
    };
    event.start = { dateTime: '2027-04-26T16:00:00', timeZone: 'America/New_York' };
    event.end = { dateTime: '2027-04-26T17:00:00', timeZone: 'America/New_York' };
    await insertEvents(db, [event]);
    const token = await createMockToken(owner);
    const res = await request(app).post('/api/events/load')
      .set('Authorization', `Bearer ${token}`)
      .send({ calendarOwners: [event.calendarOwner], startTime: '2027-04-25T00:00:00', endTime: '2027-05-02T00:00:00' })
      .expect(200);
    expect(res.body.events[0].subject).toBe('[Hold] Held room');
    expect(res.body.events[0].start.dateTime).toBe('2027-04-29T16:30');
    expect(res.body.events[0].end.dateTime).toBe('2027-04-29T17:30');
  });
});
