/**
 * PUT /api/edit-requests/:id/approve — Phase 1b two-write approval endpoint
 *
 * Coverage:
 *   Permission gates (approver/admin only; force requires admin)
 *   Status checks (must be pending)
 *   Two-write success: request → approved, event fields → updated
 *   Partial failure: Write 1 succeeds, Write 2 409 → partialFailure: true
 *   Approver overrides merged with proposedChanges
 *   Supersede sweep: matching-scope co-pending requests → superseded
 *   Series vs occurrence scope (occurrence writes an exception child document)
 *   Audit log + email shape
 *   Graph sync (ERG-1..20, edit-request-approval-graph-sync): master PATCH from
 *   effective state, series reconciliation (additions, exclusions, cascade),
 *   non-fatal failures reported in `graphSync`, occurrence pre-flight.
 *
 * graphApiMock.assertCalled compares whole values, so payload assertions here
 * read getCallHistory() and check only the fields that matter.
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

// Same module instance api-server.js requires — spying on it intercepts the
// post-response approval email so we can assert on the changes payload.
const emailService = require('../../../services/emailService');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, createOtherRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPublishedEvent,
  createPublishedEventWithGraph,
  createPublishedSeriesMaster,
  createExceptionDocument,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const graphApiMock = require('../../__helpers__/graphApiMock');
const {
  createPendingEditRequest,
  insertEditRequest,
  insertEditRequests,
} = require('../../__helpers__/editRequestFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');

describe('PUT /api/edit-requests/:id/approve', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;
  let requesterToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('editRequestsApprove'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.EDIT_REQUESTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});
    await db.collection(COLLECTIONS.LOCATIONS).deleteMany({});
    graphApiMock.resetMocks();

    approverUser = createApprover();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, requesterUser]);

    approverToken = await createMockToken(approverUser);
    requesterToken = await createMockToken(requesterUser);
  });

  async function seedPendingRequestOnEvent(overrides = {}) {
    const published = createPublishedEvent({
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      eventTitle: overrides.eventTitle || 'Original Title',
    });
    const [savedEvent] = await insertEvents(db, [published]);
    const editRequest = await insertEditRequest(db, createPendingEditRequest({
      eventId: savedEvent.eventId,
      eventObjectId: savedEvent._id,
      userId: requesterUser.odataId,
      requestedBy: {
        userId: requesterUser.odataId,
        email: requesterUser.email,
        name: requesterUser.email,
      },
      proposedChanges: overrides.proposedChanges || { eventTitle: 'New Title' },
      editScope: overrides.editScope || null,
      occurrenceDate: overrides.occurrenceDate || null,
    }));
    return { savedEvent, editRequest };
  }

  // ---- Graph-sync fixtures (ERG) ------------------------------------------
  const ROOM_A_ID = new ObjectId('64c000000000000000000a01');
  const ROOM_B_ID = new ObjectId('64c000000000000000000a02');
  const SERIES_GRAPH_ID = 'AAMkErg-series';

  async function seedRooms() {
    await db.collection(COLLECTIONS.LOCATIONS).insertMany([
      { _id: ROOM_A_ID, name: 'Sanctuary', displayName: 'Sanctuary', isReservable: true, active: true },
      { _id: ROOM_B_ID, name: 'Greenwald Hall', displayName: 'Greenwald Hall', isReservable: true, active: true },
    ]);
  }

  // Graph instances for a weekly series, one per date, in the event's zone.
  function instancesFor(dates) {
    return dates.map((d) => ({
      id: `inst-${d}`,
      start: { dateTime: `${d}T10:00:00.0000000`, timeZone: 'America/New_York' },
      end: { dateTime: `${d}T11:00:00.0000000`, timeZone: 'America/New_York' },
    }));
  }

  async function seedRequestOn(eventDoc, { proposedChanges, editScope = null, occurrenceDate = null }) {
    const [savedEvent] = await insertEvents(db, [eventDoc]);
    const editRequest = await insertEditRequest(db, createPendingEditRequest({
      eventId: savedEvent.eventId,
      eventObjectId: savedEvent._id,
      userId: requesterUser.odataId,
      requestedBy: { userId: requesterUser.odataId, email: requesterUser.email, name: requesterUser.email },
      proposedChanges,
      editScope,
      occurrenceDate,
    }));
    return { savedEvent, editRequest };
  }

  function seriesMaster(overrides = {}) {
    return createPublishedSeriesMaster({
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      eventTitle: 'Weekly Class',
      graphId: SERIES_GRAPH_ID,
      ...overrides,
    });
  }

  async function approve(editRequest, savedEvent, body = {}, expected = 200) {
    return request(app)
      .put(`/api/edit-requests/${editRequest._id}/approve`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({
        editRequestVersion: editRequest._version,
        eventVersion: savedEvent._version,
        ...body,
      })
      .expect(expected);
  }

  // The audit insert runs after res.json, so poll briefly for it.
  async function waitForAudit(eventId) {
    for (let i = 0; i < 20; i += 1) {
      const audit = await db.collection(COLLECTIONS.AUDIT_HISTORY)
        .findOne({ action: 'edit-request-approved', eventId });
      if (audit) return audit;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  }

  const masterCalls = () => graphApiMock.getCallHistory('updateCalendarEvent')
    .filter((c) => c.eventId === SERIES_GRAPH_ID);

  describe('happy path — series-level', () => {
    it('flips request status to approved and updates the event', async () => {
      const { savedEvent, editRequest } = await seedPendingRequestOnEvent({
        proposedChanges: { eventTitle: 'Approved Title' },
      });

      const res = await request(app)
        .put(`/api/edit-requests/${editRequest._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          notes: 'looks good',
          editRequestVersion: editRequest._version,
          eventVersion: savedEvent._version,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.editRequestVersion).toBe(editRequest._version + 1);
      expect(res.body.eventVersion).toBe((savedEvent._version || 1) + 1);

      const editRequestAfter = await db
        .collection(COLLECTIONS.EDIT_REQUESTS)
        .findOne({ _id: editRequest._id });
      expect(editRequestAfter.status).toBe('approved');
      expect(editRequestAfter.reviewNotes).toBe('looks good');
      expect(editRequestAfter.reviewedBy.email).toBe(approverUser.email);

      const eventAfter = await db
        .collection(COLLECTIONS.EVENTS)
        .findOne({ _id: savedEvent._id });
      expect(eventAfter.calendarData.eventTitle).toBe('Approved Title');
    });

    it('merges approverChanges over proposedChanges', async () => {
      const { savedEvent, editRequest } = await seedPendingRequestOnEvent({
        proposedChanges: { eventTitle: 'Requester Title', eventDescription: 'Requester desc' },
      });

      await request(app)
        .put(`/api/edit-requests/${editRequest._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          approverChanges: { eventTitle: 'Approver Override' }, // overrides title only
          editRequestVersion: editRequest._version,
          eventVersion: savedEvent._version,
        })
        .expect(200);

      const eventAfter = await db
        .collection(COLLECTIONS.EVENTS)
        .findOne({ _id: savedEvent._id });
      expect(eventAfter.calendarData.eventTitle).toBe('Approver Override');
      expect(eventAfter.calendarData.eventDescription).toBe('Requester desc');
    });

    it('writes an audit log entry referencing the approved request', async () => {
      const { savedEvent, editRequest } = await seedPendingRequestOnEvent();

      await request(app)
        .put(`/api/edit-requests/${editRequest._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          editRequestVersion: editRequest._version,
          eventVersion: savedEvent._version,
        })
        .expect(200);

      const audit = await db
        .collection(COLLECTIONS.AUDIT_HISTORY)
        .findOne({ action: 'edit-request-approved', eventId: savedEvent.eventId });
      expect(audit).toBeDefined();
      expect(audit.metadata.editRequestId).toBe(editRequest.editRequestId);
    });
  });

  describe('Graph sync — series level (ERG-1..10)', () => {
    it('ERG-1: title and time change PATCHes the master in its stored timezone', async () => {
      const event = createPublishedEventWithGraph({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
        graphId: 'AAMkErg-single',
        startDateTime: new Date(2026, 4, 5, 10, 0, 0),
        endDateTime: new Date(2026, 4, 5, 11, 0, 0),
      });
      event.graphData.start = { dateTime: '2026-05-05T10:00:00.0000000', timeZone: 'America/New_York' };
      event.graphData.end = { dateTime: '2026-05-05T11:00:00.0000000', timeZone: 'America/New_York' };
      const { savedEvent, editRequest } = await seedRequestOn(event, {
        proposedChanges: {
          eventTitle: 'New Title',
          startDateTime: '2026-05-05T14:00:00',
          endDateTime: '2026-05-05T15:00:00',
        },
      });

      await approve(editRequest, savedEvent);

      const calls = graphApiMock.getCallHistory('updateCalendarEvent')
        .filter((c) => c.eventId === 'AAMkErg-single');
      expect(calls).toHaveLength(1);
      expect(calls[0].eventData.subject).toBe('New Title');
      expect(calls[0].eventData.start).toEqual({ dateTime: '2026-05-05T14:00:00', timeZone: 'America/New_York' });
      expect(calls[0].eventData.end).toEqual({ dateTime: '2026-05-05T15:00:00', timeZone: 'America/New_York' });
    });

    it('ERG-2: time-only change on a series is aligned to range start and sends no recurrence', async () => {
      // Production stores a series master's endDateTime as the series END, so
      // an unaligned PATCH would describe a months-long first occurrence.
      const master = seriesMaster();
      master.calendarData.endDateTime = '2026-06-30T11:00:00';
      const { savedEvent, editRequest } = await seedRequestOn(master, {
        proposedChanges: {
          startDateTime: '2026-03-10T14:00:00',
          endDateTime: '2026-06-30T15:00:00',
          startTime: '14:00',
          endTime: '15:00',
        },
      });

      await approve(editRequest, savedEvent);

      const calls = masterCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].eventData.start.dateTime).toBe('2026-03-10T14:00:00');
      expect(calls[0].eventData.end.dateTime).toBe('2026-03-10T15:00:00');
      expect('recurrence' in calls[0].eventData).toBe(false);
    });

    it('ERG-3: room change resolves display names', async () => {
      await seedRooms();
      const { savedEvent, editRequest } = await seedRequestOn(seriesMaster(), {
        proposedChanges: {
          locations: [ROOM_A_ID, ROOM_B_ID],
          requestedRooms: [ROOM_A_ID, ROOM_B_ID],
          locationDisplayNames: 'Sanctuary; Greenwald Hall',
        },
      });

      await approve(editRequest, savedEvent);

      const calls = masterCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].eventData.location.displayName).toBe('Sanctuary; Greenwald Hall');
      expect(calls[0].eventData.locations.map((l) => l.displayName)).toEqual(['Sanctuary', 'Greenwald Hall']);
    });

    it('ERG-4: recurrence change is sent and aligned to the new range start', async () => {
      const master = seriesMaster();
      const { savedEvent, editRequest } = await seedRequestOn(master, {
        proposedChanges: {
          recurrence: {
            ...master.recurrence,
            range: { type: 'endDate', startDate: '2026-03-17', endDate: '2026-06-30' },
          },
        },
      });

      await approve(editRequest, savedEvent);

      const calls = masterCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].eventData.recurrence.range.startDate).toBe('2026-03-17');
      expect(calls[0].eventData.start.dateTime).toBe('2026-03-17T10:00:00');
      expect(calls[0].eventData.end.dateTime).toBe('2026-03-17T11:00:00');
    });

    it('ERG-5: an unpublished-to-Outlook event (no graphData.id) is not synced', async () => {
      const { savedEvent, editRequest } = await seedPendingRequestOnEvent({
        proposedChanges: { eventTitle: 'No Graph' },
      });

      const res = await approve(editRequest, savedEvent);

      expect(res.body.success).toBe(true);
      graphApiMock.assertNotCalled('updateCalendarEvent');
      graphApiMock.assertNotCalled('createCalendarEvent');
      graphApiMock.assertNotCalled('deleteCalendarEvent');
    });

    it('ERG-6: an added date gets an addition child and a standalone Graph event', async () => {
      const master = seriesMaster();
      const { savedEvent, editRequest } = await seedRequestOn(master, {
        proposedChanges: { recurrence: { ...master.recurrence, additions: ['2026-03-12'] } },
      });

      const res = await approve(editRequest, savedEvent);

      const child = await db.collection(COLLECTIONS.EVENTS).findOne({
        seriesMasterEventId: savedEvent.eventId, occurrenceDate: '2026-03-12', isDeleted: { $ne: true },
      });
      expect(child).toBeTruthy();
      expect(child.eventType).toBe('addition');
      const creates = graphApiMock.getCallHistory('createCalendarEvent');
      expect(creates).toHaveLength(1);
      expect(creates[0].eventData.start.dateTime.startsWith('2026-03-12')).toBe(true);
      expect(child.graphEventId).toBeTruthy();
      expect(res.body.graphSync.synced).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'addition', date: '2026-03-12', graphId: child.graphEventId })])
      );
    });

    it('ERG-7: a newly excluded date is cancelled in Outlook and recorded', async () => {
      const master = seriesMaster();
      graphApiMock.setMockResponse('getRecurringEventInstances', instancesFor(['2026-03-10', '2026-03-17', '2026-03-24']));
      const { savedEvent, editRequest } = await seedRequestOn(master, {
        proposedChanges: { recurrence: { ...master.recurrence, exclusions: ['2026-03-17'] } },
      });

      const res = await approve(editRequest, savedEvent);

      const deletes = graphApiMock.getCallHistory('deleteCalendarEvent');
      expect(deletes).toHaveLength(1);
      expect(deletes[0].eventId).toBe('inst-2026-03-17');
      const lookup = graphApiMock.getCallHistory('getRecurringEventInstances')[0];
      expect(lookup.timeZone).toBe('America/New_York');
      expect(lookup.startDateTime).toBe('2026-03-16T00:00:00');
      expect(lookup.endDateTime).toBe('2026-03-18T23:59:59');
      const stored = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedEvent._id });
      expect(stored.graphData.cancelledOccurrences).toEqual(
        expect.arrayContaining([{ date: '2026-03-17', graphId: 'inst-2026-03-17' }])
      );
      expect(res.body.graphSync.cancelledExclusions).toEqual([{ date: '2026-03-17', graphId: 'inst-2026-03-17' }]);
    });

    it('ERG-8: a master title change cascades to a child already linked to Outlook', async () => {
      const master = seriesMaster();
      const child = createExceptionDocument(master, '2026-03-24', { startTime: '12:00', endTime: '13:00' }, {
        graphEventId: 'inst-child-0324',
      });
      await insertEvents(db, [child]);
      const { savedEvent, editRequest } = await seedRequestOn(master, {
        proposedChanges: { eventTitle: 'Renamed Class' },
      });

      await approve(editRequest, savedEvent);

      const childCalls = graphApiMock.getCallHistory('updateCalendarEvent')
        .filter((c) => c.eventId === 'inst-child-0324');
      expect(childCalls).toHaveLength(1);
      expect(childCalls[0].eventData.subject).toBe('Renamed Class');
      // The child's own override (its time) still wins over the master.
      expect(childCalls[0].eventData.start.dateTime.startsWith('2026-03-24T12:00')).toBe(true);
    });

    it('ERG-9: unchanged pattern/range queries Graph only for the one new exclusion', async () => {
      const master = seriesMaster();
      master.recurrence = { ...master.recurrence, exclusions: ['2026-03-17'] };
      graphApiMock.setMockResponse('getRecurringEventInstances', instancesFor(['2026-03-24']));
      const { savedEvent, editRequest } = await seedRequestOn(master, {
        proposedChanges: { recurrence: { ...master.recurrence, exclusions: ['2026-03-17', '2026-03-24'] } },
      });

      await approve(editRequest, savedEvent);

      const lookups = graphApiMock.getCallHistory('getRecurringEventInstances');
      expect(lookups).toHaveLength(1);
      expect(lookups[0].startDateTime).toBe('2026-03-23T00:00:00');
      // Exclusions are not part of Graph's recurrence, so nothing to PATCH.
      expect(masterCalls()).toHaveLength(0);
    });

    it('ERG-10: approverChanges that drop an exclusion are refused before Write 1', async () => {
      const master = seriesMaster();
      master.recurrence = { ...master.recurrence, exclusions: ['2026-03-17'] };
      const { savedEvent, editRequest } = await seedRequestOn(master, {
        proposedChanges: { eventTitle: 'Harmless' },
      });

      const res = await approve(editRequest, savedEvent, {
        approverChanges: { recurrence: { ...master.recurrence, exclusions: [] } },
      }, 400);

      expect(res.body.error).toBe('EXCLUSION_REMOVAL_NOT_SUPPORTED');
      const requestAfter = await db.collection(COLLECTIONS.EDIT_REQUESTS).findOne({ _id: editRequest._id });
      expect(requestAfter.status).toBe('pending');
      const eventAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedEvent._id });
      expect(eventAfter._version).toBe(savedEvent._version);
      expect(eventAfter.recurrence.exclusions).toEqual(['2026-03-17']);
    });
  });

  describe('Graph sync — failure and audit (ERG-11..13)', () => {
    it('ERG-11: a Graph PATCH failure does not un-approve and is reported', async () => {
      const { savedEvent, editRequest } = await seedRequestOn(seriesMaster(), {
        proposedChanges: { eventTitle: 'Approved Anyway' },
      });
      graphApiMock.setMockError('updateCalendarEvent', graphApiMock.graphError(503, 'busy'));

      const res = await approve(editRequest, savedEvent);

      expect(res.body.graphSync.failed[0].kind).toBe('master');
      const requestAfter = await db.collection(COLLECTIONS.EDIT_REQUESTS).findOne({ _id: editRequest._id });
      expect(requestAfter.status).toBe('approved');
      const eventAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedEvent._id });
      expect(eventAfter.calendarData.eventTitle).toBe('Approved Anyway');
      expect(res.body.eventVersion).toBe(eventAfter._version);
    });

    it('ERG-12: the audit entry carries the sync summary', async () => {
      const { savedEvent, editRequest } = await seedRequestOn(seriesMaster(), {
        proposedChanges: { eventTitle: 'Audited' },
      });

      await approve(editRequest, savedEvent);

      const audit = await waitForAudit(savedEvent.eventId);
      expect(audit.metadata.graphSync.synced).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'master', graphId: SERIES_GRAPH_ID })])
      );
      expect(audit.metadata.graphSync.failed).toEqual([]);
    });

    it('ERG-13: follow-up sync writes do not bump the master _version', async () => {
      const master = seriesMaster();
      graphApiMock.setMockResponse('getRecurringEventInstances', instancesFor(['2026-03-17']));
      const { savedEvent, editRequest } = await seedRequestOn(master, {
        proposedChanges: {
          eventTitle: 'Busy Approval',
          recurrence: { ...master.recurrence, exclusions: ['2026-03-17'], additions: ['2026-03-12'] },
        },
      });

      const res = await approve(editRequest, savedEvent);

      const eventAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedEvent._id });
      expect(eventAfter._version).toBe(savedEvent._version + 1);
      expect(res.body.eventVersion).toBe(eventAfter._version);
      expect(eventAfter.graphData.cancelledOccurrences).toHaveLength(1);
    });
  });

  describe('happy path — occurrence-scoped (ERG-14..20)', () => {
    it('ERG-14: pre-flight refuses a singleInstance target and leaves the request pending', async () => {
      const { savedEvent, editRequest } = await seedPendingRequestOnEvent({
        proposedChanges: { eventTitle: 'March 12 Special' },
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-12',
      });

      await approve(editRequest, savedEvent, {}, 400);

      const requestAfter = await db.collection(COLLECTIONS.EDIT_REQUESTS).findOne({ _id: editRequest._id });
      expect(requestAfter.status).toBe('pending');
      const eventAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedEvent._id });
      expect(eventAfter._version).toBe(savedEvent._version);
      expect(eventAfter.occurrenceOverrides).toBeUndefined();
    });

    it('ERG-15: approval creates an exception child, patches one instance, bumps the master', async () => {
      graphApiMock.setMockResponse('getRecurringEventInstances', instancesFor(['2026-03-17']));
      const { savedEvent, editRequest } = await seedRequestOn(seriesMaster(), {
        proposedChanges: { eventTitle: 'Mar 17 Special' },
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-17',
      });

      const res = await approve(editRequest, savedEvent);

      const child = await db.collection(COLLECTIONS.EVENTS).findOne({
        seriesMasterEventId: savedEvent.eventId, occurrenceDate: '2026-03-17', isDeleted: { $ne: true },
      });
      expect(child.eventType).toBe('exception');
      expect(child.overrides.eventTitle).toBe('Mar 17 Special');
      expect(child.graphEventId).toBe('inst-2026-03-17');
      const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedEvent._id });
      expect(masterAfter.calendarData.eventTitle).toBe('Weekly Class');
      expect(masterAfter._version).toBe(savedEvent._version + 1);
      expect(res.body.eventVersion).toBe(masterAfter._version);
      expect(res.body.exceptionDocId).toBe(String(child._id));
      const calls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(calls).toHaveLength(1);
      expect(calls[0].eventId).toBe('inst-2026-03-17');
      expect(calls[0].eventData.subject).toBe('Mar 17 Special');
    });

    it('ERG-16: an existing exception is updated in place', async () => {
      graphApiMock.setMockResponse('getRecurringEventInstances', instancesFor(['2026-03-17']));
      const master = seriesMaster();
      await insertEvents(db, [createExceptionDocument(master, '2026-03-17', { eventDescription: 'Kept note' })]);
      const { savedEvent, editRequest } = await seedRequestOn(master, {
        proposedChanges: { eventTitle: 'Retitled Once' },
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-17',
      });

      await approve(editRequest, savedEvent);

      const children = await db.collection(COLLECTIONS.EVENTS).find({
        seriesMasterEventId: savedEvent.eventId, occurrenceDate: '2026-03-17', isDeleted: { $ne: true },
      }).toArray();
      expect(children).toHaveLength(1);
      expect(children[0].overrides).toEqual(expect.objectContaining({
        eventTitle: 'Retitled Once', eventDescription: 'Kept note',
      }));
    });

    it('ERG-17: a stale eventVersion is a partial failure, as for series edits', async () => {
      const { savedEvent, editRequest } = await seedRequestOn(seriesMaster(), {
        proposedChanges: { eventTitle: 'Too Late' },
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-17',
      });
      await db.collection(COLLECTIONS.EVENTS).updateOne({ _id: savedEvent._id }, { $inc: { _version: 1 } });

      const res = await approve(editRequest, savedEvent, {}, 409);

      expect(res.body.partialFailure).toBe(true);
      expect(res.body.compensationRequired).toBe(true);
    });

    it('ERG-18: an unresolvable instance still writes the child and reports the date', async () => {
      const { savedEvent, editRequest } = await seedRequestOn(seriesMaster(), {
        proposedChanges: { eventTitle: 'No Instance' },
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-17',
      });

      const res = await approve(editRequest, savedEvent);

      const child = await db.collection(COLLECTIONS.EVENTS).findOne({
        seriesMasterEventId: savedEvent.eventId, occurrenceDate: '2026-03-17',
      });
      expect(child.overrides.eventTitle).toBe('No Instance');
      graphApiMock.assertNotCalled('updateCalendarEvent');
      expect(res.body.graphSync.failed).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'occurrence', date: '2026-03-17' })])
      );
    });

    it('ERG-19: a rooms-only request is conflict-checked on the occurrence date, not the series start', async () => {
      await seedRooms();
      const blocker = createPublishedEvent({
        eventTitle: 'Blocker',
        locations: [ROOM_B_ID],
        startDateTime: new Date(2026, 2, 17, 10, 0, 0),
        endDateTime: new Date(2026, 2, 17, 11, 0, 0),
      });
      await insertEvents(db, [blocker]);
      const { savedEvent, editRequest } = await seedRequestOn(seriesMaster({ locations: [ROOM_A_ID] }), {
        proposedChanges: { locations: [ROOM_B_ID], requestedRooms: [ROOM_B_ID] },
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-17',
      });

      const res = await approve(editRequest, savedEvent, {}, 409);

      expect(res.body.error).toBe('SchedulingConflict');
      const requestAfter = await db.collection(COLLECTIONS.EDIT_REQUESTS).findOne({ _id: editRequest._id });
      expect(requestAfter.status).toBe('pending');
    });

    it('ERG-20: the legacy occurrenceOverrides[] array is never written', async () => {
      const master = seriesMaster();
      master.occurrenceOverrides = [{ occurrenceDate: '2026-03-24', eventTitle: 'Legacy' }];
      const { savedEvent, editRequest } = await seedRequestOn(master, {
        proposedChanges: { eventTitle: 'Child Only' },
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-17',
      });

      await approve(editRequest, savedEvent);

      const masterAfter = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: savedEvent._id });
      expect(masterAfter.occurrenceOverrides).toEqual([{ occurrenceDate: '2026-03-24', eventTitle: 'Legacy' }]);
    });
  });

  describe('partial failure — Write 1 succeeds, Write 2 409', () => {
    it('returns partialFailure: true when event _version is stale', async () => {
      const { savedEvent, editRequest } = await seedPendingRequestOnEvent({
        proposedChanges: { eventTitle: 'Will fail to apply' },
      });

      // Bump the event _version externally to simulate concurrent modification
      await db.collection(COLLECTIONS.EVENTS).updateOne(
        { _id: savedEvent._id },
        { $inc: { _version: 1 } }
      );

      const res = await request(app)
        .put(`/api/edit-requests/${editRequest._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          editRequestVersion: editRequest._version,
          eventVersion: savedEvent._version, // stale
        })
        .expect(409);

      expect(res.body.partialFailure).toBe(true);
      expect(res.body.compensationRequired).toBe(true);
      expect(res.body.editRequestApproved).toBe(true);

      // Edit request is approved (Write 1 succeeded)
      const editRequestAfter = await db
        .collection(COLLECTIONS.EDIT_REQUESTS)
        .findOne({ _id: editRequest._id });
      expect(editRequestAfter.status).toBe('approved');

      // Event title is unchanged (Write 2 failed before applying)
      const eventAfter = await db
        .collection(COLLECTIONS.EVENTS)
        .findOne({ _id: savedEvent._id });
      expect(eventAfter.calendarData.eventTitle).toBe('Original Title');
    });
  });

  describe('permission gates', () => {
    it('rejects requesters from approving (403)', async () => {
      const { savedEvent, editRequest } = await seedPendingRequestOnEvent();

      const res = await request(app)
        .put(`/api/edit-requests/${editRequest._id}/approve`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          editRequestVersion: editRequest._version,
          eventVersion: savedEvent._version,
        })
        .expect(403);

      expect(res.body.error).toMatch(/approver/i);
    });

    it('rejects forcePublishEdit from approver (admin-only)', async () => {
      const { savedEvent, editRequest } = await seedPendingRequestOnEvent();

      const res = await request(app)
        .put(`/api/edit-requests/${editRequest._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          forcePublishEdit: true,
          editRequestVersion: editRequest._version,
          eventVersion: savedEvent._version,
        })
        .expect(403);

      expect(res.body.error).toMatch(/admin/i);
    });
  });

  describe('state guards', () => {
    it('rejects approval of a non-pending request', async () => {
      const { savedEvent, editRequest } = await seedPendingRequestOnEvent();

      // First approval succeeds
      await request(app)
        .put(`/api/edit-requests/${editRequest._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          editRequestVersion: editRequest._version,
          eventVersion: savedEvent._version,
        })
        .expect(200);

      // Second approval rejected as non-pending
      const res = await request(app)
        .put(`/api/edit-requests/${editRequest._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          editRequestVersion: editRequest._version + 1,
          eventVersion: savedEvent._version + 1,
        })
        .expect(400);

      expect(res.body.error).toMatch(/only pending/i);
    });

    it('returns 404 for a missing request', async () => {
      const fakeId = '000000000000000000000000';
      const res = await request(app)
        .put(`/api/edit-requests/${fakeId}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          editRequestVersion: 1,
          eventVersion: 1,
        })
        .expect(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  describe('approval email — location name resolution', () => {
    const HEX24 = /[a-f0-9]{24}/i;
    let sanctuary;
    let greenwald;
    let emailSpy;

    beforeEach(async () => {
      await db.collection(COLLECTIONS.LOCATIONS).deleteMany({});
      sanctuary = { _id: new ObjectId(), name: 'Sanctuary', displayName: 'Sanctuary', isReservable: true, active: true };
      greenwald = { _id: new ObjectId(), name: 'Greenwald Hall', displayName: 'Greenwald Hall', isReservable: true, active: true };
      await db.collection(COLLECTIONS.LOCATIONS).insertMany([sanctuary, greenwald]);

      emailSpy = jest
        .spyOn(emailService, 'sendEditRequestApprovedNotification')
        .mockResolvedValue({ success: true });
    });

    afterEach(() => {
      emailSpy.mockRestore();
    });

    it('renders Room(s) display names — not ObjectIds — in the approval email changes', async () => {
      // Original event has only the Sanctuary; the edit adds Greenwald Hall.
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        locations: [sanctuary._id],
        locationDisplayNames: ['Sanctuary'],
      });
      const [savedEvent] = await insertEvents(db, [published]);

      const editRequest = await insertEditRequest(db, createPendingEditRequest({
        eventId: savedEvent.eventId,
        eventObjectId: savedEvent._id,
        userId: requesterUser.odataId,
        requestedBy: { userId: requesterUser.odataId, email: requesterUser.email, name: requesterUser.email },
        // Mirrors the real bug report: the request carries both requestedRooms
        // and locations as raw ObjectId strings.
        proposedChanges: {
          requestedRooms: [sanctuary._id.toString(), greenwald._id.toString()],
          locations: [sanctuary._id.toString(), greenwald._id.toString()],
        },
      }));

      await request(app)
        .put(`/api/edit-requests/${editRequest._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          editRequestVersion: editRequest._version,
          eventVersion: savedEvent._version,
        })
        .expect(200);

      // Approval email is a post-response, fire-and-forget side effect.
      await new Promise((r) => setTimeout(r, 600));

      expect(emailSpy).toHaveBeenCalledTimes(1);
      const reviewChanges = emailSpy.mock.calls[0][2];
      expect(Array.isArray(reviewChanges)).toBe(true);

      // The room change is present, labeled with the friendly field name.
      const roomRow = reviewChanges.find((c) => c.displayName === 'Room(s)');
      expect(roomRow).toBeDefined();
      expect(String(roomRow.newValue)).toContain('Greenwald Hall');
      expect(String(roomRow.newValue)).toContain('Sanctuary');

      // No raw ObjectId hex strings should leak into any rendered value, and
      // the redundant internal `requestedRooms` key must not surface as a label.
      for (const c of reviewChanges) {
        expect(c.displayName).not.toBe('requestedRooms');
        expect(c.displayName).not.toBe('locations');
        expect(String(c.oldValue ?? '')).not.toMatch(HEX24);
        expect(String(c.newValue ?? '')).not.toMatch(HEX24);
      }
    });
  });

  describe('cross-scope independence', () => {
    it('approving a per-occurrence request does not affect a co-pending request for a different occurrenceDate', async () => {
      // Different occurrenceDate values are independent slots; one approval
      // does not touch the other. (Cross-scope auto-supersede where a
      // series-level approval would cancel co-pending occurrence edits is
      // deferred to Phase 2 — tested separately when implemented.)
      // Occurrence-scoped requests only make sense on a series master (the
      // approval pre-flight refuses anything else), so seed a real one.
      const published = seriesMaster();
      const [savedEvent] = await insertEvents(db, [published]);

      const [reqMar17, reqMar24] = await insertEditRequests(db, [
        createPendingEditRequest({
          eventId: savedEvent.eventId,
          eventObjectId: savedEvent._id,
          userId: requesterUser.odataId,
          requestedBy: { userId: requesterUser.odataId, email: requesterUser.email, name: requesterUser.email },
          proposedChanges: { eventTitle: 'Mar 17 update' },
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-17',
        }),
        createPendingEditRequest({
          eventId: savedEvent.eventId,
          eventObjectId: savedEvent._id,
          userId: requesterUser.odataId,
          requestedBy: { userId: requesterUser.odataId, email: requesterUser.email, name: requesterUser.email },
          proposedChanges: { eventTitle: 'Mar 24 update' },
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-24',
        }),
      ]);

      await request(app)
        .put(`/api/edit-requests/${reqMar17._id}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          editRequestVersion: reqMar17._version,
          eventVersion: savedEvent._version,
        })
        .expect(200);

      const mar24After = await db
        .collection(COLLECTIONS.EDIT_REQUESTS)
        .findOne({ _id: reqMar24._id });
      expect(mar24After.status).toBe('pending');
    });
  });
});
