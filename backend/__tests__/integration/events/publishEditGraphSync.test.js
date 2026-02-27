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

describe('Publish-Edit Graph Sync Tests (PEG-1 to PEG-5)', () => {
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
      expect(graphCalls[0].eventData.eventDescription).toBe('Requester proposed description');

      // Verify MongoDB has the merged values
      const updatedEvent = await findEvent(db, event._id.toString());
      expect(updatedEvent.eventTitle).toBe('Approver Override Title');
    });
  });
});
