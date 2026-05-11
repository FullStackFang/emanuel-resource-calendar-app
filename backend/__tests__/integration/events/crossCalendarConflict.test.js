/**
 * Cross-Calendar Conflict Isolation Tests (CC-1 to CC-4)
 *
 * Regression tests for the bug where events in different mailbox calendars
 * (e.g. templeevents@... vs templeeventssandbox@...) using the same room
 * were flagged as conflicting both in the SchedulingAssistant UI and in
 * write-path conflict checks (publish, save, edit, restore).
 *
 * CC-1: GET /api/rooms/availability?calendarOwner=X returns only events from calendar X
 * CC-2: GET /api/rooms/availability with no calendarOwner returns events from all calendars (backward compat)
 * CC-3: Publishing an event must NOT 409 when the only overlap is in a different calendar
 * CC-4: Publishing an event MUST 409 when the overlap is in the same calendar (regression guard)
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createAdmin,
  createRequester,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createPendingEvent,
  createPublishedEvent,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const graphApiMock = require('../../__helpers__/graphApiMock');
const { COLLECTIONS, ENDPOINTS } = require('../../__helpers__/testConstants');

const pad = (n) => String(n).padStart(2, '0');
function toLocalISOString(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const SANDBOX_OWNER = 'templeeventssandbox@emanuelnyc.org';
const PRODUCTION_OWNER = 'templeevents@emanuelnyc.org';

describe('Cross-Calendar Conflict Isolation (CC-1 to CC-4)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser, requesterUser;
  let adminToken;
  let locationA;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('crossCalendarConflict'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.LOCATIONS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    graphApiMock.resetMocks();

    adminUser = createAdmin();
    requesterUser = createRequester();
    await insertUsers(db, [adminUser, requesterUser]);
    adminToken = await createMockToken(adminUser);

    locationA = {
      _id: new ObjectId(),
      name: 'Sanctuary',
      displayName: 'Sanctuary',
      isReservable: true,
      active: true,
    };
    await db.collection(COLLECTIONS.LOCATIONS).insertMany([locationA]);
  });

  // Helper: build a published event in a specific calendar at a specific time + room.
  function buildPublished({ calendarOwner, start, end }) {
    const evt = createPublishedEvent({
      userId: adminUser.odataId,
      requesterEmail: adminUser.email,
      startDateTime: start,
      endDateTime: end,
      locations: [locationA._id],
      calendarData: undefined,
      calendarOwner,
    });
    evt.calendarData = {
      ...evt.calendarData,
      locations: [locationA._id],
      locationDisplayNames: ['Sanctuary'],
      startDateTime: toLocalISOString(start),
      endDateTime: toLocalISOString(end),
    };
    return evt;
  }

  // Helper: build a pending event in a specific calendar at a specific time + room.
  function buildPending({ calendarOwner, start, end }) {
    const evt = createPendingEvent({
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      startDateTime: start,
      endDateTime: end,
      locations: [locationA._id],
      calendarData: undefined,
      calendarOwner,
    });
    evt.calendarData = {
      ...evt.calendarData,
      locations: [locationA._id],
      locationDisplayNames: ['Sanctuary'],
      startDateTime: toLocalISOString(start),
      endDateTime: toLocalISOString(end),
    };
    return evt;
  }

  // Build a tomorrow time window
  function tomorrowWindow(hour = 18) {
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start);
    end.setHours(hour + 1, 0, 0, 0);
    return { start, end };
  }

  // =========================================================================
  // CC-1: GET /api/rooms/availability?calendarOwner=X hides other-calendar events
  // =========================================================================
  describe('CC-1: availability endpoint filters by calendarOwner', () => {
    test('only events with matching calendarOwner are returned', async () => {
      const { start, end } = tomorrowWindow();
      const sandboxEvent = buildPublished({ calendarOwner: SANDBOX_OWNER, start, end });
      const productionEvent = buildPublished({ calendarOwner: PRODUCTION_OWNER, start, end });
      await insertEvents(db, [sandboxEvent, productionEvent]);

      const date = start.toISOString().split('T')[0];
      const response = await request(app)
        .get('/api/rooms/availability')
        .query({
          startDateTime: `${date}T00:00:00`,
          endDateTime: `${date}T23:59:59`,
          roomIds: locationA._id.toString(),
          calendarOwner: SANDBOX_OWNER,
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);

      // Flatten every conflict bucket across every room
      const roomBuckets = response.body.flatMap((roomEntry) => {
        const c = roomEntry?.conflicts || {};
        return [
          ...(c.reservations || []),
          ...(c.events || []),
          ...(c.pendingReservations || []),
          ...(c.pendingEdits || []),
        ];
      });

      const ids = roomBuckets
        .map((e) => (e && (e._id || e.id) ? (e._id || e.id).toString() : null))
        .filter(Boolean);

      expect(ids).toContain(sandboxEvent._id.toString());
      expect(ids).not.toContain(productionEvent._id.toString());
    });
  });

  // =========================================================================
  // CC-2: backward-compat — no calendarOwner param returns all
  // =========================================================================
  describe('CC-2: availability endpoint without calendarOwner returns all calendars', () => {
    test('legacy callers (no calendarOwner) see events from every calendar', async () => {
      const { start, end } = tomorrowWindow();
      const sandboxEvent = buildPublished({ calendarOwner: SANDBOX_OWNER, start, end });
      const productionEvent = buildPublished({ calendarOwner: PRODUCTION_OWNER, start, end });
      await insertEvents(db, [sandboxEvent, productionEvent]);

      const date = start.toISOString().split('T')[0];
      const response = await request(app)
        .get('/api/rooms/availability')
        .query({
          startDateTime: `${date}T00:00:00`,
          endDateTime: `${date}T23:59:59`,
          roomIds: locationA._id.toString(),
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);

      const roomBuckets = response.body.flatMap((roomEntry) => {
        const c = roomEntry?.conflicts || {};
        return [
          ...(c.reservations || []),
          ...(c.events || []),
          ...(c.pendingReservations || []),
          ...(c.pendingEdits || []),
        ];
      });
      const ids = roomBuckets
        .map((e) => (e && (e._id || e.id) ? (e._id || e.id).toString() : null))
        .filter(Boolean);

      expect(ids).toContain(sandboxEvent._id.toString());
      expect(ids).toContain(productionEvent._id.toString());
    });
  });

  // =========================================================================
  // CC-3: Publish must NOT 409 on cross-calendar overlap
  // =========================================================================
  describe('CC-3: publish does not 409 on cross-calendar overlap', () => {
    test('pending sandbox event can publish even when production has same room/time', async () => {
      const { start, end } = tomorrowWindow();

      const productionEvent = buildPublished({ calendarOwner: PRODUCTION_OWNER, start, end });
      const sandboxPending = buildPending({ calendarOwner: SANDBOX_OWNER, start, end });
      await insertEvents(db, [productionEvent, sandboxPending]);

      const response = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(sandboxPending._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          notes: 'Publishing sandbox event despite production overlap',
          _version: sandboxPending._version,
        });

      // Must NOT 409 — the only overlapping event is in a different calendar.
      expect(response.status).not.toBe(409);
    });
  });

  // =========================================================================
  // CC-5: availability endpoint dedupes rsSched cross-calendar duplicates
  //   when calendarOwner param is absent (defensive belt-and-suspenders for
  //   missed call sites). rsSched events live as one doc per
  //   (eventId, calendarOwner) by design, so unfiltered queries return BOTH
  //   the sandbox + prod copies of the same logical event. The
  //   SchedulingAssistant rendered these as side-by-side duplicate blocks
  //   before the fix.
  // =========================================================================
  describe('CC-5: availability dedupes duplicates sharing eventId when calendarOwner is omitted', () => {
    test('two docs sharing eventId across calendars collapse to one entry', async () => {
      const { start, end } = tomorrowWindow();

      // Build the sandbox copy first (older lastModifiedDateTime), then the
      // prod copy (newer). Dedup should keep the prod copy.
      const sandboxCopy = buildPublished({ calendarOwner: SANDBOX_OWNER, start, end });
      const prodCopy = buildPublished({ calendarOwner: PRODUCTION_OWNER, start, end });
      // Shared logical eventId (mirrors how the rsSched importer keys docs).
      sandboxCopy.eventId = 'rssched-test-CC5-1';
      prodCopy.eventId = 'rssched-test-CC5-1';
      sandboxCopy.lastModifiedDateTime = new Date(start.getTime() - 7 * 86400000); // 7 days before
      prodCopy.lastModifiedDateTime = new Date(start.getTime() - 1 * 86400000);    // 1 day before

      await insertEvents(db, [sandboxCopy, prodCopy]);

      const date = start.toISOString().split('T')[0];
      const response = await request(app)
        .get('/api/rooms/availability')
        .query({
          startDateTime: `${date}T00:00:00`,
          endDateTime: `${date}T23:59:59`,
          roomIds: locationA._id.toString(),
          // Intentionally NO calendarOwner — exercises the dedup path
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const roomBuckets = response.body.flatMap((roomEntry) => {
        const c = roomEntry?.conflicts || {};
        return [
          ...(c.reservations || []),
          ...(c.events || []),
          ...(c.pendingReservations || []),
          ...(c.pendingEdits || []),
        ];
      });
      const ids = roomBuckets
        .map((e) => (e && (e._id || e.id) ? (e._id || e.id).toString() : null))
        .filter(Boolean);

      // Exactly one of the two should remain (the more-recently-modified prod copy)
      const sandboxAppears = ids.includes(sandboxCopy._id.toString());
      const prodAppears = ids.includes(prodCopy._id.toString());
      expect(prodAppears).toBe(true);
      expect(sandboxAppears).toBe(false);
    });

    test('two docs with DIFFERENT eventIds in different calendars both still appear (CC-2 regression guard)', async () => {
      // Sanity: dedup must NOT collapse genuinely-distinct events that
      // happen to share a room/time across calendars. Only same-eventId
      // duplicates collapse.
      const { start, end } = tomorrowWindow();
      const sandboxEvent = buildPublished({ calendarOwner: SANDBOX_OWNER, start, end });
      const productionEvent = buildPublished({ calendarOwner: PRODUCTION_OWNER, start, end });
      // Factory generates unique eventIds — leaving them as-is.

      await insertEvents(db, [sandboxEvent, productionEvent]);

      const date = start.toISOString().split('T')[0];
      const response = await request(app)
        .get('/api/rooms/availability')
        .query({
          startDateTime: `${date}T00:00:00`,
          endDateTime: `${date}T23:59:59`,
          roomIds: locationA._id.toString(),
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const roomBuckets = response.body.flatMap((roomEntry) => {
        const c = roomEntry?.conflicts || {};
        return [
          ...(c.reservations || []),
          ...(c.events || []),
          ...(c.pendingReservations || []),
          ...(c.pendingEdits || []),
        ];
      });
      const ids = roomBuckets
        .map((e) => (e && (e._id || e.id) ? (e._id || e.id).toString() : null))
        .filter(Boolean);

      expect(ids).toContain(sandboxEvent._id.toString());
      expect(ids).toContain(productionEvent._id.toString());
    });
  });

  // =========================================================================
  // CC-4: Publish MUST 409 on same-calendar overlap (regression guard)
  // =========================================================================
  describe('CC-4: publish still 409s on same-calendar overlap', () => {
    test('pending sandbox event cannot publish over a published sandbox event', async () => {
      const { start, end } = tomorrowWindow();

      const sandboxExisting = buildPublished({ calendarOwner: SANDBOX_OWNER, start, end });
      const sandboxPending = buildPending({ calendarOwner: SANDBOX_OWNER, start, end });
      await insertEvents(db, [sandboxExisting, sandboxPending]);

      const response = await request(app)
        .put(ENDPOINTS.PUBLISH_EVENT(sandboxPending._id))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          notes: 'Should be blocked',
          _version: sandboxPending._version,
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('SchedulingConflict');
    });
  });
});
