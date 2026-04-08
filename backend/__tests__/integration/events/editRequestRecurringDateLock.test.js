/**
 * Edit Request Recurring Date Lock Tests (ERDL-1 to ERDL-5)
 *
 * Validates that edit requests on recurring series masters cannot change
 * the date portion of startDateTime/endDateTime. Time-only changes and
 * non-date field changes are still permitted.
 *
 * This prevents a data inconsistency where calendarData.startDateTime
 * diverges from recurrence.range.startDate after approval.
 */

const request = require('supertest');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createRecurringSeriesMaster,
  createPublishedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');
const { extractDatePart } = require('../../../utils/dateUtils');

describe('Edit Request Recurring Date Lock (ERDL-1 to ERDL-5)', () => {
  let mongoClient;
  let db;
  let app;
  let requesterUser;
  let requesterToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('editRequestRecurringDateLock'));
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
    await insertUsers(db, [requesterUser]);
    requesterToken = await createMockToken(requesterUser);
  });

  /**
   * Helper: create a published recurring series master owned by requesterUser
   */
  function createPublishedSeriesMaster(overrides = {}) {
    return createRecurringSeriesMaster({
      status: STATUS.PUBLISHED,
      publishedAt: new Date(),
      publishedBy: 'approver@emanuelnyc.org',
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      requesterName: requesterUser.displayName,
      ...overrides,
    });
  }

  // ERDL-1: Rejects edit request that changes startDate on a series master
  it('ERDL-1: should reject edit request that changes startDate on a series master', async () => {
    const seriesMaster = createPublishedSeriesMaster();
    const [saved] = await insertEvents(db, [seriesMaster]);

    const originalStartTime = saved.calendarData.startTime || '10:00';

    const res = await request(app)
      .post(`/api/events/${saved._id}/request-edit`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({
        proposedChanges: {
          startDateTime: `2026-05-15T${originalStartTime}:00`, // Different date
        },
        _version: saved._version,
      })
      .expect(400);

    expect(res.body.error).toMatch(/date changes are not allowed/i);
  });

  // ERDL-2: Rejects edit request that changes endDate on a series master
  it('ERDL-2: should reject edit request that changes endDate on a series master', async () => {
    const seriesMaster = createPublishedSeriesMaster();
    const [saved] = await insertEvents(db, [seriesMaster]);

    const originalEndTime = saved.calendarData.endTime || '11:00';

    const res = await request(app)
      .post(`/api/events/${saved._id}/request-edit`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({
        proposedChanges: {
          endDateTime: `2026-05-20T${originalEndTime}:00`, // Different date
        },
        _version: saved._version,
      })
      .expect(400);

    expect(res.body.error).toMatch(/date changes are not allowed/i);
  });

  // ERDL-3: Allows edit request that changes only time on a series master
  it('ERDL-3: should allow edit request that changes only time on a series master', async () => {
    const seriesMaster = createPublishedSeriesMaster();
    const [saved] = await insertEvents(db, [seriesMaster]);

    // Extract date from startDateTime (authoritative), not startDate (can differ due to UTC)
    const originalStartDate = extractDatePart(saved.calendarData.startDateTime);
    const originalEndDate = extractDatePart(saved.calendarData.endDateTime);

    const res = await request(app)
      .post(`/api/events/${saved._id}/request-edit`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({
        proposedChanges: {
          startDateTime: `${originalStartDate}T14:00:00`, // Same date, different time
          endDateTime: `${originalEndDate}T15:30:00`,     // Same date, different time
        },
        _version: saved._version,
      })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.event.pendingEditRequest.proposedChanges.startDateTime).toContain('T14:00');
  });

  // ERDL-4: Allows edit request that changes non-date fields on a series master
  it('ERDL-4: should allow edit request that changes non-date fields on a series master', async () => {
    const seriesMaster = createPublishedSeriesMaster();
    const [saved] = await insertEvents(db, [seriesMaster]);

    const res = await request(app)
      .post(`/api/events/${saved._id}/request-edit`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({
        proposedChanges: {
          eventTitle: 'Updated Recurring Event Title',
        },
        _version: saved._version,
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.event.pendingEditRequest.proposedChanges.eventTitle).toBe('Updated Recurring Event Title');
  });

  // ERDL-5: Allows date changes in edit requests for non-recurring events (regression guard)
  it('ERDL-5: should allow date changes in edit requests for non-recurring events', async () => {
    const singleEvent = createPublishedEvent({
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      requesterName: requesterUser.displayName,
    });
    const [saved] = await insertEvents(db, [singleEvent]);

    const res = await request(app)
      .post(`/api/events/${saved._id}/request-edit`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({
        proposedChanges: {
          startDateTime: '2026-06-01T10:00:00',
          endDateTime: '2026-06-01T11:00:00',
        },
        _version: saved._version,
      })
      .expect(200);

    expect(res.body.success).toBe(true);
  });
});
