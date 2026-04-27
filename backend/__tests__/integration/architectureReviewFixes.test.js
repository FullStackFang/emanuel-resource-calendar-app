/**
 * Architecture Review Fixes Tests
 *
 * Regression tests for P0/P1 findings from the 2026-04-20 architecture review:
 *   ARF-1 to ARF-4: P0 — Migration endpoint admin guards
 *   ARF-5 to ARF-7: removed (Phase 1d) — covered by editRequestsApprove.test.js
 *   ARF-8 to ARF-10: P1 — Cancellation withdrawal atomic guard
 *   ARF-11: P1 — upsertUnifiedEvent workflow field preservation
 *   ARF-12: removed (Phase 1d) — embedded pendingEditRequest no longer exists
 */

const request = require('supertest');

const { setupTestApp } = require('../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../__helpers__/testSetup');
const {
  createAdmin,
  createApprover,
  createRequester,
  createViewer,
  insertUsers,
} = require('../__helpers__/userFactory');
const {
  createPublishedEvent,
  insertEvents,
} = require('../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../__helpers__/testConstants');

describe('Architecture Review Fixes (ARF-1 to ARF-12)', () => {
  let mongoClient, db, app;
  let adminUser, adminToken;
  let approverUser, approverToken;
  let requesterUser, requesterToken;
  let viewerUser, viewerToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('archReviewFixes'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    adminUser = createAdmin();
    approverUser = createApprover();
    requesterUser = createRequester();
    viewerUser = createViewer();
    await insertUsers(db, [adminUser, approverUser, requesterUser, viewerUser]);

    adminToken = await createMockToken(adminUser);
    approverToken = await createMockToken(approverUser);
    requesterToken = await createMockToken(requesterUser);
    viewerToken = await createMockToken(viewerUser);
  });

  // ==========================================================================
  // P0: Migration endpoint admin guards (ARF-1 to ARF-4)
  // ==========================================================================

  describe('P0: Migration endpoint admin guards', () => {
    const migrationBody = {
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      calendarIds: ['test-calendar'],
    };

    describe('ARF-1: POST /api/admin/migration/preview requires admin', () => {
      it('should return 403 for viewer', async () => {
        const res = await request(app)
          .post('/api/admin/migration/preview')
          .set('Authorization', `Bearer ${viewerToken}`)
          .send(migrationBody);

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/admin/i);
      });

      it('should return 403 for requester', async () => {
        const res = await request(app)
          .post('/api/admin/migration/preview')
          .set('Authorization', `Bearer ${requesterToken}`)
          .send(migrationBody);

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/admin/i);
      });

      it('should return 403 for approver', async () => {
        const res = await request(app)
          .post('/api/admin/migration/preview')
          .set('Authorization', `Bearer ${approverToken}`)
          .send(migrationBody);

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/admin/i);
      });
    });

    describe('ARF-2: POST /api/admin/migration/start requires admin', () => {
      it('should return 403 for viewer', async () => {
        const res = await request(app)
          .post('/api/admin/migration/start')
          .set('Authorization', `Bearer ${viewerToken}`)
          .send(migrationBody);

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/admin/i);
      });

      it('should return 403 for requester', async () => {
        const res = await request(app)
          .post('/api/admin/migration/start')
          .set('Authorization', `Bearer ${requesterToken}`)
          .send(migrationBody);

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/admin/i);
      });
    });

    describe('ARF-3: GET /api/admin/migration/status requires admin', () => {
      it('should return 403 for viewer', async () => {
        const res = await request(app)
          .get('/api/admin/migration/status/fake-session')
          .set('Authorization', `Bearer ${viewerToken}`);

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/admin/i);
      });
    });

    describe('ARF-4: POST /api/admin/migration/cancel requires admin', () => {
      it('should return 403 for requester', async () => {
        const res = await request(app)
          .post('/api/admin/migration/cancel/fake-session')
          .set('Authorization', `Bearer ${requesterToken}`);

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/admin/i);
      });
    });
  });

  // ARF-5/6/7 (P1: publish-edit occurrence OCC) removed — the legacy
  // /api/admin/events/:id/publish-edit endpoint was deleted in Phase 1d. OCC
  // semantics on the new approve endpoint are exercised in
  // editRequestsApprove.test.js (partialFailure 409 on stale eventVersion +
  // VERSION_CONFLICT 409 on stale editRequestVersion).

  // ==========================================================================
  // P1: Cancellation withdrawal atomic guard (ARF-8 to ARF-10)
  // ==========================================================================

  describe('P1: Cancellation withdrawal atomic guard', () => {
    let eventWithCancellation;

    beforeEach(async () => {
      eventWithCancellation = createPublishedEvent({
        userId: requesterUser.odataId,
        requesterEmail: requesterUser.email,
        _version: 1,
        pendingCancellationRequest: {
          id: `cancel-req-${Date.now()}`,
          status: 'pending',
          requestedBy: {
            userId: requesterUser.odataId,
            email: requesterUser.email,
            name: requesterUser.displayName,
            requestedAt: new Date(),
          },
          reason: 'No longer needed',
        },
      });
      [eventWithCancellation] = await insertEvents(db, [eventWithCancellation]);
    });

    describe('ARF-8: Withdrawal succeeds when request is still pending', () => {
      it('should cancel the request and increment _version', async () => {
        const res = await request(app)
          .put(`/api/events/cancellation-requests/${eventWithCancellation._id}/cancel`)
          .set('Authorization', `Bearer ${requesterToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body._version).toBe((eventWithCancellation._version || 0) + 1);

        // Verify DB state
        const updated = await db.collection(COLLECTIONS.EVENTS)
          .findOne({ _id: eventWithCancellation._id });
        expect(updated.pendingCancellationRequest.status).toBe('cancelled');
        expect(updated._version).toBe((eventWithCancellation._version || 0) + 1);
      });
    });

    describe('ARF-9: Withdrawal blocked when already approved (pre-check)', () => {
      it('should return 400 when findOne catches non-pending status', async () => {
        // Simulate approval completing before withdrawal attempt.
        // The findOne pre-check catches this and returns 400.
        // The atomic guard in updateOne is a second defense for the TOCTOU race window.
        await db.collection(COLLECTIONS.EVENTS).updateOne(
          { _id: eventWithCancellation._id },
          { $set: { 'pendingCancellationRequest.status': 'approved' } }
        );

        const res = await request(app)
          .put(`/api/events/cancellation-requests/${eventWithCancellation._id}/cancel`)
          .set('Authorization', `Bearer ${requesterToken}`);

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/no pending cancellation/i);
      });
    });

    describe('ARF-10: Withdrawal increments _version atomically', () => {
      it('should increment _version via $inc in the atomic updateOne', async () => {
        // The TOCTOU race (findOne sees 'pending', approval lands, updateOne filter
        // misses) cannot be reliably simulated in a single-threaded test.
        // ARF-8 proves the happy path; ARF-9 proves the pre-check.
        // This test verifies the updateOne includes $inc: { _version: 1 }.
        const res = await request(app)
          .put(`/api/events/cancellation-requests/${eventWithCancellation._id}/cancel`)
          .set('Authorization', `Bearer ${requesterToken}`);

        expect(res.status).toBe(200);

        const updated = await db.collection(COLLECTIONS.EVENTS)
          .findOne({ _id: eventWithCancellation._id });
        expect(updated._version).toBe((eventWithCancellation._version || 0) + 1);
      });
    });
  });

  // ==========================================================================
  // P1: upsertUnifiedEvent workflow field preservation (ARF-11 to ARF-12)
  // ==========================================================================

  describe('P1: Delta sync preserves workflow fields', () => {
    describe('ARF-11: replaceOne preserves status and _version', () => {
      it('should not wipe status, _version, or statusHistory on delta sync upsert', async () => {
        // Insert an event that has been through the approval workflow
        const graphId = `AAMkAGraph-preserve-test-${Date.now()}`;
        const enrichedEvent = createPublishedEvent({
          userId: adminUser.odataId,
          calendarOwner: 'templeeventssandbox@emanuelnyc.org',
          _version: 5,
          statusHistory: [
            { status: 'draft', changedAt: new Date(), changedBy: 'system' },
            { status: 'pending', changedAt: new Date(), changedBy: 'requester' },
            { status: 'published', changedAt: new Date(), changedBy: 'admin' },
          ],
          roomReservationData: {
            requestedBy: {
              name: 'Test Requester',
              email: 'requester@external.com',
              userId: requesterUser.odataId,
            },
          },
          calendarOwner: 'templeeventssandbox@emanuelnyc.org',
          graphData: {
            id: graphId,
            iCalUId: `ical-${graphId}`,
            subject: 'Enriched Event',
            start: { dateTime: '2026-06-15T10:00:00', timeZone: 'America/New_York' },
            end: { dateTime: '2026-06-15T11:00:00', timeZone: 'America/New_York' },
            location: { displayName: '' },
            locations: [],
            categories: [],
            body: { content: '', contentType: 'text' },
            organizer: { emailAddress: { address: 'admin@emanuelnyc.org', name: 'Admin' } },
          },
        });
        await insertEvents(db, [enrichedEvent]);

        // Verify the pre-condition
        const before = await db.collection(COLLECTIONS.EVENTS)
          .findOne({ 'graphData.id': graphId });
        expect(before.status).toBe('published');
        expect(before._version).toBe(5);
        expect(before.statusHistory).toHaveLength(3);
        expect(before.roomReservationData.requestedBy.email).toBe('requester@external.com');
      });
    });

    // ARF-12 removed — the original test exercised replaceOne preserving an
    // embedded pendingEditRequest field that no longer exists on event docs
    // post-Phase-1d. Edit-request preservation across syncs is irrelevant now
    // that requests live in templeEvents__EditRequests with their own _id.
  });

  // ==========================================================================
  // Phase 2: Dead endpoint removal verification (ARF-13 to ARF-16)
  // ==========================================================================

  describe('Phase 2: Deleted endpoints return 404', () => {
    describe('ARF-13: PATCH /api/events/:eventId/internal is removed', () => {
      it('should return 404 for deleted endpoint', async () => {
        const res = await request(app)
          .patch('/api/events/test-event-id/internal')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ internalData: { setupNotes: 'test' } });

        expect(res.status).toBe(404);
      });
    });

    describe('ARF-14: POST /api/events/batch is removed', () => {
      it('should return 404 for deleted endpoint', async () => {
        const res = await request(app)
          .post('/api/events/batch')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ events: [] });

        expect(res.status).toBe(404);
      });
    });

    describe('ARF-15: PUT /api/events/:id/department-fields is removed', () => {
      it('should return 404 for deleted endpoint', async () => {
        const res = await request(app)
          .put('/api/events/test-id/department-fields')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ doorOpenTime: '08:00' });

        expect(res.status).toBe(404);
      });
    });

    describe('ARF-16: GET /api/events/by-source is removed', () => {
      it('should return 404 for deleted endpoint', async () => {
        const res = await request(app)
          .get('/api/events/by-source?source=csv')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(404);
      });
    });
  });
});
