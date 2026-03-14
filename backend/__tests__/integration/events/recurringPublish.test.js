/**
 * Recurring Event Publish Tests (RP-1 to RP-12)
 *
 * Tests that recurring events are properly published with recurrence data
 * sent to the Graph API, including type mapping, date alignment,
 * firstDayOfWeek cleanup, and exclusion/addition sync.
 */

const request = require('supertest');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const {
  createRequester,
  createApprover,
  createAdmin,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createDraftEvent,
  createRecurringSeriesMaster,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Recurring Event Publish Tests (RP-1 to RP-12)', () => {
  let mongoServer, mongoClient, db, app;
  let requesterUser, approverUser, adminUser;
  let requesterToken, approverToken, adminToken;

  const weeklyRecurrence = {
    pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
    range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-06-30' },
    additions: [],
    exclusions: ['2026-04-07'],
  };

  beforeAll(async () => {
    await initTestKeys();
    mongoServer = await MongoMemoryServer.create(getServerOptions());
    const uri = mongoServer.getUri();
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    db = mongoClient.db('testdb');

    await db.createCollection(COLLECTIONS.USERS);
    await db.createCollection(COLLECTIONS.EVENTS);
    await db.createCollection(COLLECTIONS.LOCATIONS);
    await db.createCollection(COLLECTIONS.AUDIT_HISTORY);

    setTestDatabase(db);
    app = createTestApp();
  });

  afterAll(async () => {
    if (mongoClient) await mongoClient.close();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    graphApiMock.resetMocks();

    requesterUser = createRequester();
    approverUser = createApprover();
    adminUser = createAdmin();
    await insertUsers(db, [requesterUser, approverUser, adminUser]);

    requesterToken = await createMockToken(requesterUser);
    approverToken = await createMockToken(approverUser);
    adminToken = await createMockToken(adminUser);
  });

  describe('RP-1: Publish pending recurring event includes recurrence in Graph API', () => {
    it('should send recurrence to Graph API createCalendarEvent', async () => {
      const event = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Weekly Team Meeting',
        recurrence: weeklyRecurrence,
        eventType: 'seriesMaster',
      });
      const [saved] = await insertEvents(db, [event]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify Graph API was called with recurrence
      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls.length).toBe(1);
      expect(graphCalls[0].eventData.recurrence).toBeDefined();
      expect(graphCalls[0].eventData.recurrence.pattern.type).toBe('weekly');
      expect(graphCalls[0].eventData.recurrence.pattern.daysOfWeek).toEqual(['tuesday']);
      expect(graphCalls[0].eventData.recurrence.range.type).toBe('endDate');
      expect(graphCalls[0].eventData.recurrence.range.endDate).toBe('2026-06-30');
    });
  });

  describe('RP-2: Publish sets eventType to seriesMaster', () => {
    it('should set eventType in MongoDB after publish', async () => {
      const event = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Daily Standup',
        recurrence: {
          pattern: { type: 'daily', interval: 1 },
          range: { type: 'noEnd', startDate: '2026-03-10' },
        },
      });
      const [saved] = await insertEvents(db, [event]);

      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(updated.eventType).toBe('seriesMaster');
    });
  });

  describe('RP-3: Publish non-recurring event does not include recurrence', () => {
    it('should not send recurrence to Graph API for non-recurring event', async () => {
      const event = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'One-Time Meeting',
      });
      const [saved] = await insertEvents(db, [event]);

      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls.length).toBe(1);
      expect(graphCalls[0].eventData.recurrence).toBeUndefined();
    });
  });

  describe('RP-4: Draft auto-publish includes recurrence', () => {
    it('should send recurrence when admin submits recurring draft', async () => {
      const draft = createDraftEvent({
        userId: adminUser.odataId,
        requesterEmail: adminUser.email,
        eventTitle: 'Admin Recurring Draft',
        recurrence: weeklyRecurrence,
        eventType: 'seriesMaster',
      });
      const [saved] = await insertEvents(db, [draft]);

      const res = await request(app)
        .post(`/api/room-reservations/draft/${saved._id}/submit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.autoPublished).toBe(true);

      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls.length).toBe(1);
      expect(graphCalls[0].eventData.recurrence).toBeDefined();
      expect(graphCalls[0].eventData.recurrence.pattern.type).toBe('weekly');
    });
  });

  describe('RP-5: Publish with numbered range', () => {
    it('should pass numberOfOccurrences to Graph API', async () => {
      const event = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Numbered Recurring',
        recurrence: {
          pattern: { type: 'monthly', interval: 1 },
          range: { type: 'numbered', startDate: '2026-03-10', numberOfOccurrences: 12 },
        },
      });
      const [saved] = await insertEvents(db, [event]);

      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls[0].eventData.recurrence.pattern.type).toBe('absoluteMonthly');
      expect(graphCalls[0].eventData.recurrence.range.type).toBe('numbered');
      expect(graphCalls[0].eventData.recurrence.range.numberOfOccurrences).toBe(12);
    });
  });

  describe('RP-7: Monthly recurrence sends absoluteMonthly to Graph', () => {
    it('should map monthly to absoluteMonthly in Graph API call', async () => {
      const event = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Monthly Board Meeting',
        recurrence: {
          pattern: { type: 'monthly', interval: 1 },
          range: { type: 'endDate', startDate: '2026-03-15', endDate: '2026-12-15' },
        },
      });
      const [saved] = await insertEvents(db, [event]);

      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls[0].eventData.recurrence.pattern.type).toBe('absoluteMonthly');
    });
  });

  describe('RP-8: Yearly recurrence sends absoluteYearly to Graph', () => {
    it('should map yearly to absoluteYearly in Graph API call', async () => {
      const event = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Annual Gala',
        recurrence: {
          pattern: { type: 'yearly', interval: 1 },
          range: { type: 'endDate', startDate: '2026-03-15', endDate: '2030-03-15' },
        },
      });
      const [saved] = await insertEvents(db, [event]);

      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls[0].eventData.recurrence.pattern.type).toBe('absoluteYearly');
    });
  });

  describe('RP-9: start.dateTime aligns with range.startDate for recurring events', () => {
    it('should overwrite start/end date portion with range.startDate', async () => {
      // Event created on Wednesday 3/12, but recurrence starts Tuesday 3/17
      const event = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Tuesday Recurring',
        startDateTime: new Date('2026-03-12T14:00:00'),
        endDateTime: new Date('2026-03-12T15:00:00'),
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
          range: { type: 'endDate', startDate: '2026-03-17', endDate: '2026-06-30' },
        },
      });
      const [saved] = await insertEvents(db, [event]);

      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      // start.dateTime date portion should match range.startDate (2026-03-17), not original (2026-03-12)
      expect(graphCalls[0].eventData.start.dateTime).toMatch(/^2026-03-17T14:00:00/);
      expect(graphCalls[0].eventData.end.dateTime).toMatch(/^2026-03-17T15:00:00/);
    });
  });

  describe('RP-10: firstDayOfWeek stripped for non-weekly patterns', () => {
    it('should not include firstDayOfWeek for monthly pattern', async () => {
      const event = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Monthly with firstDayOfWeek',
        recurrence: {
          pattern: { type: 'monthly', interval: 1, firstDayOfWeek: 'sunday' },
          range: { type: 'endDate', startDate: '2026-03-15', endDate: '2026-12-15' },
        },
      });
      const [saved] = await insertEvents(db, [event]);

      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls[0].eventData.recurrence.pattern.firstDayOfWeek).toBeUndefined();
    });
  });

  describe('RP-11: Exclusions trigger deleteCalendarEvent after publish', () => {
    it('should cancel excluded occurrences in Graph', async () => {
      const exclusionDate = '2026-04-07';
      const mockOccurrenceId = 'mock-occurrence-id-0407';
      // Set up mock to return an instance for the exclusion date
      graphApiMock.setMockResponse('getRecurringEventInstances', [
        { id: mockOccurrenceId, start: { dateTime: `${exclusionDate}T14:00:00` }, end: { dateTime: `${exclusionDate}T15:00:00` } }
      ]);

      const event = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Weekly with Exclusion',
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
          range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-06-30' },
          exclusions: [exclusionDate],
          additions: [],
        },
      });
      const [saved] = await insertEvents(db, [event]);

      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      // Verify deleteCalendarEvent was called for the exclusion
      const deleteCalls = graphApiMock.getCallHistory('deleteCalendarEvent');
      expect(deleteCalls.length).toBe(1);
      expect(deleteCalls[0].eventId).toBe(mockOccurrenceId);

      // Verify cancelledOccurrences stored in MongoDB
      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(updated.graphData.cancelledOccurrences).toEqual(
        expect.arrayContaining([expect.objectContaining({ date: exclusionDate, graphId: mockOccurrenceId })])
      );
    });
  });

  describe('RP-12: Additions trigger createCalendarEvent for single-instance events', () => {
    it('should create standalone events for addition dates', async () => {
      const additionDate = '2026-04-09';
      const event = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Weekly with Addition',
        startDateTime: new Date('2026-03-10T14:00:00'),
        endDateTime: new Date('2026-03-10T15:00:00'),
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
          range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-06-30' },
          exclusions: [],
          additions: [additionDate],
        },
      });
      const [saved] = await insertEvents(db, [event]);

      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      // createCalendarEvent called twice: once for series, once for addition
      const createCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(createCalls.length).toBe(2);

      // Second call should be the addition event
      const additionCall = createCalls[1];
      expect(additionCall.eventData.subject).toBe('Weekly with Addition');
      expect(additionCall.eventData.start.dateTime).toMatch(new RegExp(`^${additionDate}T`));
      expect(additionCall.eventData.recurrence).toBeUndefined();

      // Verify exceptionEventIds stored in MongoDB
      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(updated.exceptionEventIds).toEqual(
        expect.arrayContaining([expect.objectContaining({ date: additionDate })])
      );
    });
  });

  describe('RP-6: Publish with malformed recurrence falls back gracefully', () => {
    it('should publish without recurrence when pattern/range missing', async () => {
      const event = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Bad Recurrence',
        recurrence: { pattern: null, range: null },
      });
      const [saved] = await insertEvents(db, [event]);

      const res = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      expect(res.body.success).toBe(true);

      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls[0].eventData.recurrence).toBeUndefined();
    });
  });

  // --- Draft occurrence override field tests (RP-7 to RP-10) ---

  describe('RP-7: Draft occurrence override saves location change', () => {
    it('should persist locations and locationDisplayNames in occurrenceOverrides', async () => {
      // Create a location in the DB
      const locationId = new (require('mongodb').ObjectId)();
      await db.collection(COLLECTIONS.LOCATIONS).insertOne({
        _id: locationId,
        displayName: 'Chapel',
        name: 'Chapel',
        isReservable: true,
      });

      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Weekly Chapel Service',
        recurrence: weeklyRecurrence,
        eventType: 'seriesMaster',
      });
      const [saved] = await insertEvents(db, [draft]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_DRAFT(saved._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-17',
          requestedRooms: [locationId.toString()],
        })
        .expect(200);

      const overrides = res.body.occurrenceOverrides;
      expect(overrides).toHaveLength(1);
      expect(overrides[0].occurrenceDate).toBe('2026-03-17');
      expect(overrides[0].locations).toHaveLength(1);
      expect(overrides[0].locations[0].toString()).toBe(locationId.toString());
      expect(overrides[0].locationDisplayNames).toBe('Chapel');
    });
  });

  describe('RP-8: Draft occurrence override saves setup/teardown/door times', () => {
    it('should persist timing fields in occurrenceOverrides', async () => {
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Weekly Setup Test',
        recurrence: weeklyRecurrence,
        eventType: 'seriesMaster',
      });
      const [saved] = await insertEvents(db, [draft]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_DRAFT(saved._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-17',
          setupTime: '08:30',
          teardownTime: '17:30',
          doorOpenTime: '09:00',
          doorCloseTime: '17:00',
        })
        .expect(200);

      const override = res.body.occurrenceOverrides[0];
      expect(override.setupTime).toBe('08:30');
      expect(override.teardownTime).toBe('17:30');
      expect(override.doorOpenTime).toBe('09:00');
      expect(override.doorCloseTime).toBe('17:00');
    });
  });

  describe('RP-9: Draft occurrence override saves categories', () => {
    it('should persist categories in occurrenceOverrides', async () => {
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Weekly Category Test',
        recurrence: weeklyRecurrence,
        eventType: 'seriesMaster',
      });
      const [saved] = await insertEvents(db, [draft]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_DRAFT(saved._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-17',
          categories: ['Special Service', 'Holiday'],
        })
        .expect(200);

      const override = res.body.occurrenceOverrides[0];
      expect(override.categories).toEqual(['Special Service', 'Holiday']);
    });
  });

  describe('RP-10: Draft occurrence override saves services and offsite fields', () => {
    it('should persist services and offsite fields in occurrenceOverrides', async () => {
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Weekly Services Test',
        recurrence: weeklyRecurrence,
        eventType: 'seriesMaster',
      });
      const [saved] = await insertEvents(db, [draft]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_DRAFT(saved._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-17',
          services: ['Catering', 'AV Setup'],
          isOffsite: true,
          offsiteName: 'Central Park',
          offsiteAddress: '59th St, New York, NY',
        })
        .expect(200);

      const override = res.body.occurrenceOverrides[0];
      expect(override.services).toEqual(['Catering', 'AV Setup']);
      expect(override.isOffsite).toBe(true);
      expect(override.offsiteName).toBe('Central Park');
      expect(override.offsiteAddress).toBe('59th St, New York, NY');
    });
  });

  describe('RP-11: Draft occurrence override clears locations', () => {
    it('should set locations to empty array when requestedRooms is empty', async () => {
      const draft = createDraftEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Weekly Clear Location Test',
        recurrence: weeklyRecurrence,
        eventType: 'seriesMaster',
      });
      const [saved] = await insertEvents(db, [draft]);

      const res = await request(app)
        .put(ENDPOINTS.UPDATE_DRAFT(saved._id))
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-17',
          requestedRooms: [],
        })
        .expect(200);

      const override = res.body.occurrenceOverrides[0];
      expect(override.locations).toEqual([]);
      expect(override.locationDisplayNames).toBe('');
    });
  });

  // --- Graph payload tests for categories & locations ---

  describe('RP-13: Publish sends categories in Graph payload', () => {
    it('should include categories array in Graph API createCalendarEvent', async () => {
      const event = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Categorized Event',
        categories: ['Religious Services', 'Community'],
      });
      const [saved] = await insertEvents(db, [event]);

      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls[0].eventData.categories).toEqual(['Religious Services', 'Community']);
    });
  });

  describe('RP-14: Publish sends locations array to Graph', () => {
    it('should include locations array with individual displayNames', async () => {
      const event = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Multi-Room Event',
        locationDisplayNames: 'Chapel; Social Hall',
      });
      const [saved] = await insertEvents(db, [event]);

      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls[0].eventData.location.displayName).toBe('Chapel; Social Hall');
      expect(graphCalls[0].eventData.locations).toEqual([
        { displayName: 'Chapel', locationType: 'default' },
        { displayName: 'Social Hall', locationType: 'default' },
      ]);
    });
  });

  describe('RP-15: Publish handles array locationDisplayNames', () => {
    it('should join array locationDisplayNames with semicolons', async () => {
      const event = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Array Location Event',
        locationDisplayNames: ['Chapel', 'Social Hall'],
      });
      const [saved] = await insertEvents(db, [event]);

      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      const graphCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(graphCalls[0].eventData.location.displayName).toBe('Chapel; Social Hall');
      expect(graphCalls[0].eventData.locations).toHaveLength(2);
    });
  });

  describe('RP-16: Occurrence override syncs categories to Graph', () => {
    it('should PATCH Graph occurrence with categories when admin edits published series', async () => {
      const occurrenceDate = '2026-03-17';
      const mockOccId = 'mock-occ-id-categories';
      graphApiMock.setMockResponse('getRecurringEventInstances', [
        { id: mockOccId, start: { dateTime: `${occurrenceDate}T14:00:00` }, end: { dateTime: `${occurrenceDate}T15:00:00` } }
      ]);

      const event = createRecurringSeriesMaster({
        userId: adminUser.odataId,
        requesterEmail: adminUser.email,
        eventTitle: 'Weekly Service',
        status: 'published',
        recurrence: weeklyRecurrence,
        calendarOwner: 'templeeventssandbox@emanuelnyc.org',
        graphData: {
          id: 'graph-series-master-id',
          iCalUId: 'ical-series-master',
          start: { timeZone: 'America/New_York' },
          end: { timeZone: 'America/New_York' },
        },
      });
      const [saved] = await insertEvents(db, [event]);

      await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate,
          categories: ['Special Service', 'Holiday'],
          _version: saved._version,
        })
        .expect(200);

      const updateCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
      const occUpdate = updateCalls.find(c => c.eventId === mockOccId);
      expect(occUpdate).toBeDefined();
      expect(occUpdate.eventData.categories).toEqual(['Special Service', 'Holiday']);
    });
  });

  describe('RP-17: Occurrence override syncs location to Graph', () => {
    it('should PATCH Graph occurrence with location when admin edits published series', async () => {
      const occurrenceDate = '2026-03-17';
      const mockOccId = 'mock-occ-id-location';
      graphApiMock.setMockResponse('getRecurringEventInstances', [
        { id: mockOccId, start: { dateTime: `${occurrenceDate}T14:00:00` }, end: { dateTime: `${occurrenceDate}T15:00:00` } }
      ]);

      const locationId = new (require('mongodb').ObjectId)();
      await db.collection(COLLECTIONS.LOCATIONS).insertOne({
        _id: locationId,
        displayName: 'Sanctuary',
        name: 'Sanctuary',
        isReservable: true,
      });

      const event = createRecurringSeriesMaster({
        userId: adminUser.odataId,
        requesterEmail: adminUser.email,
        eventTitle: 'Weekly Service',
        status: 'published',
        recurrence: weeklyRecurrence,
        calendarOwner: 'templeeventssandbox@emanuelnyc.org',
        graphData: {
          id: 'graph-series-master-id-2',
          iCalUId: 'ical-series-master-2',
          start: { timeZone: 'America/New_York' },
          end: { timeZone: 'America/New_York' },
        },
      });
      const [saved] = await insertEvents(db, [event]);

      await request(app)
        .put(ENDPOINTS.UPDATE_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate,
          requestedRooms: [locationId.toString()],
          _version: saved._version,
        })
        .expect(200);

      const updateCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      const occUpdate = updateCalls.find(c => c.eventId === mockOccId);
      expect(occUpdate).toBeDefined();
      expect(occUpdate.eventData.location.displayName).toBe('Sanctuary');
      expect(occUpdate.eventData.locations).toEqual([
        { displayName: 'Sanctuary', locationType: 'default' },
      ]);
    });
  });

  describe('RP-18: Publish syncs occurrenceOverrides to Graph', () => {
    it('should PATCH Graph occurrences with override categories after publish', async () => {
      const occurrenceDate = '2026-03-17';
      const mockOccId = 'mock-occ-override-id';
      graphApiMock.setMockResponse('getRecurringEventInstances', [
        { id: mockOccId, start: { dateTime: `${occurrenceDate}T14:00:00` }, end: { dateTime: `${occurrenceDate}T15:00:00` } }
      ]);

      // Use recurrence WITHOUT exclusions to avoid mock response being consumed
      const cleanRecurrence = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-06-30' },
        additions: [],
        exclusions: [],
      };

      const event = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Weekly with Overrides',
        recurrence: cleanRecurrence,
        eventType: 'seriesMaster',
        occurrenceOverrides: [
          {
            occurrenceDate,
            categories: ['Override Category'],
            locationDisplayNames: 'Override Room',
          },
        ],
      });
      const [saved] = await insertEvents(db, [event]);

      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      // First call is createCalendarEvent (series), then getRecurringEventInstances + updateCalendarEvent for override
      const updateCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
      const overrideUpdate = updateCalls.find(c => c.eventId === mockOccId);
      expect(overrideUpdate).toBeDefined();
      expect(overrideUpdate.eventData.categories).toEqual(['Override Category']);
      expect(overrideUpdate.eventData.location.displayName).toBe('Override Room');
      expect(overrideUpdate.eventData.locations).toEqual([
        { displayName: 'Override Room', locationType: 'default' },
      ]);
    });
  });
});
