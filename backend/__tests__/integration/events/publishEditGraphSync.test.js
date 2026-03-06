/**
 * Publish-Edit Graph Sync Tests (PEG-1 to PEG-5)
 *
 * Tests that the publish-edit endpoint (approving an edit request on a published event)
 * correctly syncs changes to Graph API via graphApiService (app-only auth).
 */

const request = require('supertest');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { getServerOptions } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPublishedEventWithEditRequest,
  insertEvents,
  findEvent,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, TEST_CALENDAR_OWNER, TEST_CALENDAR_ID } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

describe('Publish-Edit Graph Sync Tests (PEG-1 to PEG-11)', () => {
  let mongoServer;
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;

  beforeAll(async () => {
    await initTestKeys();

    mongoServer = await MongoMemoryServer.create(getServerOptions());
    const uri = mongoServer.getUri();
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    db = mongoClient.db('testdb');

    await db.createCollection(COLLECTIONS.USERS);
    await db.createCollection(COLLECTIONS.EVENTS);
    await db.createCollection(COLLECTIONS.AUDIT_HISTORY);
    await db.createCollection(COLLECTIONS.LOCATIONS);

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
    await db.collection(COLLECTIONS.LOCATIONS).deleteMany({});

    graphApiMock.resetMocks();

    approverUser = createApprover();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, requesterUser]);

    approverToken = await createMockToken(approverUser);
  });

  // Helper: create a published event with graphData.id and a pending edit request
  function createGraphSyncedEventWithEditRequest(overrides = {}) {
    const graphId = overrides.graphId || 'AAMkAGraphPublishEdit123';
    return createPublishedEventWithEditRequest({
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      calendarOwner: TEST_CALENDAR_OWNER,
      calendarId: TEST_CALENDAR_ID,
      graphData: {
        id: graphId,
        iCalUId: `ical-${graphId}`,
        webLink: `https://outlook.office365.com/calendar/item/${graphId}`,
        changeKey: 'original-change-key',
        subject: 'Original Title',
        start: { dateTime: '2026-03-15T10:00:00', timeZone: 'America/New_York' },
        end: { dateTime: '2026-03-15T11:00:00', timeZone: 'America/New_York' },
        body: { contentType: 'text', content: 'Original description' },
        location: { displayName: 'Room A' },
        categories: ['Meeting'],
      },
      eventTitle: 'Original Title',
      ...overrides,
    });
  }

  describe('PEG-1: Publish-edit syncs changes to Graph API', () => {
    it('should call graphApiMock.updateCalendarEvent with correct args', async () => {
      const event = createGraphSyncedEventWithEditRequest({
        requestedChanges: { eventTitle: 'New Title From Edit' },
      });
      await insertEvents(db, [event]);

      const res = await request(app)
        .put(`/api/admin/events/${event._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ notes: 'Looks good' })
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify Graph API was called
      const graphCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(graphCalls).toHaveLength(1);
      expect(graphCalls[0].calendarOwner).toBe(TEST_CALENDAR_OWNER);
      expect(graphCalls[0].calendarId).toBe(TEST_CALENDAR_ID);
      expect(graphCalls[0].eventId).toBe('AAMkAGraphPublishEdit123');
      expect(graphCalls[0].eventData.subject).toBe('New Title From Edit');
    });
  });

  describe('PEG-2: Publish-edit merges Graph response back to graphData', () => {
    it('should merge the Graph API response into the event graphData', async () => {
      const event = createGraphSyncedEventWithEditRequest({
        requestedChanges: { eventTitle: 'Updated Via Edit Request' },
      });
      await insertEvents(db, [event]);

      await request(app)
        .put(`/api/admin/events/${event._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ notes: '' })
        .expect(200);

      // Read the event from DB directly to check graphData merge
      const updatedEvent = await findEvent(db, event._id.toString());
      expect(updatedEvent.graphData).toBeDefined();
      // The mock returns a changeKey - verify it was merged
      expect(updatedEvent.graphData.changeKey).toMatch(/^changeKey-/);
      // Original fields should be preserved
      expect(updatedEvent.graphData.iCalUId).toBe('ical-AAMkAGraphPublishEdit123');
      expect(updatedEvent.graphData.webLink).toContain('AAMkAGraphPublishEdit123');
    });
  });

  describe('PEG-3: Publish-edit succeeds even when Graph sync fails', () => {
    it('should approve the edit request even if Graph API throws', async () => {
      graphApiMock.setMockError('updateCalendarEvent', new Error('Graph API unavailable'));

      const event = createGraphSyncedEventWithEditRequest({
        requestedChanges: { eventTitle: 'Title Despite Graph Failure' },
      });
      await insertEvents(db, [event]);

      const res = await request(app)
        .put(`/api/admin/events/${event._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ notes: 'Approving anyway' })
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify the MongoDB changes were still applied
      const updatedEvent = await findEvent(db, event._id.toString());
      expect(updatedEvent.eventTitle).toBe('Title Despite Graph Failure');
      // pendingEditRequest should be marked as approved
      expect(updatedEvent.pendingEditRequest.status).toBe('approved');
    });
  });

  describe('PEG-4: Publish-edit skips Graph sync when no graphData.id', () => {
    it('should not call Graph API when event has no graphData.id', async () => {
      // Event without graphData (never published to Outlook)
      const event = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        calendarOwner: TEST_CALENDAR_OWNER,
        calendarId: TEST_CALENDAR_ID,
        eventTitle: 'Internal Only Event',
        requestedChanges: { eventTitle: 'Updated Internal Event' },
      });
      await insertEvents(db, [event]);

      const res = await request(app)
        .put(`/api/admin/events/${event._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ notes: '' })
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify Graph API was NOT called
      const graphCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(graphCalls).toHaveLength(0);

      // Changes should still be applied
      const updatedEvent = await findEvent(db, event._id.toString());
      expect(updatedEvent.eventTitle).toBe('Updated Internal Event');
    });
  });

  describe('PEG-5: Publish-edit with approverChanges syncs merged final changes', () => {
    it('should sync the merged final changes (proposed + approver overrides) to Graph', async () => {
      const event = createGraphSyncedEventWithEditRequest({
        requestedChanges: {
          eventTitle: 'Requester Proposed Title',
          eventDescription: 'Requester proposed description',
        },
      });
      await insertEvents(db, [event]);

      const res = await request(app)
        .put(`/api/admin/events/${event._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          notes: 'Modified title',
          approverChanges: { eventTitle: 'Approver Override Title' },
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify Graph API received the merged changes (approver override wins)
      const graphCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(graphCalls).toHaveLength(1);
      expect(graphCalls[0].eventData.subject).toBe('Approver Override Title');
      // Description from requester's proposed changes should also be present
      expect(graphCalls[0].eventData.body.content).toBe('Requester proposed description');

      // Verify MongoDB has the merged values
      const updatedEvent = await findEvent(db, event._id.toString());
      expect(updatedEvent.eventTitle).toBe('Approver Override Title');
    });
  });

  describe('PEG-6: Always sends start/end even when not in finalChanges', () => {
    it('should sync current start/end dates when only title changes', async () => {
      const event = createGraphSyncedEventWithEditRequest({
        requestedChanges: { eventTitle: 'Title Only Change' },
      });
      await insertEvents(db, [event]);

      await request(app)
        .put(`/api/admin/events/${event._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ notes: '' })
        .expect(200);

      const graphCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(graphCalls).toHaveLength(1);
      expect(graphCalls[0].eventData.subject).toBe('Title Only Change');
      // start/end should always be sent with fallback to existing values
      expect(graphCalls[0].eventData.startDateTime).toBeDefined();
      expect(graphCalls[0].eventData.endDateTime).toBeDefined();
    });
  });

  describe('PEG-7: Syncs location documents (ObjectIds resolved to displayNames)', () => {
    it('should resolve location ObjectIds and send displayNames to Graph', async () => {
      const { ObjectId } = require('mongodb');
      const locationId1 = new ObjectId();
      const locationId2 = new ObjectId();

      // Insert location documents
      await db.collection(COLLECTIONS.LOCATIONS).insertMany([
        { _id: locationId1, name: 'Main Sanctuary', displayName: 'Main Sanctuary', isReservable: true },
        { _id: locationId2, name: 'Social Hall', displayName: 'Social Hall', isReservable: true },
      ]);

      const event = createGraphSyncedEventWithEditRequest({
        requestedChanges: {
          locations: [locationId1.toString(), locationId2.toString()],
        },
      });
      await insertEvents(db, [event]);

      const res = await request(app)
        .put(`/api/admin/events/${event._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ notes: '' })
        .expect(200);

      expect(res.body.success).toBe(true);

      const graphCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(graphCalls).toHaveLength(1);
      // location.displayName should be semicolon-joined
      expect(graphCalls[0].eventData.location.displayName).toBe('Main Sanctuary; Social Hall');
      // locations array should have individual entries
      expect(graphCalls[0].eventData.locations).toHaveLength(2);
      expect(graphCalls[0].eventData.locations[0].displayName).toBe('Main Sanctuary');
      expect(graphCalls[0].eventData.locations[1].displayName).toBe('Social Hall');
    });
  });

  describe('PEG-8: Handles offsite locations', () => {
    it('should build offsite Graph location with name and address', async () => {
      const event = createGraphSyncedEventWithEditRequest({
        requestedChanges: {
          isOffsite: true,
          offsiteName: 'Central Park',
          offsiteAddress: '59th St, New York, NY',
        },
      });
      await insertEvents(db, [event]);

      const res = await request(app)
        .put(`/api/admin/events/${event._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ notes: '' })
        .expect(200);

      expect(res.body.success).toBe(true);

      const graphCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(graphCalls).toHaveLength(1);
      expect(graphCalls[0].eventData.location.displayName).toContain('Central Park');
      expect(graphCalls[0].eventData.location.displayName).toContain('Offsite');
      expect(graphCalls[0].eventData.locations).toHaveLength(1);
    });
  });

  describe('PEG-9: Handles clearing all locations', () => {
    it('should send Unspecified placeholder when locations are emptied', async () => {
      const event = createGraphSyncedEventWithEditRequest({
        requestedChanges: { locations: [] },
      });
      await insertEvents(db, [event]);

      const res = await request(app)
        .put(`/api/admin/events/${event._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ notes: '' })
        .expect(200);

      expect(res.body.success).toBe(true);

      const graphCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(graphCalls).toHaveLength(1);
      expect(graphCalls[0].eventData.location.displayName).toBe('Unspecified');
      expect(graphCalls[0].eventData.locations).toEqual([]);
    });
  });

  describe('PEG-10: Returns graphSynced flag', () => {
    it('should return graphSynced: true when Graph sync succeeds', async () => {
      const event = createGraphSyncedEventWithEditRequest({
        requestedChanges: { eventTitle: 'Synced Title' },
      });
      await insertEvents(db, [event]);

      const res = await request(app)
        .put(`/api/admin/events/${event._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ notes: '' })
        .expect(200);

      expect(res.body.graphSynced).toBe(true);
    });

    it('should return graphSynced: false when no graphData.id', async () => {
      const event = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        calendarOwner: TEST_CALENDAR_OWNER,
        calendarId: TEST_CALENDAR_ID,
        eventTitle: 'No Graph Event',
        requestedChanges: { eventTitle: 'Updated No Graph' },
      });
      await insertEvents(db, [event]);

      const res = await request(app)
        .put(`/api/admin/events/${event._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ notes: '' })
        .expect(200);

      expect(res.body.graphSynced).toBe(false);
    });
  });

  describe('PEG-11: Preserves existing Graph location when no location change', () => {
    it('should keep existing Graph location when edit only changes title', async () => {
      const event = createGraphSyncedEventWithEditRequest({
        requestedChanges: { eventTitle: 'New Title Only' },
        graphData: {
          id: 'AAMkAGraphPublishEdit123',
          iCalUId: 'ical-AAMkAGraphPublishEdit123',
          webLink: 'https://outlook.office365.com/calendar/item/AAMkAGraphPublishEdit123',
          changeKey: 'original-change-key',
          subject: 'Original Title',
          start: { dateTime: '2026-03-15T10:00:00', timeZone: 'America/New_York' },
          end: { dateTime: '2026-03-15T11:00:00', timeZone: 'America/New_York' },
          location: { displayName: 'Existing Room X', locationType: 'default' },
          locations: [{ displayName: 'Existing Room X', locationType: 'default' }],
          categories: ['Meeting'],
        },
      });
      await insertEvents(db, [event]);

      await request(app)
        .put(`/api/admin/events/${event._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ notes: '' })
        .expect(200);

      const graphCalls = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(graphCalls).toHaveLength(1);
      // Should preserve the existing location from graphData
      expect(graphCalls[0].eventData.location.displayName).toBe('Existing Room X');
      expect(graphCalls[0].eventData.locations).toHaveLength(1);
      expect(graphCalls[0].eventData.locations[0].displayName).toBe('Existing Room X');
    });
  });
});
