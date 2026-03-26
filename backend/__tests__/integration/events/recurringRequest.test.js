/**
 * Recurring Event Request Tests (RR-1 to RR-4)
 *
 * Tests that POST /api/events/request properly stores recurrence data
 * so that recurring events created via the requester path are not lost.
 */

const request = require('supertest');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createRequester,
  createAdmin,
  insertUsers,
} = require('../../__helpers__/userFactory');
const { insertEvents } = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, ENDPOINTS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Recurring Event Request Tests (RR-1 to RR-4)', () => {
  let mongoClient, db, app;
  let requesterUser, adminUser;
  let requesterToken, adminToken;

  const weeklyRecurrence = {
    pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'], firstDayOfWeek: 'sunday' },
    range: { type: 'endDate', startDate: '2026-04-01', endDate: '2026-06-30' },
    additions: [],
    exclusions: [],
  };

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('recurringRequest'));

    setTestDatabase(db);
    app = createTestApp();
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    graphApiMock.resetMocks();

    requesterUser = createRequester();
    adminUser = createAdmin();
    await insertUsers(db, [requesterUser, adminUser]);

    requesterToken = await createMockToken(requesterUser);
    adminToken = await createMockToken(adminUser);
  });

  describe('RR-1: Request with recurrence stores recurrence data', () => {
    it('should store recurrence in both top-level and calendarData', async () => {
      const res = await request(app)
        .post('/api/events/request')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Weekly Wednesday Meeting',
          startDateTime: '2026-04-01T10:00:00',
          endDateTime: '2026-04-01T11:00:00',
          locations: [],
          requesterName: requesterUser.name || 'Test Requester',
          requesterEmail: requesterUser.email,
          recurrence: weeklyRecurrence,
          attendeeCount: 10,
        })
        .expect(201);

      // Verify event was created
      const eventId = res.body.eventId;
      expect(eventId).toBeDefined();

      // Fetch from DB and verify recurrence is stored
      const saved = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId });
      expect(saved).toBeDefined();
      expect(saved.recurrence).toBeDefined();
      expect(saved.recurrence.pattern.type).toBe('weekly');
      expect(saved.recurrence.pattern.daysOfWeek).toEqual(['wednesday']);
      expect(saved.recurrence.range.endDate).toBe('2026-06-30');

      // Verify calendarData also has recurrence
      expect(saved.calendarData.recurrence).toBeDefined();
      expect(saved.calendarData.recurrence.pattern.type).toBe('weekly');
    });
  });

  describe('RR-2: Request with recurrence sets eventType to seriesMaster', () => {
    it('should set eventType to seriesMaster when recurrence has a pattern', async () => {
      const res = await request(app)
        .post('/api/events/request')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Daily Standup',
          startDateTime: '2026-04-01T09:00:00',
          endDateTime: '2026-04-01T09:15:00',
          locations: [],
          requesterName: requesterUser.name || 'Test Requester',
          requesterEmail: requesterUser.email,
          recurrence: {
            pattern: { type: 'daily', interval: 1 },
            range: { type: 'noEnd', startDate: '2026-04-01' },
          },
          attendeeCount: 10,
        })
        .expect(201);

      const saved = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: res.body.eventId });
      expect(saved.eventType).toBe('seriesMaster');
    });
  });

  describe('RR-3: Request without recurrence sets eventType to singleInstance', () => {
    it('should set eventType to singleInstance when no recurrence', async () => {
      const res = await request(app)
        .post('/api/events/request')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'One-Time Meeting',
          startDateTime: '2026-04-01T14:00:00',
          endDateTime: '2026-04-01T15:00:00',
          locations: [],
          requesterName: requesterUser.name || 'Test Requester',
          requesterEmail: requesterUser.email,
          attendeeCount: 10,
        })
        .expect(201);

      const saved = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: res.body.eventId });
      expect(saved.eventType).toBe('singleInstance');
      expect(saved.recurrence).toBeNull();
    });
  });

  describe('RR-4: Recurring request can be published with Graph recurrence', () => {
    it('should publish a requested recurring event with recurrence sent to Graph', async () => {
      // Step 1: Create recurring request via requester
      const createRes = await request(app)
        .post('/api/events/request')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'Weekly Review',
          startDateTime: '2026-04-01T15:00:00',
          endDateTime: '2026-04-01T16:00:00',
          locations: [],
          requesterName: requesterUser.name || 'Test Requester',
          requesterEmail: requesterUser.email,
          recurrence: weeklyRecurrence,
          attendeeCount: 10,
        })
        .expect(201);

      const saved = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: createRes.body.eventId });

      // Step 2: Admin publishes the event
      const publishRes = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      expect(publishRes.body.success).toBe(true);

      // Step 3: Verify Graph API was called with recurrence
      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls.length).toBe(1);
      expect(graphCalls[0].eventData.recurrence).toBeDefined();
      expect(graphCalls[0].eventData.recurrence.pattern.type).toBe('weekly');
      expect(graphCalls[0].eventData.recurrence.pattern.daysOfWeek).toEqual(['wednesday']);

      // Step 4: Verify MongoDB has eventType set
      const published = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(published.status).toBe('published');
      expect(published.eventType).toBe('seriesMaster');
    });
  });
});
