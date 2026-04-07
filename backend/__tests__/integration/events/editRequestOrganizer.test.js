/**
 * Edit Request Organizer Tests (ERO-1 to ERO-7)
 *
 * Tests that organizer fields (organizerName, organizerPhone, organizerEmail)
 * are properly tracked and applied through the edit request pipeline.
 */

const request = require('supertest');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPublishedEvent,
  createPublishedEventWithEditRequest,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS } = require('../../__helpers__/testConstants');

describe('Edit Request Organizer Tests (ERO-1 to ERO-7)', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;
  let requesterToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('editRequestOrganizer'));
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

    approverUser = createApprover();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, requesterUser]);

    approverToken = await createMockToken(approverUser);
    requesterToken = await createMockToken(requesterUser);
  });

  describe('Request-edit: organizer change detection', () => {
    it('ERO-1: should store organizerName change in proposedChanges', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            name: 'Test Requester',
            email: requesterUser.email,
            department: 'General',
            phone: '555-1234',
          },
          organizer: {
            name: 'Original Organizer',
            phone: '555-0000',
            email: 'original@org.com',
          },
        },
      });
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .post(`/api/events/${saved._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          proposedChanges: { organizerName: 'New Organizer' },
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.pendingEditRequest.proposedChanges.organizerName).toBe('New Organizer');
    });

    it('ERO-2: should store organizerPhone change in proposedChanges', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            name: 'Test Requester',
            email: requesterUser.email,
            department: 'General',
            phone: '555-1234',
          },
          organizer: {
            name: 'Organizer',
            phone: '555-0000',
            email: 'org@org.com',
          },
        },
      });
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .post(`/api/events/${saved._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          proposedChanges: { organizerPhone: '555-9999' },
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.pendingEditRequest.proposedChanges.organizerPhone).toBe('555-9999');
    });

    it('ERO-3: should store organizerEmail change in proposedChanges', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            name: 'Test Requester',
            email: requesterUser.email,
            department: 'General',
            phone: '555-1234',
          },
          organizer: {
            name: 'Organizer',
            phone: '555-0000',
            email: 'original@org.com',
          },
        },
      });
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .post(`/api/events/${saved._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          proposedChanges: { organizerEmail: 'new@org.com' },
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.pendingEditRequest.proposedChanges.organizerEmail).toBe('new@org.com');
    });

    it('ERO-4: should not include unchanged organizer fields in proposedChanges', async () => {
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            name: 'Test Requester',
            email: requesterUser.email,
            department: 'General',
            phone: '555-1234',
          },
          organizer: {
            name: 'Same Organizer',
            phone: '555-0000',
            email: 'same@org.com',
          },
        },
      });
      const [saved] = await insertEvents(db, [published]);

      // Only change the title, not organizer
      const res = await request(app)
        .post(`/api/events/${saved._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          proposedChanges: { eventTitle: 'Updated Title' },
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.pendingEditRequest.proposedChanges.eventTitle).toBe('Updated Title');
      expect(res.body.event.pendingEditRequest.proposedChanges.organizerName).toBeUndefined();
      expect(res.body.event.pendingEditRequest.proposedChanges.organizerPhone).toBeUndefined();
      expect(res.body.event.pendingEditRequest.proposedChanges.organizerEmail).toBeUndefined();
    });

    it('ERO-5: should detect organizer change from empty to filled', async () => {
      // Event with no organizer set (legacy event)
      const published = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            name: 'Test Requester',
            email: requesterUser.email,
            department: 'General',
            phone: '555-1234',
          },
          // No organizer field
        },
      });
      const [saved] = await insertEvents(db, [published]);

      const res = await request(app)
        .post(`/api/events/${saved._id}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          proposedChanges: {
            organizerName: 'New Organizer',
            organizerPhone: '555-8888',
            organizerEmail: 'new@org.com',
          },
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.pendingEditRequest.proposedChanges.organizerName).toBe('New Organizer');
      expect(res.body.event.pendingEditRequest.proposedChanges.organizerPhone).toBe('555-8888');
      expect(res.body.event.pendingEditRequest.proposedChanges.organizerEmail).toBe('new@org.com');
    });
  });

  describe('Publish-edit: organizer change application', () => {
    it('ERO-6: should apply organizer changes to roomReservationData.organizer', async () => {
      const eventWithEdit = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Test Event',
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            name: 'Test Requester',
            email: requesterUser.email,
            department: 'General',
            phone: '555-1234',
          },
          organizer: {
            name: 'Original Organizer',
            phone: '555-0000',
            email: 'original@org.com',
          },
        },
        requestedChanges: {
          organizerName: 'Updated Organizer',
          organizerPhone: '555-9999',
          organizerEmail: 'updated@org.com',
        },
      });
      const [saved] = await insertEvents(db, [eventWithEdit]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.pendingEditRequest.status).toBe('approved');

      // Verify organizer was written to roomReservationData.organizer
      const dbEvent = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(dbEvent.roomReservationData.organizer.name).toBe('Updated Organizer');
      expect(dbEvent.roomReservationData.organizer.phone).toBe('555-9999');
      expect(dbEvent.roomReservationData.organizer.email).toBe('updated@org.com');
    });

    it('ERO-7: should preserve unchanged organizer fields when applying other changes', async () => {
      const eventWithEdit = createPublishedEventWithEditRequest({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        eventTitle: 'Original Title',
        roomReservationData: {
          requestedBy: {
            userId: requesterUser.odataId,
            name: 'Test Requester',
            email: requesterUser.email,
            department: 'General',
            phone: '555-1234',
          },
          organizer: {
            name: 'Keep This Organizer',
            phone: '555-0000',
            email: 'keep@org.com',
          },
        },
        requestedChanges: {
          eventTitle: 'Updated Title',
          // No organizer changes
        },
      });
      const [saved] = await insertEvents(db, [eventWithEdit]);

      const res = await request(app)
        .put(`/api/admin/events/${saved._id}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.eventTitle).toBe('Updated Title');

      // Verify organizer was NOT changed
      const dbEvent = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(dbEvent.roomReservationData.organizer.name).toBe('Keep This Organizer');
      expect(dbEvent.roomReservationData.organizer.phone).toBe('555-0000');
      expect(dbEvent.roomReservationData.organizer.email).toBe('keep@org.com');
    });
  });
});
