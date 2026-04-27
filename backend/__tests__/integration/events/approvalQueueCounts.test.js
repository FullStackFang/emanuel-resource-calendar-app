/**
 * Approval Queue Counts Tests (AQC-1 to AQC-6)
 *
 * Verifies that GET /api/events/list/counts?view=approval-queue returns
 * correct counts that match the events actually returned by the list endpoint.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { invalidateCountsCacheTargeted } = require('../../../api-server');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createPublishedEvent,
  createPublishedEventWithEditRequest,
  createRejectedEvent,
  createDeletedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { seedPendingEditRequestForEvent } = require('../../__helpers__/editRequestFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, ENDPOINTS } = require('../../__helpers__/testConstants');

describe('Approval Queue Counts Tests (AQC-1 to AQC-9)', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('approvalQueueCounts'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.EDIT_REQUESTS).deleteMany({});
    // The counts endpoint caches responses for 30s and is keyed per-view
    // (approval-queue is shared across users). Between tests we reset the DB
    // but not the in-memory cache, so stale counts leak. Clear it explicitly.
    invalidateCountsCacheTargeted();

    approverUser = createApprover();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, requesterUser]);

    approverToken = await createMockToken(approverUser);
  });

  it('AQC-1: returns correct counts for pending events', async () => {
    await insertEvents(db, [
      createPendingEvent({ requesterEmail: requesterUser.email, eventTitle: 'Pending 1' }),
      createPendingEvent({ requesterEmail: requesterUser.email, eventTitle: 'Pending 2' }),
      createPendingEvent({ requesterEmail: requesterUser.email, eventTitle: 'Pending 3' }),
    ]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS_COUNTS}?view=approval-queue`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.pending).toBe(3);
    expect(res.body.all).toBe(3);
  });

  it('AQC-2: returns correct counts for mixed statuses', async () => {
    await insertEvents(db, [
      createPendingEvent({ requesterEmail: requesterUser.email, eventTitle: 'Pending' }),
      createPublishedEvent({ requesterEmail: requesterUser.email, eventTitle: 'Published' }),
      createRejectedEvent({ requesterEmail: requesterUser.email, eventTitle: 'Rejected' }),
    ]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS_COUNTS}?view=approval-queue`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.pending).toBe(1);
    expect(res.body.published).toBe(1);
    expect(res.body.rejected).toBe(1);
    expect(res.body.all).toBe(3);
  });

  it('AQC-3: needs_attention = pending + published_edit + published_cancellation', async () => {
    const publishedWithCancel = createPublishedEvent({
      requesterEmail: requesterUser.email,
      eventTitle: 'Published With Cancel',
    });
    publishedWithCancel.pendingCancellationRequest = {
      status: 'pending',
      requestedBy: requesterUser.email,
      requestedAt: new Date(),
      reason: 'No longer needed',
    };

    const insertedEvents = await insertEvents(db, [
      createPendingEvent({ requesterEmail: requesterUser.email, eventTitle: 'Pending' }),
      createPublishedEventWithEditRequest({ requesterEmail: requesterUser.email, eventTitle: 'Published With Edit' }),
      publishedWithCancel,
    ]);
    // Edit requests live in templeEvents__EditRequests; pair the published-with-edit fixture
    // with a real pending request doc so the new collection-backed queries pick it up.
    await seedPendingEditRequestForEvent(db, insertedEvents[1], { userId: requesterUser.userId, requestedBy: { email: requesterUser.email, name: requesterUser.email } });

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS_COUNTS}?view=approval-queue`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.pending).toBe(1);
    expect(res.body.published_edit).toBe(1);
    expect(res.body.published_cancellation).toBe(1);

    // Frontend computes: needs_attention = pending + published_edit + published_cancellation
    const needsAttention = res.body.pending + res.body.published_edit + res.body.published_cancellation;
    expect(needsAttention).toBe(3);
  });

  it('AQC-4: deleted events are excluded from all counts', async () => {
    await insertEvents(db, [
      createPendingEvent({ requesterEmail: requesterUser.email, eventTitle: 'Pending' }),
      createDeletedEvent({ requesterEmail: requesterUser.email, eventTitle: 'Deleted' }),
    ]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS_COUNTS}?view=approval-queue`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    expect(res.body.pending).toBe(1);
    expect(res.body.all).toBe(1);
  });

  it('AQC-5: counts match list endpoint results', async () => {
    await insertEvents(db, [
      createPendingEvent({ requesterEmail: requesterUser.email, eventTitle: 'Pending 1' }),
      createPendingEvent({ requesterEmail: requesterUser.email, eventTitle: 'Pending 2' }),
      createPublishedEvent({ requesterEmail: requesterUser.email, eventTitle: 'Published' }),
      createRejectedEvent({ requesterEmail: requesterUser.email, eventTitle: 'Rejected' }),
    ]);

    const [countsRes, listRes] = await Promise.all([
      request(app)
        .get(`${ENDPOINTS.LIST_EVENTS_COUNTS}?view=approval-queue`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200),
      request(app)
        .get(`${ENDPOINTS.LIST_EVENTS}?view=approval-queue&limit=1000`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200),
    ]);

    // counts.all should equal the number of events returned by list (non-deleted)
    expect(countsRes.body.all).toBe(listRes.body.events.length);
  });

  it('AQC-6: published count excludes events with pending edit/cancel requests', async () => {
    const publishedWithCancel = createPublishedEvent({
      requesterEmail: requesterUser.email,
      eventTitle: 'Published With Cancel',
    });
    publishedWithCancel.pendingCancellationRequest = {
      status: 'pending',
      requestedBy: requesterUser.email,
      requestedAt: new Date(),
      reason: 'No longer needed',
    };

    const insertedEvents = await insertEvents(db, [
      createPublishedEvent({ requesterEmail: requesterUser.email, eventTitle: 'Plain Published' }),
      createPublishedEventWithEditRequest({ requesterEmail: requesterUser.email, eventTitle: 'Published With Edit' }),
      publishedWithCancel,
    ]);
    await seedPendingEditRequestForEvent(db, insertedEvents[1], { userId: requesterUser.userId, requestedBy: { email: requesterUser.email, name: requesterUser.email } });

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS_COUNTS}?view=approval-queue`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    // published = publishedTotal - published_edit - published_cancellation
    // Only 'Plain Published' should be in the plain published count
    expect(res.body.published).toBe(1);
    expect(res.body.published_edit).toBe(1);
    expect(res.body.published_cancellation).toBe(1);
    // all = pending + publishedTotal + rejected = 0 + 3 + 0
    expect(res.body.all).toBe(3);
  });

  it('AQC-8: atomic needsAttention count matches list endpoint and deduplicates doubly-flagged events', async () => {
    // Doubly-flagged event: both pending edit AND pending cancellation.
    // Summing the three component counts (pending + published_edit + published_cancellation)
    // would double-count this one — the atomic needsAttention query deduplicates it.
    const doublyFlagged = createPublishedEvent({
      requesterEmail: requesterUser.email,
      eventTitle: 'Doubly Flagged',
    });
    // Pending edit goes to the new collection (seeded after insert below);
    // pending cancellation still lives embedded on the event doc.
    doublyFlagged.pendingCancellationRequest = {
      status: 'pending',
      requestedBy: requesterUser.email,
      requestedAt: new Date(),
      reason: 'No longer needed',
    };

    // Plain cancellation (edit-request-only)
    const publishedWithCancel = createPublishedEvent({
      requesterEmail: requesterUser.email,
      eventTitle: 'Published With Cancel',
    });
    publishedWithCancel.pendingCancellationRequest = {
      status: 'pending',
      requestedBy: requesterUser.email,
      requestedAt: new Date(),
      reason: 'Cancel me',
    };

    const insertedEvents = await insertEvents(db, [
      createPendingEvent({ requesterEmail: requesterUser.email, eventTitle: 'Plain Pending' }),
      createPublishedEventWithEditRequest({ requesterEmail: requesterUser.email, eventTitle: 'Published With Edit' }),
      publishedWithCancel,
      doublyFlagged,
      createPublishedEvent({ requesterEmail: requesterUser.email, eventTitle: 'Plain Published' }),
      createRejectedEvent({ requesterEmail: requesterUser.email, eventTitle: 'Rejected' }),
    ]);
    // Seed pending edit-requests for the two events that need them.
    const insertedPublishedWithEdit = insertedEvents[1];
    const insertedDoublyFlagged = insertedEvents[3];
    await seedPendingEditRequestForEvent(db, insertedPublishedWithEdit, { userId: requesterUser.userId, requestedBy: { email: requesterUser.email, name: requesterUser.email } });
    await seedPendingEditRequestForEvent(db, insertedDoublyFlagged, { userId: requesterUser.userId, requestedBy: { email: requesterUser.email, name: requesterUser.email } });

    const [countsRes, listRes] = await Promise.all([
      request(app)
        .get(`${ENDPOINTS.LIST_EVENTS_COUNTS}?view=approval-queue`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200),
      request(app)
        .get(`${ENDPOINTS.LIST_EVENTS}?view=approval-queue&status=needs_attention&limit=1000`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200),
    ]);

    // Parity: atomic needsAttention === list length for status=needs_attention
    expect(countsRes.body).toHaveProperty('needsAttention');
    expect(countsRes.body.needsAttention).toBe(listRes.body.events.length);

    // Needs-attention set here: Plain Pending, Published With Edit,
    // Published With Cancel, Doubly Flagged → 4 distinct events.
    expect(countsRes.body.needsAttention).toBe(4);

    // The legacy sum double-counts the doubly-flagged event (once for edit,
    // once for cancel) — so the atomic count must be strictly LESS than the sum.
    const legacySum =
      (countsRes.body.pending || 0) +
      (countsRes.body.published_edit || 0) +
      (countsRes.body.published_cancellation || 0);
    expect(legacySum).toBe(5); // 1 pending + 2 edits (incl doubly) + 2 cancels (incl doubly)
    expect(countsRes.body.needsAttention).toBeLessThan(legacySum);

    // The plain-published count (publishedTotal - published_edit - published_cancellation)
    // would go negative when an event is doubly-flagged (edit AND cancel) without
    // any plain-published events present. Guarded by Math.max(0, ...) in the handler.
    expect(countsRes.body.published).toBeGreaterThanOrEqual(0);
  });

  it('AQC-9: parity for exception-document path (pendingEditRequest-only arm of baseQuery.$or)', async () => {
    // An event can enter the approval queue through any of three arms of baseQuery.$or:
    //   1. roomReservationData: { $exists: true, $ne: null }
    //   2. pendingCancellationRequest.status: 'pending'
    //   3. pendingEditRequest.status: 'pending'
    //
    // AQC-8 already covers the roomReservationData arm. This test locks parity for
    // the pendingEditRequest arm by seeding a published event that has NO
    // roomReservationData but carries a pending edit request — e.g., the
    // exception-document path for a recurring-series edit.
    const editOnlyEvent = createPublishedEvent({
      requesterEmail: requesterUser.email,
      eventTitle: 'Edit-Only (no reservation data)',
      roomReservationData: null,
    });
    // Edit request lives in the new collection — seeded after the event is inserted below.

    // Also seed a plain-pending event so the other arm contributes too.
    const insertedEvents = await insertEvents(db, [
      createPendingEvent({ requesterEmail: requesterUser.email, eventTitle: 'Plain Pending' }),
      editOnlyEvent,
    ]);
    const insertedEditOnly = insertedEvents[1];
    await seedPendingEditRequestForEvent(db, insertedEditOnly, {
      userId: requesterUser.userId || 'test-user',
      requestedBy: { email: requesterUser.email, name: requesterUser.email },
    });

    const [countsRes, listRes] = await Promise.all([
      request(app)
        .get(`${ENDPOINTS.LIST_EVENTS_COUNTS}?view=approval-queue`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200),
      request(app)
        .get(`${ENDPOINTS.LIST_EVENTS}?view=approval-queue&status=needs_attention&limit=1000`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200),
    ]);

    // Parity: atomic needsAttention === list length for status=needs_attention,
    // regardless of which baseQuery.$or arm brought the event in.
    expect(countsRes.body).toHaveProperty('needsAttention');
    expect(countsRes.body.needsAttention).toBe(listRes.body.events.length);

    // Sanity check: the two seeded events (plain pending + edit-only published)
    // must both be in the needs-attention set.
    expect(countsRes.body.needsAttention).toBeGreaterThanOrEqual(2);
  });

  it('AQC-7: legacy room-reservation-request status counts as pending', async () => {
    // The public booking flow creates events with status 'room-reservation-request'
    // which should be included in the 'pending' bucket
    await insertEvents(db, [
      createPendingEvent({ requesterEmail: requesterUser.email, eventTitle: 'Normal Pending' }),
      createPendingEvent({ requesterEmail: requesterUser.email, eventTitle: 'Legacy Request', status: 'room-reservation-request' }),
    ]);

    const res = await request(app)
      .get(`${ENDPOINTS.LIST_EVENTS_COUNTS}?view=approval-queue`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    // Both statuses collapse into the pending count
    expect(res.body.pending).toBe(2);
    expect(res.body.all).toBe(2);
  });
});
