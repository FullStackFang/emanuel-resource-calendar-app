/**
 * Recurring Event Publish Tests (RP-1 to RP-12)
 *
 * Tests that recurring events are properly published with recurrence data
 * sent to the Graph API, including type mapping, date alignment,
 * firstDayOfWeek cleanup, and exclusion/addition sync.
 */

const request = require('supertest');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
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
  let mongoClient, db, app;
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
    ({ db, client: mongoClient } = await connectToGlobalServer('recurringPublish'));

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

  describe('RP-19: Addition date with occurrence override applies override at creation', () => {
    it('should create addition event with override location instead of series default', async () => {
      const additionDate = '2026-04-14';

      const recurrenceWithAddition = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-06-30' },
        additions: [additionDate],
        exclusions: [],
      };

      const event = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Series with Addition Override',
        recurrence: recurrenceWithAddition,
        eventType: 'seriesMaster',
        occurrenceOverrides: [
          {
            occurrenceDate: additionDate,
            categories: ['Special Addition'],
            locationDisplayNames: '66th Street Lobby',
          },
        ],
      });
      const [saved] = await insertEvents(db, [event]);

      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      // The addition createCalendarEvent call should have override data baked in
      const createCalls = graphApiMock.getCallHistory('createCalendarEvent');
      // First call = series master, second call = addition event
      expect(createCalls.length).toBe(2);
      const additionCall = createCalls[1];
      expect(additionCall.eventData.categories).toEqual(['Special Addition']);
      expect(additionCall.eventData.location.displayName).toBe('66th Street Lobby');
      expect(additionCall.eventData.locations).toEqual([
        { displayName: '66th Street Lobby', locationType: 'default' },
      ]);

      // The override sync may also PATCH the addition via additionEventIds fast-path
      // (redundant but harmless). The key assertion is that createCalendarEvent
      // already had the override data baked in at creation time above.
    });
  });

  describe('RP-20: Regular occurrence override uses startsWith matching', () => {
    it('should PATCH a regular series occurrence with override data', async () => {
      const occurrenceDate = '2026-03-17';
      const mockOccId = 'mock-occ-startswith-test';
      graphApiMock.setMockResponse('getRecurringEventInstances', [
        { id: mockOccId, start: { dateTime: `${occurrenceDate}T14:00:00` }, end: { dateTime: `${occurrenceDate}T15:00:00` } }
      ]);

      const cleanRecurrence = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-06-30' },
        additions: [],
        exclusions: [],
      };

      const event = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Series Override startsWith',
        recurrence: cleanRecurrence,
        eventType: 'seriesMaster',
        occurrenceOverrides: [
          {
            occurrenceDate,
            locationDisplayNames: 'Chapel',
          },
        ],
      });
      const [saved] = await insertEvents(db, [event]);

      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      const updateCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      const overrideUpdate = updateCalls.find(c => c.eventId === mockOccId);
      expect(overrideUpdate).toBeDefined();
      expect(overrideUpdate.eventData.location.displayName).toBe('Chapel');
    });
  });

  describe('RP-21: Addition without override uses series master defaults', () => {
    it('should create addition event with series defaults when no override exists', async () => {
      const additionDate = '2026-04-14';

      const recurrenceWithAddition = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-06-30' },
        additions: [additionDate],
        exclusions: [],
      };

      const event = createPendingEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Series No Override Addition',
        recurrence: recurrenceWithAddition,
        eventType: 'seriesMaster',
        // No occurrenceOverrides for the addition date
        occurrenceOverrides: [],
      });
      const [saved] = await insertEvents(db, [event]);

      await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      const createCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(createCalls.length).toBe(2); // series master + addition
      const additionCall = createCalls[1];
      // Should use series master defaults (categories from event, not overridden)
      expect(additionCall.eventData.subject).toBe('Series No Override Addition');
      // No override location applied
      expect(additionCall.eventData.locations).toBeUndefined();
    });
  });

  describe('RP-22: Draft auto-publish applies override to addition', () => {
    it('should create addition event with override data on draft auto-publish', async () => {
      const additionDate = '2026-04-14';

      const draftRecurrence = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-06-30' },
        additions: [additionDate],
        exclusions: [],
      };

      const draft = createDraftEvent({
        userId: adminUser.odataId,
        requesterEmail: adminUser.email,
        eventTitle: 'Draft with Addition Override',
        recurrence: draftRecurrence,
        eventType: 'seriesMaster',
        occurrenceOverrides: [
          {
            occurrenceDate: additionDate,
            categories: ['Draft Override Cat'],
            locationDisplayNames: 'Greenwald Hall',
          },
        ],
      });
      const [saved] = await insertEvents(db, [draft]);

      await request(app)
        .post(ENDPOINTS.SUBMIT_DRAFT(saved._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ _version: saved._version })
        .expect(200);

      const createCalls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(createCalls.length).toBe(2); // series master + addition
      const additionCall = createCalls[1];
      expect(additionCall.eventData.categories).toEqual(['Draft Override Cat']);
      expect(additionCall.eventData.location.displayName).toBe('Greenwald Hall');
    });
  });

  describe('RP-23: Admin save on seriesMaster preserves eventType and recurring metadata', () => {
    it('should not overwrite eventType, occurrenceOverrides, or exceptionEventIds on admin save', async () => {
      // Create a published seriesMaster with occurrenceOverrides and exceptionEventIds
      const recurrence = {
        pattern: { type: 'daily', interval: 1, firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-18', endDate: '2026-03-20' },
        additions: ['2026-03-21'],
        exclusions: ['2026-03-19'],
      };
      const master = createRecurringSeriesMaster({
        status: 'published',
        recurrence,
        graphData: { id: 'graph-master-rp23', subject: 'Original Title' },
        occurrenceOverrides: [
          { occurrenceDate: '2026-03-20', startTime: '12:00', endTime: '13:00', eventTitle: 'Override Title' },
        ],
        exceptionEventIds: [
          { date: '2026-03-21', graphId: 'graph-addition-rp23' },
        ],
        owner: adminUser,
      });
      const [saved] = await insertEvents(db, [master]);

      // Admin edits the title — frontend would send eventType: null (or singleInstance in old code)
      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Updated Title',
          eventType: 'singleInstance', // BUG: frontend used to send this
          _version: saved._version,
        })
        .expect(200);

      const updated = res.body.event;

      // eventType must remain seriesMaster (protected by backend)
      expect(updated.eventType).toBe('seriesMaster');

      // occurrenceOverrides must still exist (not wiped)
      expect(updated.occurrenceOverrides).toHaveLength(1);
      expect(updated.occurrenceOverrides[0].occurrenceDate).toBe('2026-03-20');
      // Override had independent title ('Override Title' != master's old title) — preserved, not cascaded
      expect(updated.occurrenceOverrides[0].eventTitle).toBe('Override Title');
      // Time should remain from original override (not changed in this edit)
      expect(updated.occurrenceOverrides[0].startTime).toBe('12:00');
      expect(updated.occurrenceOverrides[0].endTime).toBe('13:00');

      // exceptionEventIds must be untouched
      expect(updated.exceptionEventIds).toHaveLength(1);
      expect(updated.exceptionEventIds[0].date).toBe('2026-03-21');

      // recurrence must be preserved (additions + exclusions)
      const savedRecurrence = updated.calendarData?.recurrence || updated.recurrence;
      expect(savedRecurrence.additions).toEqual(['2026-03-21']);
      expect(savedRecurrence.exclusions).toEqual(['2026-03-19']);

      // Title should actually update
      expect(updated.calendarData?.eventTitle || updated.eventTitle).toBe('Updated Title');
    });
  });

  describe('RP-24: Admin save syncs recurrence to calendarData', () => {
    it('should write recurrence to both top-level and calendarData when updated', async () => {
      const master = createRecurringSeriesMaster({
        status: 'published',
        graphData: { id: 'graph-master-rp24', subject: 'Recurrence Sync Test' },
        owner: adminUser,
      });
      const [saved] = await insertEvents(db, [master]);

      const newRecurrence = {
        pattern: { type: 'daily', interval: 1, firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-04-01', endDate: '2026-04-05' },
        additions: ['2026-04-07'],
        exclusions: ['2026-04-03'],
      };

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          recurrence: newRecurrence,
          _version: saved._version,
        })
        .expect(200);

      const updated = res.body.event;

      // Both top-level and calendarData.recurrence should have the new value
      expect(updated.recurrence).toEqual(newRecurrence);
      expect(updated.calendarData.recurrence).toEqual(newRecurrence);

      // eventType should remain seriesMaster
      expect(updated.eventType).toBe('seriesMaster');
    });
  });

  describe('RP-25: Admin save resolves time from separate startDate/startTime fields for Graph sync', () => {
    it('should use combined date+time fields in Graph update when startDateTime is not sent', async () => {
      const master = createRecurringSeriesMaster({
        status: 'published',
        graphData: { id: 'graph-master-rp25', subject: 'Time Resolve Test' },
        owner: adminUser,
        calendarData: {
          startDateTime: '2026-03-18T09:00:00',
          endDateTime: '2026-03-18T10:00:00',
          startDate: '2026-03-18',
          startTime: '09:00',
          endDate: '2026-03-18',
          endTime: '10:00',
        },
      });
      const [saved] = await insertEvents(db, [master]);

      graphApiMock.clearCallHistory();

      // Frontend sends separate date/time fields, NOT startDateTime
      await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          startDate: '2026-03-18',
          startTime: '13:00',
          endDate: '2026-03-18',
          endTime: '14:00',
          _version: saved._version,
        })
        .expect(200);

      // Verify Graph was called with the resolved combined datetime
      const updateCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
      const masterCall = updateCalls[0];
      expect(masterCall.eventData.startDateTime).toBe('2026-03-18T13:00:00');
      expect(masterCall.eventData.endDateTime).toBe('2026-03-18T14:00:00');
    });
  });

  describe('RP-26: Admin save cascades title and time to addition events in Graph', () => {
    it('should update addition events via Graph when editing a seriesMaster', async () => {
      const master = createRecurringSeriesMaster({
        status: 'published',
        graphData: { id: 'graph-master-rp26', subject: 'Cascade Test' },
        exceptionEventIds: [
          { date: '2026-03-21', graphId: 'graph-addition-rp26' },
        ],
        owner: adminUser,
        calendarData: {
          startDateTime: '2026-03-18T09:00:00',
          endDateTime: '2026-03-18T10:00:00',
        },
      });
      const [saved] = await insertEvents(db, [master]);

      graphApiMock.clearCallHistory();

      await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Updated Cascade Title',
          startDate: '2026-03-18',
          startTime: '14:00',
          endDate: '2026-03-18',
          endTime: '15:00',
          _version: saved._version,
        })
        .expect(200);

      // Verify Graph was called for both master and addition
      const updateCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(updateCalls.length).toBeGreaterThanOrEqual(2);

      // First call: series master update
      const masterCall = updateCalls[0];
      expect(masterCall.eventData.subject).toBe('Updated Cascade Title');

      // Second call: addition event update with cascaded title and time
      const additionCall = updateCalls[1];
      expect(additionCall.eventId).toBe('graph-addition-rp26');
      expect(additionCall.eventData.subject).toBe('Updated Cascade Title');
      // Addition should use the new time-of-day with its own date (2026-03-21)
      expect(additionCall.eventData.startDateTime).toContain('2026-03-21T14:00');
      expect(additionCall.eventData.endDateTime).toContain('2026-03-21T15:00');
    });
  });

  describe('RP-27: Admin save on seriesMaster cascades changed fields into occurrenceOverrides', () => {
    it('should update override title, time, and location when master is edited', async () => {
      const { ObjectId } = require('mongodb');
      const oldLocationId = new ObjectId();
      const newLocationId = new ObjectId();

      const recurrence = {
        pattern: { type: 'daily', interval: 1, firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-18', endDate: '2026-03-20' },
      };
      // Override values MATCH master's old values (inherited) — cascade should update them
      const master = createRecurringSeriesMaster({
        status: 'published',
        eventTitle: 'Old Master Title',
        recurrence,
        graphData: { id: 'graph-master-rp27', subject: 'Override Cascade Test' },
        calendarData: {
          eventTitle: 'Old Master Title',
          eventDescription: '',
          startDateTime: '2026-03-18T12:00:00',
          endDateTime: '2026-03-18T13:00:00',
          startDate: '2026-03-18',
          startTime: '12:00',
          endDate: '2026-03-18',
          endTime: '13:00',
          categories: ['Old Category'],
          locations: [oldLocationId],
          locationDisplayNames: 'Old Room',
          services: [],
        },
        occurrenceOverrides: [
          {
            occurrenceDate: '2026-03-20',
            startTime: '12:00',
            endTime: '13:00',
            startDateTime: '2026-03-20T12:00',
            endDateTime: '2026-03-20T13:00',
            eventTitle: 'Old Master Title',
            locations: [oldLocationId],
            locationDisplayNames: 'Old Room',
            categories: ['Old Category'],
          },
        ],
        owner: adminUser,
      });
      const [saved] = await insertEvents(db, [master]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'New Master Title',
          startTime: '15:00',
          endTime: '16:00',
          locations: [newLocationId.toString()],
          locationDisplayNames: 'New Room',
          categories: ['New Category'],
          eventDescription: '',
          services: [],
          _version: saved._version,
        })
        .expect(200);

      const updated = res.body.event;

      // Override inherited from master (same values) — should be cascaded with the new values
      expect(updated.occurrenceOverrides).toHaveLength(1);
      const override = updated.occurrenceOverrides[0];
      expect(override.occurrenceDate).toBe('2026-03-20');
      expect(override.eventTitle).toBe('New Master Title');
      expect(override.startTime).toBe('15:00');
      expect(override.endTime).toBe('16:00');
      expect(override.startDateTime).toBe('2026-03-20T15:00');
      expect(override.endDateTime).toBe('2026-03-20T16:00');
      expect(override.locationDisplayNames).toBe('New Room');
      expect(override.categories).toEqual(['New Category']);
    });

    it('RP-28: should not overwrite exception overrides when frontend sends all fields unchanged', async () => {
      const { ObjectId } = require('mongodb');
      const masterLocationId = new ObjectId();

      const recurrence = {
        pattern: { type: 'daily', interval: 1, firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-18', endDate: '2026-03-20' },
      };

      // Create master with explicit calendarData so we control exact field values
      const master = createRecurringSeriesMaster({
        status: 'published',
        eventTitle: 'Weekly Standup',
        categories: ['Meeting'],
        eventDescription: 'Team standup',
        recurrence,
        graphData: { id: 'graph-master-rp28', subject: 'Weekly Standup' },
        calendarData: {
          eventTitle: 'Weekly Standup',
          eventDescription: 'Team standup',
          startDateTime: '2026-03-18T10:00:00',
          endDateTime: '2026-03-18T11:00:00',
          startDate: '2026-03-18',
          startTime: '10:00',
          endDate: '2026-03-18',
          endTime: '11:00',
          categories: ['Meeting'],
          locations: [masterLocationId],
          locationDisplayNames: 'Main Room',
          services: [],
          setupTime: null,
          teardownTime: null,
          doorOpenTime: null,
          doorCloseTime: null,
          setupTimeMinutes: 0,
          teardownTimeMinutes: 0,
        },
        occurrenceOverrides: [
          {
            occurrenceDate: '2026-03-20',
            eventTitle: 'Special Exception Title',
            startTime: '14:00',
            endTime: '15:00',
            startDateTime: '2026-03-20T14:00',
            endDateTime: '2026-03-20T15:00',
            categories: ['Special'],
            eventDescription: 'Special event description',
            locations: [masterLocationId],
            locationDisplayNames: 'Exception Room',
          },
        ],
        owner: adminUser,
      });
      const [saved] = await insertEvents(db, [master]);

      // Simulate frontend behavior: send ALL fields with current master values (no actual changes).
      // Locations sent as STRINGS (mimicking frontend) — must not trigger false positive cascade
      // against ObjectId values stored in calendarData.
      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Weekly Standup',
          startTime: '10:00',
          endTime: '11:00',
          startDate: '2026-03-18',
          endDate: '2026-03-18',
          startDateTime: '2026-03-18T10:00:00',
          endDateTime: '2026-03-18T11:00:00',
          categories: ['Meeting'],
          eventDescription: 'Team standup',
          locations: [masterLocationId.toString()],
          locationDisplayNames: 'Main Room',
          services: [],
          _version: saved._version,
        })
        .expect(200);

      const updated = res.body.event;
      expect(updated.occurrenceOverrides).toHaveLength(1);
      const override = updated.occurrenceOverrides[0];

      // ALL exception-specific values must be preserved — none should be overwritten by master values
      expect(override.eventTitle).toBe('Special Exception Title');
      expect(override.startTime).toBe('14:00');
      expect(override.endTime).toBe('15:00');
      expect(override.startDateTime).toBe('2026-03-20T14:00');
      expect(override.endDateTime).toBe('2026-03-20T15:00');
      expect(override.categories).toEqual(['Special']);
      expect(override.eventDescription).toBe('Special event description');
      expect(override.locationDisplayNames).toBe('Exception Room');
    });

    it('RP-29: allEvents edit with changed title preserves unchanged location overrides despite ObjectId type mismatch', async () => {
      const { ObjectId } = require('mongodb');
      const masterLocationId = new ObjectId();
      const overrideLocationId = new ObjectId();

      const recurrence = {
        pattern: { type: 'daily', interval: 1, firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-18', endDate: '2026-03-20' },
      };

      const master = createRecurringSeriesMaster({
        status: 'published',
        eventTitle: 'Original Title',
        recurrence,
        graphData: { id: 'graph-master-rp29', subject: 'Original Title' },
        calendarData: {
          eventTitle: 'Original Title',
          eventDescription: 'Some description',
          startDateTime: '2026-03-18T09:00:00',
          endDateTime: '2026-03-18T10:00:00',
          startDate: '2026-03-18',
          startTime: '09:00',
          endDate: '2026-03-18',
          endTime: '10:00',
          categories: ['General'],
          locations: [masterLocationId],
          locationDisplayNames: 'Master Room',
          services: [],
        },
        occurrenceOverrides: [
          {
            occurrenceDate: '2026-03-20',
            eventTitle: 'Original Title',  // same as master — should cascade
            startTime: '09:00',
            endTime: '10:00',
            startDateTime: '2026-03-20T09:00',
            endDateTime: '2026-03-20T10:00',
            locations: [overrideLocationId],  // different from master — independent, should NOT cascade
            locationDisplayNames: 'Override Room',
            categories: ['General'],
          },
        ],
        owner: adminUser,
      });
      const [saved] = await insertEvents(db, [master]);

      // Edit only the title. Send locations as STRINGS (mimicking frontend) — same as master.
      // The override has DIFFERENT locations that must be preserved.
      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'allEvents',
          eventTitle: 'Updated Series Title',
          locations: [masterLocationId.toString()],
          locationDisplayNames: 'Master Room',
          categories: ['General'],
          startTime: '09:00',
          endTime: '10:00',
          eventDescription: 'Some description',
          services: [],
          _version: saved._version,
        })
        .expect(200);

      const updated = res.body.event;
      expect(updated.occurrenceOverrides).toHaveLength(1);
      const override = updated.occurrenceOverrides[0];

      // Title SHOULD be cascaded (it changed)
      expect(override.eventTitle).toBe('Updated Series Title');

      // Locations should NOT be cascaded (master locations unchanged — string/ObjectId match)
      expect(override.locationDisplayNames).toBe('Override Room');
      // The override's locations array should still contain the override-specific location
      expect(override.locations.map(String)).toEqual([overrideLocationId.toString()]);

      // Time and categories should NOT be cascaded (unchanged)
      expect(override.startTime).toBe('09:00');
      expect(override.endTime).toBe('10:00');
      expect(override.categories).toEqual(['General']);
    });

    it('RP-30: should not crash when services is an empty object {}', async () => {
      const recurrence = {
        pattern: { type: 'daily', interval: 1, firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-18', endDate: '2026-03-20' },
      };

      // Production stores services as {} (empty object), not [] (empty array)
      const master = createRecurringSeriesMaster({
        status: 'published',
        eventTitle: 'Service Object Test',
        recurrence,
        graphData: { id: 'graph-master-rp30', subject: 'Service Object Test' },
        calendarData: {
          eventTitle: 'Service Object Test',
          eventDescription: 'Testing services as object',
          startDateTime: '2026-03-18T10:00:00',
          endDateTime: '2026-03-18T11:00:00',
          startDate: '2026-03-18',
          startTime: '10:00',
          endDate: '2026-03-18',
          endTime: '11:00',
          categories: ['General'],
          locations: [],
          locationDisplayNames: '',
          services: {},  // ← production data shape: empty object, NOT array
        },
        occurrenceOverrides: [
          {
            occurrenceDate: '2026-03-20',
            eventTitle: 'Service Object Test',  // same as master — should cascade
            startTime: '10:00',
            endTime: '11:00',
            startDateTime: '2026-03-20T10:00',
            endDateTime: '2026-03-20T11:00',
          },
        ],
        owner: adminUser,
      });
      const [saved] = await insertEvents(db, [master]);

      // Change only the title, send services as {} (matching production frontend behavior)
      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'allEvents',
          eventTitle: 'Updated Service Object Test',
          services: {},  // ← frontend sends back the same empty object
          _version: saved._version,
        })
        .expect(200);

      const updated = res.body.event;
      expect(updated.eventTitle).toBe('Updated Service Object Test');
      expect(updated.occurrenceOverrides).toHaveLength(1);

      // Title cascaded (override inherited master's old title), override preserved
      const override = updated.occurrenceOverrides[0];
      expect(override.eventTitle).toBe('Updated Service Object Test');
    });

    it('should preserve override fields that were NOT changed in the master edit', async () => {
      const recurrence = {
        pattern: { type: 'daily', interval: 1, firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-18', endDate: '2026-03-20' },
      };
      const master = createRecurringSeriesMaster({
        status: 'published',
        eventTitle: 'Partial Cascade Test',
        recurrence,
        graphData: { id: 'graph-master-rp27b', subject: 'Partial Cascade Test' },
        calendarData: {
          eventTitle: 'Partial Cascade Test',
          eventDescription: '',
          startDateTime: '2026-03-18T09:00:00',
          endDateTime: '2026-03-18T10:00:00',
          startDate: '2026-03-18',
          startTime: '09:00',
          endDate: '2026-03-18',
          endTime: '10:00',
          categories: ['General'],
          locations: [],
          locationDisplayNames: '',
          services: [],
        },
        occurrenceOverrides: [
          {
            occurrenceDate: '2026-03-20',
            startTime: '12:00',         // independent (differs from master 09:00)
            endTime: '13:00',           // independent (differs from master 10:00)
            eventTitle: 'Partial Cascade Test',  // inherited from master — will cascade
            locationDisplayNames: 'Custom Room', // independent (differs from master '')
          },
        ],
        owner: adminUser,
      });
      const [saved] = await insertEvents(db, [master]);

      // Only change the title — location and time should be preserved from override
      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventTitle: 'Updated Title Only',
          _version: saved._version,
        })
        .expect(200);

      const updated = res.body.event;
      const override = updated.occurrenceOverrides[0];
      expect(override.eventTitle).toBe('Updated Title Only');
      // These should remain unchanged — independent override values, not cascaded
      expect(override.startTime).toBe('12:00');
      expect(override.endTime).toBe('13:00');
      expect(override.locationDisplayNames).toBe('Custom Room');
    });

    it('RP-31: should not false-cascade when stored calendarData has undefined fields', async () => {
      const recurrence = {
        pattern: { type: 'daily', interval: 1, firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-18', endDate: '2026-03-20' },
      };
      const master = createRecurringSeriesMaster({
        status: 'published',
        eventTitle: 'Undefined Fields Test',
        recurrence,
        graphData: { id: 'graph-master-rp31', subject: 'Undefined Fields Test' },
        occurrenceOverrides: [
          {
            occurrenceDate: '2026-03-20',
            startTime: '14:00',            // independent (differs from master)
            endTime: '15:00',              // independent (differs from master)
            eventTitle: 'Undefined Fields Test',  // inherited from master — will cascade
            locationDisplayNames: 'Override Room', // independent
          },
        ],
        owner: adminUser,
      });

      // Deliberately remove fields from calendarData to simulate older documents
      // that don't have services, eventDescription, or locationDisplayNames stored
      delete master.calendarData.services;
      delete master.calendarData.eventDescription;
      delete master.calendarData.locationDisplayNames;

      const [saved] = await insertEvents(db, [master]);

      // Edit only the title with allEvents scope — nothing else should cascade
      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'allEvents',
          eventTitle: 'RP-31 Title Change',
          services: {},  // frontend sends default empty object
          eventDescription: '',  // frontend sends empty string
          _version: saved._version,
        })
        .expect(200);

      const updated = res.body.event;
      expect(updated.occurrenceOverrides).toHaveLength(1);

      const override = updated.occurrenceOverrides[0];
      // Title should cascade (it actually changed)
      expect(override.eventTitle).toBe('RP-31 Title Change');
      // These override values must NOT be overwritten — the master fields didn't change,
      // the stored side was just undefined (older doc)
      expect(override.startTime).toBe('14:00');
      expect(override.endTime).toBe('15:00');
      expect(override.locationDisplayNames).toBe('Override Room');
    });

    it('RP-CASCADE-1: edit series master location -> override with independent location is preserved', async () => {
      const { ObjectId } = require('mongodb');
      const masterLocationId = new ObjectId();
      const newMasterLocationId = new ObjectId();
      const overrideLocationId = new ObjectId();

      const recurrence = {
        pattern: { type: 'daily', interval: 1, firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-18', endDate: '2026-03-20' },
      };

      const master = createRecurringSeriesMaster({
        status: 'published',
        eventTitle: 'Cascade Location Test',
        recurrence,
        graphData: { id: 'graph-cascade-1', subject: 'Cascade Location Test' },
        calendarData: {
          eventTitle: 'Cascade Location Test',
          eventDescription: '',
          startDateTime: '2026-03-18T09:00:00',
          endDateTime: '2026-03-18T10:00:00',
          startDate: '2026-03-18',
          startTime: '09:00',
          endDate: '2026-03-18',
          endTime: '10:00',
          categories: ['General'],
          locations: [masterLocationId],
          locationDisplayNames: '65th Street Lobby',
          services: [],
        },
        occurrenceOverrides: [
          {
            occurrenceDate: '2026-03-20',
            eventTitle: 'Cascade Location Test',
            startTime: '09:00',
            endTime: '10:00',
            startDateTime: '2026-03-20T09:00',
            endDateTime: '2026-03-20T10:00',
            locations: [overrideLocationId],
            locationDisplayNames: '66th St., 4th Floor Conference Room',
            categories: ['General'],
          },
        ],
        owner: adminUser,
      });
      const [saved] = await insertEvents(db, [master]);

      // Change master location from '65th Street Lobby' to 'Beth-El Chapel'
      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'allEvents',
          eventTitle: 'Cascade Location Test',
          locations: [newMasterLocationId.toString()],
          locationDisplayNames: 'Beth-El Chapel',
          categories: ['General'],
          startTime: '09:00',
          endTime: '10:00',
          eventDescription: '',
          services: [],
          _version: saved._version,
        })
        .expect(200);

      const updated = res.body.event;
      expect(updated.occurrenceOverrides).toHaveLength(1);
      const override = updated.occurrenceOverrides[0];

      // Master location changed, but override had its own independent location — must be preserved
      expect(override.locationDisplayNames).toBe('66th St., 4th Floor Conference Room');
      expect(override.locations.map(String)).toEqual([overrideLocationId.toString()]);
    });

    it('RP-CASCADE-2: edit series master location -> override that inherited master location IS updated', async () => {
      const { ObjectId } = require('mongodb');
      const masterLocationId = new ObjectId();
      const newMasterLocationId = new ObjectId();

      const recurrence = {
        pattern: { type: 'daily', interval: 1, firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-18', endDate: '2026-03-20' },
      };

      const master = createRecurringSeriesMaster({
        status: 'published',
        eventTitle: 'Cascade Inherit Test',
        recurrence,
        graphData: { id: 'graph-cascade-2', subject: 'Cascade Inherit Test' },
        calendarData: {
          eventTitle: 'Cascade Inherit Test',
          eventDescription: '',
          startDateTime: '2026-03-18T09:00:00',
          endDateTime: '2026-03-18T10:00:00',
          startDate: '2026-03-18',
          startTime: '09:00',
          endDate: '2026-03-18',
          endTime: '10:00',
          categories: ['General'],
          locations: [masterLocationId],
          locationDisplayNames: '65th Street Lobby',
          services: [],
        },
        occurrenceOverrides: [
          {
            occurrenceDate: '2026-03-20',
            eventTitle: 'Cascade Inherit Test',
            startTime: '09:00',
            endTime: '10:00',
            startDateTime: '2026-03-20T09:00',
            endDateTime: '2026-03-20T10:00',
            // Override has SAME location as master — should inherit cascade
            locations: [masterLocationId],
            locationDisplayNames: '65th Street Lobby',
            categories: ['General'],
          },
        ],
        owner: adminUser,
      });
      const [saved] = await insertEvents(db, [master]);

      // Change master location
      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'allEvents',
          eventTitle: 'Cascade Inherit Test',
          locations: [newMasterLocationId.toString()],
          locationDisplayNames: 'Beth-El Chapel',
          categories: ['General'],
          startTime: '09:00',
          endTime: '10:00',
          eventDescription: '',
          services: [],
          _version: saved._version,
        })
        .expect(200);

      const updated = res.body.event;
      const override = updated.occurrenceOverrides[0];

      // Override had same location as master (inherited) — should be updated to new location
      expect(override.locationDisplayNames).toBe('Beth-El Chapel');
      expect(override.locations.map(String)).toEqual([newMasterLocationId.toString()]);
    });

    it('RP-CASCADE-3: edit series master title -> override with independent title is preserved', async () => {
      const recurrence = {
        pattern: { type: 'daily', interval: 1, firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-18', endDate: '2026-03-20' },
      };

      const master = createRecurringSeriesMaster({
        status: 'published',
        eventTitle: 'Original Master Title',
        recurrence,
        graphData: { id: 'graph-cascade-3', subject: 'Original Master Title' },
        calendarData: {
          eventTitle: 'Original Master Title',
          eventDescription: '',
          startDateTime: '2026-03-18T09:00:00',
          endDateTime: '2026-03-18T10:00:00',
          startDate: '2026-03-18',
          startTime: '09:00',
          endDate: '2026-03-18',
          endTime: '10:00',
          categories: ['General'],
          locations: [],
          locationDisplayNames: '',
          services: [],
        },
        occurrenceOverrides: [
          {
            occurrenceDate: '2026-03-20',
            eventTitle: 'Special Guest Speaker',
            startTime: '09:00',
            endTime: '10:00',
            startDateTime: '2026-03-20T09:00',
            endDateTime: '2026-03-20T10:00',
            categories: ['General'],
          },
        ],
        owner: adminUser,
      });
      const [saved] = await insertEvents(db, [master]);

      // Change master title
      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'allEvents',
          eventTitle: 'New Master Title',
          startTime: '09:00',
          endTime: '10:00',
          eventDescription: '',
          services: [],
          _version: saved._version,
        })
        .expect(200);

      const updated = res.body.event;
      const override = updated.occurrenceOverrides[0];

      // Override had independent title — must be preserved
      expect(override.eventTitle).toBe('Special Guest Speaker');
      // Master title should be updated
      expect(updated.eventTitle).toBe('New Master Title');
    });

    it('RP-CASCADE-4: edit series master time -> override with independent time is preserved', async () => {
      const recurrence = {
        pattern: { type: 'daily', interval: 1, firstDayOfWeek: 'sunday' },
        range: { type: 'endDate', startDate: '2026-03-18', endDate: '2026-03-20' },
      };

      const master = createRecurringSeriesMaster({
        status: 'published',
        eventTitle: 'Time Cascade Test',
        recurrence,
        graphData: { id: 'graph-cascade-4', subject: 'Time Cascade Test' },
        calendarData: {
          eventTitle: 'Time Cascade Test',
          eventDescription: '',
          startDateTime: '2026-03-18T09:00:00',
          endDateTime: '2026-03-18T10:00:00',
          startDate: '2026-03-18',
          startTime: '09:00',
          endDate: '2026-03-18',
          endTime: '10:00',
          categories: ['General'],
          locations: [],
          locationDisplayNames: '',
          services: [],
        },
        occurrenceOverrides: [
          {
            occurrenceDate: '2026-03-20',
            eventTitle: 'Time Cascade Test',
            startTime: '14:00',
            endTime: '16:00',
            startDateTime: '2026-03-20T14:00',
            endDateTime: '2026-03-20T16:00',
            categories: ['General'],
          },
        ],
        owner: adminUser,
      });
      const [saved] = await insertEvents(db, [master]);

      // Change master time from 09:00-10:00 to 11:00-12:00
      const res = await request(app)
        .put(`/api/admin/events/${saved._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          editScope: 'allEvents',
          eventTitle: 'Time Cascade Test',
          startTime: '11:00',
          endTime: '12:00',
          eventDescription: '',
          services: [],
          _version: saved._version,
        })
        .expect(200);

      const updated = res.body.event;
      const override = updated.occurrenceOverrides[0];

      // Override had independent time (14:00-16:00) — must be preserved
      expect(override.startTime).toBe('14:00');
      expect(override.endTime).toBe('16:00');
      expect(override.startDateTime).toBe('2026-03-20T14:00');
      expect(override.endDateTime).toBe('2026-03-20T16:00');
    });
  });
});
