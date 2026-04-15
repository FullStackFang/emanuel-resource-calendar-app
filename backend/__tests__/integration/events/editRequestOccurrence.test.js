/**
 * Edit Request Occurrence Tests (ERO-1 to ERO-7)
 *
 * Validates that edit requests for single occurrences of recurring events
 * are scoped correctly: proposed changes are stored with editScope/occurrenceDate,
 * and approval writes to occurrenceOverrides (not calendarData on the series master).
 */

const request = require('supertest');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createRequester, createApprover, insertUsers } = require('../../__helpers__/userFactory');
const {
  createRecurringSeriesMaster,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');

describe('Edit Request Occurrence Tests (ERO-1 to ERO-7)', () => {
  let mongoClient;
  let db;
  let app;
  let requesterUser;
  let requesterToken;
  let approverUser;
  let approverToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('editRequestOccurrence'));
    setTestDatabase(db);
    app = createTestApp();
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});

    requesterUser = createRequester();
    approverUser = createApprover();
    await insertUsers(db, [requesterUser, approverUser]);
    requesterToken = await createMockToken(requesterUser);
    approverToken = await createMockToken(approverUser);
  });

  /**
   * Helper: create a published recurring series master owned by requesterUser.
   * Default recurrence: weekly on Tuesdays, 2026-03-10 to 2026-06-30.
   */
  function createPublishedSeriesMaster(overrides = {}) {
    return createRecurringSeriesMaster({
      status: STATUS.PUBLISHED,
      publishedAt: new Date(),
      publishedBy: approverUser.email,
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      requesterName: requesterUser.displayName,
      ...overrides,
    });
  }

  // ERO-1: Request edit for single occurrence stores scope in pendingEditRequest
  it('ERO-1: should store editScope, occurrenceDate, and seriesMasterId in pendingEditRequest', async () => {
    const seriesMaster = createPublishedSeriesMaster();
    const [saved] = await insertEvents(db, [seriesMaster]);

    const res = await request(app)
      .post(`/api/events/${saved._id}/request-edit`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({
        proposedChanges: { eventTitle: 'Special Tuesday Session' },
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-17',
        seriesMasterId: 'graph-series-master-123',
      });

    expect(res.status).toBe(200);

    const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
    expect(updated.pendingEditRequest).toBeDefined();
    expect(updated.pendingEditRequest.status).toBe('pending');
    expect(updated.pendingEditRequest.editScope).toBe('thisEvent');
    expect(updated.pendingEditRequest.occurrenceDate).toBe('2026-03-17');
    expect(updated.pendingEditRequest.seriesMasterId).toBe('graph-series-master-123');
    expect(updated.pendingEditRequest.proposedChanges.eventTitle).toBe('Special Tuesday Session');
  });

  // ERO-2: Approve occurrence-scoped edit writes to occurrenceOverrides, NOT calendarData
  it('ERO-2: should write approved changes to occurrenceOverrides, not calendarData', async () => {
    const originalTitle = 'Weekly Staff Meeting';
    const seriesMaster = createPublishedSeriesMaster({
      eventTitle: originalTitle,
    });
    // Pre-set a pending edit request with occurrence scope
    seriesMaster.pendingEditRequest = {
      id: 'edit-req-test-ero2',
      status: 'pending',
      editScope: 'thisEvent',
      occurrenceDate: '2026-03-17',
      seriesMasterId: null,
      requestedBy: {
        userId: requesterUser.odataId,
        email: requesterUser.email,
        name: requesterUser.displayName,
        department: '',
        phone: '',
        requestedAt: new Date(),
      },
      proposedChanges: { eventTitle: 'Special Guest Speaker' },
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: '',
    };
    const [saved] = await insertEvents(db, [seriesMaster]);

    const res = await request(app)
      .put(`/api/admin/events/${saved._id}/publish-edit`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ notes: 'Approved for this occurrence' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.occurrenceDate).toBe('2026-03-17');

    const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });

    // calendarData.eventTitle MUST remain unchanged (series title)
    expect(updated.calendarData.eventTitle).toBe(originalTitle);

    // occurrenceOverrides MUST contain the change
    const override = (updated.occurrenceOverrides || []).find(o => o.occurrenceDate === '2026-03-17');
    expect(override).toBeDefined();
    expect(override.eventTitle).toBe('Special Guest Speaker');

    // pendingEditRequest status should be 'approved'
    expect(updated.pendingEditRequest.status).toBe('approved');
    expect(updated.pendingEditRequest.reviewNotes).toBe('Approved for this occurrence');
  });

  // ERO-3: Approve series-level edit (no editScope) still applies to calendarData (backward compat)
  it('ERO-3: should apply series-level edit to calendarData when no editScope', async () => {
    const originalTitle = 'Weekly Staff Meeting';
    const newTitle = 'Bi-Weekly Staff Meeting';
    const seriesMaster = createPublishedSeriesMaster({
      eventTitle: originalTitle,
    });
    seriesMaster.pendingEditRequest = {
      id: 'edit-req-test-ero3',
      status: 'pending',
      // No editScope or occurrenceDate — series-level (backward compat)
      requestedBy: {
        userId: requesterUser.odataId,
        email: requesterUser.email,
        name: requesterUser.displayName,
        department: '',
        phone: '',
        requestedAt: new Date(),
      },
      proposedChanges: { eventTitle: newTitle },
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: '',
    };
    const [saved] = await insertEvents(db, [seriesMaster]);

    const res = await request(app)
      .put(`/api/admin/events/${saved._id}/publish-edit`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({});

    expect(res.status).toBe(200);

    const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });

    // calendarData.eventTitle MUST be updated (series-level apply)
    expect(updated.calendarData.eventTitle).toBe(newTitle);

    // occurrenceOverrides should NOT be affected
    expect(updated.occurrenceOverrides || []).toEqual(seriesMaster.occurrenceOverrides || []);
  });

  // ERO-4: Date changes allowed for single-occurrence edit requests
  it('ERO-4: should allow date changes when editScope is thisEvent', async () => {
    const seriesMaster = createPublishedSeriesMaster();
    const [saved] = await insertEvents(db, [seriesMaster]);

    const res = await request(app)
      .post(`/api/events/${saved._id}/request-edit`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({
        proposedChanges: {
          startDateTime: '2026-03-17T15:00:00', // Different time for this occurrence
          endDateTime: '2026-03-17T16:00:00',
        },
        editScope: 'thisEvent',
        occurrenceDate: '2026-03-17',
      });

    // Should succeed (not 400) because thisEvent exempts from date lock
    expect(res.status).toBe(200);
  });

  // ERO-5: Date changes still blocked for series-level edit requests on seriesMaster
  it('ERO-5: should block date changes when editScope is allEvents on seriesMaster', async () => {
    const seriesMaster = createPublishedSeriesMaster();
    const [saved] = await insertEvents(db, [seriesMaster]);

    const res = await request(app)
      .post(`/api/events/${saved._id}/request-edit`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({
        proposedChanges: {
          startDateTime: '2026-05-15T10:00:00', // Different DATE
        },
        editScope: 'allEvents',
        occurrenceDate: null,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/date changes are not allowed/i);
  });

  // ERO-6: Backward compat - no editScope defaults to series-level apply
  it('ERO-6: should default to series-level apply when no editScope in pendingEditRequest', async () => {
    const originalTitle = 'Weekly Meeting';
    const seriesMaster = createPublishedSeriesMaster({
      eventTitle: originalTitle,
    });
    // Simulate pre-fix edit request (no editScope field at all)
    seriesMaster.pendingEditRequest = {
      id: 'edit-req-test-ero6',
      status: 'pending',
      // No editScope, occurrenceDate, or seriesMasterId
      requestedBy: {
        userId: requesterUser.odataId,
        email: requesterUser.email,
        name: requesterUser.displayName,
        department: '',
        phone: '',
        requestedAt: new Date(),
      },
      proposedChanges: { eventTitle: 'Updated Series Title' },
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: '',
    };
    const [saved] = await insertEvents(db, [seriesMaster]);

    const res = await request(app)
      .put(`/api/admin/events/${saved._id}/publish-edit`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({});

    expect(res.status).toBe(200);

    const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
    // Changes should go to calendarData (series-level), not occurrenceOverrides
    expect(updated.calendarData.eventTitle).toBe('Updated Series Title');
  });

  // ERO-7: Occurrence override merged with existing overrides (preserves pre-existing fields)
  it('ERO-7: should merge approved changes with existing occurrence override', async () => {
    const seriesMaster = createPublishedSeriesMaster({
      eventTitle: 'Weekly Meeting',
    });
    // Pre-existing override for this date (e.g., categories were customized previously)
    seriesMaster.occurrenceOverrides = [
      { occurrenceDate: '2026-03-17', categories: ['Special Session'], eventNotes: 'Existing note' },
    ];
    // Pending edit request that changes only title for this occurrence
    seriesMaster.pendingEditRequest = {
      id: 'edit-req-test-ero7',
      status: 'pending',
      editScope: 'thisEvent',
      occurrenceDate: '2026-03-17',
      seriesMasterId: null,
      requestedBy: {
        userId: requesterUser.odataId,
        email: requesterUser.email,
        name: requesterUser.displayName,
        department: '',
        phone: '',
        requestedAt: new Date(),
      },
      proposedChanges: { eventTitle: 'Guest Speaker Session' },
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: '',
    };
    const [saved] = await insertEvents(db, [seriesMaster]);

    const res = await request(app)
      .put(`/api/admin/events/${saved._id}/publish-edit`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ notes: 'Looks good' });

    expect(res.status).toBe(200);

    const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
    const override = (updated.occurrenceOverrides || []).find(o => o.occurrenceDate === '2026-03-17');
    expect(override).toBeDefined();

    // New title from the edit request
    expect(override.eventTitle).toBe('Guest Speaker Session');
    // Pre-existing fields should be preserved (merged, not replaced)
    expect(override.categories).toEqual(['Special Session']);
    expect(override.eventNotes).toBe('Existing note');

    // Series master calendarData should remain unchanged
    expect(updated.calendarData.eventTitle).toBe('Weekly Meeting');
  });
});
