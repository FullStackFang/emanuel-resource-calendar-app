/**
 * Edit Request Tests — Recurrence (ER-R0 to ER-R5)
 *
 * Tests that the request-edit endpoint accepts recurrence changes,
 * blocks exclusion-removal (Q5=A), and allows bundled date moves (Q3=A).
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const { createRecurringSeriesMaster, insertEvents } = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');

describe('Edit Request Tests — Recurrence (ER-R0 to ER-R5)', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;
  let requesterToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('editRequestRecurrence'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    approverUser = createApprover();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, requesterUser]);

    approverToken = await createMockToken(approverUser);
    requesterToken = await createMockToken(requesterUser);
  });

  // Helper: build a published seriesMaster owned by requesterUser.
  function publishedSeriesMaster({ exclusions = [] } = {}) {
    return createRecurringSeriesMaster({
      status: STATUS.PUBLISHED,
      publishedAt: new Date(),
      publishedBy: approverUser.email,
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      requesterName: requesterUser.displayName,
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
        range: { type: 'noEnd', startDate: '2026-04-20' },
        exclusions,
        additions: [],
      },
    });
  }

  describe('ER-R1: submit recurrence change on seriesMaster with no children', () => {
    it('stores proposedChanges.recurrence and sets pendingEditRequest.status=pending', async () => {
      const event = publishedSeriesMaster();
      const [saved] = await insertEvents(db, [event]);

      const newRecurrence = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] },
        range: { type: 'noEnd', startDate: '2026-04-20' },
      };

      const res = await request(app)
        .post(`/api/events/${saved._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: event.calendarData.eventTitle,
          recurrence: newRecurrence,
          _version: event._version,
        });

      expect(res.status).toBe(201);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: event.eventId });
      expect(updated.pendingEditRequest).toBeDefined();
      expect(updated.pendingEditRequest.status).toBe('pending');
      expect(updated.pendingEditRequest.proposedChanges.recurrence).toEqual(newRecurrence);
    });

    it('does NOT include recurrence in proposedChanges when value is unchanged', async () => {
      const event = publishedSeriesMaster();
      const [saved] = await insertEvents(db, [event]);

      const sameRecurrence = JSON.parse(JSON.stringify(event.recurrence));

      const res = await request(app)
        .post(`/api/events/${saved._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'New Title',
          recurrence: sameRecurrence,
          _version: event._version,
        });

      expect(res.status).toBe(201);
      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: event.eventId });
      expect(updated.pendingEditRequest.proposedChanges.recurrence).toBeUndefined();
      expect(updated.pendingEditRequest.proposedChanges.eventTitle).toBe('New Title');
    });
  });

  describe('ER-R5: exclusion-removal blocked (Q5=A)', () => {
    it('returns 400 EXCLUSION_REMOVAL_NOT_SUPPORTED when new recurrence drops an exclusion', async () => {
      const event = publishedSeriesMaster({ exclusions: ['2026-04-27'] });
      const [saved] = await insertEvents(db, [event]);

      const recurrenceMinusExclusion = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
        range: { type: 'noEnd', startDate: '2026-04-20' },
        exclusions: [],
      };

      const res = await request(app)
        .post(`/api/events/${saved._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          recurrence: recurrenceMinusExclusion,
          _version: event._version,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('EXCLUSION_REMOVAL_NOT_SUPPORTED');
      expect(res.body.removedExclusions).toEqual(['2026-04-27']);
    });

    it('allows ADDING an exclusion (still allowed)', async () => {
      const event = publishedSeriesMaster({ exclusions: [] });
      const [saved] = await insertEvents(db, [event]);

      const recurrencePlusExclusion = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
        range: { type: 'noEnd', startDate: '2026-04-20' },
        exclusions: ['2026-05-04'],
      };

      const res = await request(app)
        .post(`/api/events/${saved._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          recurrence: recurrencePlusExclusion,
          _version: event._version,
        });

      expect(res.status).toBe(201);
    });
  });

  // Helper: build AND insert a published seriesMaster, returning the saved doc with _id.
  async function insertPublishedSeriesMaster({ exclusions = [] } = {}) {
    const event = publishedSeriesMaster({ exclusions });
    const [saved] = await insertEvents(db, [event]);
    return saved;
  }

  describe('ER-R0: replaces old date-change block — date moves are now allowed when bundled with recurrence (Q3=A)', () => {
    it('does NOT 400 when startDateTime change is implied by recurrence.range.startDate change', async () => {
      const event = publishedSeriesMaster();
      const [saved] = await insertEvents(db, [event]);

      const newRecurrence = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
        range: { type: 'noEnd', startDate: '2026-04-27' },
      };

      const res = await request(app)
        .post(`/api/events/${saved._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          recurrence: newRecurrence,
          _version: event._version,
        });

      expect(res.status).toBe(201);
    });

    it('still 400s for naked startDateTime change without recurrence (per-master date moves still blocked)', async () => {
      const event = publishedSeriesMaster();
      const [saved] = await insertEvents(db, [event]);

      const res = await request(app)
        .post(`/api/events/${saved._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          startDateTime: '2026-04-27T09:00:00',
          _version: event._version,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Date changes are not allowed/);
    });
  });

  describe('ER-R4: publish-edit applies recurrence to master', () => {
    it('updates event.recurrence and increments _version', async () => {
      const event = await insertPublishedSeriesMaster();
      const newRecurrence = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday', 'thursday'] },
        range: { type: 'noEnd', startDate: '2026-04-21' },
      };

      // Submit edit request
      await request(app)
        .post(`/api/events/${event._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ recurrence: newRecurrence, _version: event._version });

      const submitted = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: event.eventId });
      expect(submitted.pendingEditRequest.proposedChanges.recurrence).toEqual(newRecurrence);

      // Approver publishes
      const res = await request(app)
        .put(`/api/admin/events/${event._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ _version: submitted._version });

      expect(res.status).toBe(200);
      const published = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: event.eventId });
      expect(published.recurrence).toEqual(newRecurrence);
      expect(published.pendingEditRequest.status).toBe('approved');
    });
  });

  describe('ER-R6: range.startDate change derives master.startDateTime (Q3=A)', () => {
    it('publish-edit updates calendarData.startDateTime to match new range.startDate', async () => {
      const event = await insertPublishedSeriesMaster();
      const newRecurrence = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
        range: { type: 'noEnd', startDate: '2026-05-04' },
      };

      await request(app)
        .post(`/api/events/${event._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ recurrence: newRecurrence, _version: event._version });

      const submitted = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: event.eventId });

      const res = await request(app)
        .put(`/api/admin/events/${event._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ _version: submitted._version });

      expect(res.status).toBe(200);
      const published = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: event.eventId });
      expect(published.calendarData.startDateTime.startsWith('2026-05-04')).toBe(true);
      expect(published.calendarData.startDate).toBe('2026-05-04');
    });
  });

  describe('ER-R7: orphaned override docs are soft-deleted on pattern change (Q1=B)', () => {
    it('soft-deletes exception docs whose occurrenceDate is not in the new pattern', async () => {
      const event = await insertPublishedSeriesMaster();
      // Insert an exception doc on a Wednesday (NOT in the 'monday'-only pattern — dirty data).
      const exceptionDoc = {
        eventId: `${event.eventId}-exception-1`,
        seriesMasterId: event.eventId,
        seriesMasterEventId: event.eventId,
        occurrenceDate: '2026-04-22',
        eventType: 'exception',
        status: 'published',
        isDeleted: false,
        _version: 1,
        calendarOwner: event.calendarOwner,
        calendarId: event.calendarId,
        overrides: { eventTitle: 'Exception Title' },
      };
      await db.collection(COLLECTIONS.EVENTS).insertOne(exceptionDoc);

      // Submit a recurrence change. The new pattern is also 'monday'-only, so the exception
      // doc on Wednesday is still orphaned and should be cleaned up.
      const newRecurrence = {
        pattern: { type: 'weekly', interval: 2, daysOfWeek: ['monday'] },
        range: { type: 'noEnd', startDate: '2026-04-20' },
      };

      await request(app)
        .post(`/api/events/${event._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ recurrence: newRecurrence, _version: event._version });

      const submitted = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: event.eventId });

      const res = await request(app)
        .put(`/api/admin/events/${event._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ _version: submitted._version });

      expect(res.status).toBe(200);

      const cleanedException = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: exceptionDoc.eventId });
      expect(cleanedException.isDeleted).toBe(true);
      expect(cleanedException.status).toBe('deleted');
    });
  });
});
