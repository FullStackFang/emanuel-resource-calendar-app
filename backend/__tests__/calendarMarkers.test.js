/**
 * Calendar Markers — CRUD, validation, admin-gating, soft-delete, range read.
 *
 * Markers are holiday / office-closed day annotations stored in a dedicated
 * `templeEvents__CalendarMarkers` collection, fully isolated from the event
 * domain (see openspec/changes/add-calendar-markers/design.md). These tests
 * lock the backend contract:
 *   - admin-only create/update/delete (403 for non-admins, nothing stored)
 *   - validation (type, non-empty name, YYYY-MM-DD dates, endDate >= startDate)
 *   - soft-delete (active:false, excluded from active reads)
 *   - the range read (lexical overlap predicate)
 *   - markers never leak into event list/counts surfaces
 */

const request = require('supertest');

const { setupTestApp } = require('./__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('./__helpers__/testSetup');
const { createAdmin, createApprover, createRequester, createViewer, insertUsers } = require('./__helpers__/userFactory');
const { createMockToken, initTestKeys } = require('./__helpers__/authHelpers');
const graphApiMock = require('./__helpers__/graphApiMock');

const MARKERS_COLLECTION = 'templeEvents__CalendarMarkers';

describe('Calendar Markers', () => {
  let mongoClient, db, app;
  let adminToken, approverToken, requesterToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('calendarMarkers'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection('templeEvents__Users').deleteMany({});
    await db.collection(MARKERS_COLLECTION).deleteMany({});

    const admin = createAdmin();
    const approver = createApprover();
    const requester = createRequester();
    await insertUsers(db, [admin, approver, requester]);
    adminToken = await createMockToken(admin);
    approverToken = await createMockToken(approver);
    requesterToken = await createMockToken(requester);
  });

  const validMarker = (overrides = {}) => ({
    type: 'holiday',
    name: 'Rosh Hashanah',
    note: 'New Year',
    startDate: '2026-09-12',
    endDate: '2026-09-13',
    warnOnReservation: true,
    pushToOutlook: false,
    ...overrides,
  });

  const post = (token, body) =>
    request(app).post('/api/calendar-markers').set('Authorization', `Bearer ${token}`).send(body);
  const put = (token, id, body) =>
    request(app).put(`/api/calendar-markers/${id}`).set('Authorization', `Bearer ${token}`).send(body);
  const del = (token, id) =>
    request(app).delete(`/api/calendar-markers/${id}`).set('Authorization', `Bearer ${token}`);
  const getMarkers = (token, query = '') =>
    request(app).get(`/api/calendar-markers${query}`).set('Authorization', `Bearer ${token}`);

  describe('Create (POST /api/calendar-markers)', () => {
    it('admin creates a single-day marker (startDate === endDate, active:true)', async () => {
      const res = await post(adminToken, validMarker({ startDate: '2026-12-25', endDate: '2026-12-25' }));
      expect(res.status).toBe(201);
      expect(res.body.startDate).toBe('2026-12-25');
      expect(res.body.endDate).toBe('2026-12-25');
      expect(res.body.active).toBe(true);
      // graphData parent must exist (null) so a later full-object $set lands in Cosmos
      expect(res.body).toHaveProperty('graphData', null);

      const stored = await db.collection(MARKERS_COLLECTION).findOne({ _id: { $exists: true } });
      expect(stored.createdBy).toBeTruthy();
      expect(stored.createdAt).toBeTruthy();
    });

    it('admin creates a multi-day marker (endDate later than startDate)', async () => {
      const res = await post(adminToken, validMarker({ startDate: '2026-09-12', endDate: '2026-09-20' }));
      expect(res.status).toBe(201);
      expect(res.body.endDate > res.body.startDate).toBe(true);
    });

    it('non-admin (approver) is blocked with 403 and stores nothing', async () => {
      const res = await post(approverToken, validMarker());
      expect(res.status).toBe(403);
      expect(await db.collection(MARKERS_COLLECTION).countDocuments({})).toBe(0);
    });

    it('non-admin (requester) is blocked with 403 and stores nothing', async () => {
      const res = await post(requesterToken, validMarker());
      expect(res.status).toBe(403);
      expect(await db.collection(MARKERS_COLLECTION).countDocuments({})).toBe(0);
    });
  });

  describe('Validation', () => {
    it('rejects endDate earlier than startDate (400, stores nothing)', async () => {
      const res = await post(adminToken, validMarker({ startDate: '2026-09-20', endDate: '2026-09-12' }));
      expect(res.status).toBe(400);
      expect(await db.collection(MARKERS_COLLECTION).countDocuments({})).toBe(0);
    });

    it('rejects an invalid type (400)', async () => {
      const res = await post(adminToken, validMarker({ type: 'birthday' }));
      expect(res.status).toBe(400);
    });

    it('rejects an empty name (400)', async () => {
      const res = await post(adminToken, validMarker({ name: '   ' }));
      expect(res.status).toBe(400);
    });

    it('rejects a malformed date string (400)', async () => {
      const res = await post(adminToken, validMarker({ startDate: '09/12/2026' }));
      expect(res.status).toBe(400);
    });
  });

  describe('Update (PUT /api/calendar-markers/:id)', () => {
    let id;
    beforeEach(async () => {
      const res = await post(adminToken, validMarker());
      id = res.body._id;
    });

    it('admin updates name and dates, bumps updatedBy/updatedAt', async () => {
      const res = await put(adminToken, id, { ...validMarker(), name: 'Yom Kippur', endDate: '2026-09-14' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Yom Kippur');
      expect(res.body.endDate).toBe('2026-09-14');
      expect(res.body.updatedBy).toBeTruthy();
    });

    it('non-admin update is blocked with 403', async () => {
      const res = await put(approverToken, id, { ...validMarker(), name: 'Hacked' });
      expect(res.status).toBe(403);
      const stored = await db.collection(MARKERS_COLLECTION).findOne({});
      expect(stored.name).toBe('Rosh Hashanah');
    });

    it('validates on update (endDate before startDate → 400)', async () => {
      const res = await put(adminToken, id, { ...validMarker(), startDate: '2026-09-20', endDate: '2026-09-12' });
      expect(res.status).toBe(400);
    });
  });

  describe('Soft delete (DELETE /api/calendar-markers/:id)', () => {
    let id;
    beforeEach(async () => {
      const res = await post(adminToken, validMarker());
      id = res.body._id;
    });

    it('admin delete sets active:false and excludes it from active reads', async () => {
      const res = await del(adminToken, id);
      expect(res.status).toBe(200);
      const stored = await db.collection(MARKERS_COLLECTION).findOne({});
      expect(stored.active).toBe(false);

      const list = await getMarkers(adminToken);
      expect(list.status).toBe(200);
      expect(list.body.find((m) => m._id === id)).toBeUndefined();
    });

    it('non-admin delete is blocked with 403', async () => {
      const res = await del(requesterToken, id);
      expect(res.status).toBe(403);
      const stored = await db.collection(MARKERS_COLLECTION).findOne({});
      expect(stored.active).toBe(true);
    });
  });

  describe('Events-department access (non-admin, role-independent)', () => {
    let eventsViewerToken;
    let eventsRequesterToken;
    let plainViewerToken;
    let securityToken;

    beforeEach(async () => {
      const eventsViewer = createViewer({ email: 'events-viewer@test.com', userId: 'events-viewer', department: 'events' });
      const eventsRequester = createRequester({ email: 'events-requester@test.com', userId: 'events-requester', department: 'events' });
      const plainViewer = createViewer({ email: 'plain-viewer@test.com', userId: 'plain-viewer' });
      const securityUser = createRequester({ email: 'security@test.com', userId: 'security-user', department: 'security' });
      await insertUsers(db, [eventsViewer, eventsRequester, plainViewer, securityUser]);
      eventsViewerToken = await createMockToken(eventsViewer);
      eventsRequesterToken = await createMockToken(eventsRequester);
      plainViewerToken = await createMockToken(plainViewer);
      securityToken = await createMockToken(securityUser);
    });

    it('events-dept viewer can CREATE a marker (201)', async () => {
      const res = await post(eventsViewerToken, validMarker());
      expect(res.status).toBe(201);
      expect(await db.collection(MARKERS_COLLECTION).countDocuments({})).toBe(1);
    });

    it('events-dept requester can UPDATE a marker (200)', async () => {
      const created = await post(adminToken, validMarker());
      const res = await put(eventsRequesterToken, created.body._id, { ...validMarker(), name: 'Updated' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated');
    });

    it('events-dept viewer can DELETE a marker (200, soft-delete)', async () => {
      const created = await post(adminToken, validMarker());
      const res = await del(eventsViewerToken, created.body._id);
      expect(res.status).toBe(200);
      const stored = await db.collection(MARKERS_COLLECTION).findOne({});
      expect(stored.active).toBe(false);
    });

    it('a viewer NOT in the events department is still blocked (403)', async () => {
      const res = await post(plainViewerToken, validMarker());
      expect(res.status).toBe(403);
      expect(await db.collection(MARKERS_COLLECTION).countDocuments({})).toBe(0);
    });

    it('a non-events department (security) is blocked (403)', async () => {
      const res = await post(securityToken, validMarker());
      expect(res.status).toBe(403);
      expect(await db.collection(MARKERS_COLLECTION).countDocuments({})).toBe(0);
    });
  });

  describe('Read API (GET /api/calendar-markers)', () => {
    beforeEach(async () => {
      await post(adminToken, validMarker({ name: 'Sept fest', startDate: '2026-09-12', endDate: '2026-09-20' }));
      await post(adminToken, validMarker({ name: 'Dec holiday', type: 'officeClosed', startDate: '2026-12-24', endDate: '2026-12-26' }));
    });

    it('returns all active markers with no window', async () => {
      const res = await getMarkers(adminToken);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
    });

    it('range query returns only markers whose [startDate,endDate] overlaps the window', async () => {
      // Window fully inside the Sept marker, before the Dec marker
      const res = await getMarkers(adminToken, '?start=2026-09-15&end=2026-09-16');
      expect(res.status).toBe(200);
      expect(res.body.map((m) => m.name)).toEqual(['Sept fest']);
    });

    it('range query includes a marker that overlaps the window edge', async () => {
      // Window touches the Dec marker's start day only
      const res = await getMarkers(adminToken, '?start=2026-12-26&end=2026-12-31');
      expect(res.status).toBe(200);
      expect(res.body.map((m) => m.name)).toEqual(['Dec holiday']);
    });

    it('range query excludes a non-overlapping window', async () => {
      const res = await getMarkers(adminToken, '?start=2026-10-01&end=2026-10-31');
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(0);
    });
  });

  describe('Outlook (Graph) sync lifecycle', () => {
    beforeEach(() => {
      graphApiMock.resetMocks();
    });

    it('create with pushToOutlook:false → no Graph event, graphData null', async () => {
      const res = await post(adminToken, validMarker({ pushToOutlook: false }));
      expect(res.status).toBe(201);
      expect(res.body.graphData).toBeNull();
      expect(graphApiMock.getCallHistory('createCalendarEvent').length).toBe(0);
    });

    it('create with pushToOutlook:true → creates an all-day Graph event and stores linkage', async () => {
      const res = await post(adminToken, validMarker({ type: 'officeClosed', pushToOutlook: true, startDate: '2026-09-12', endDate: '2026-09-13' }));
      expect(res.status).toBe(201);

      const calls = graphApiMock.getCallHistory('createCalendarEvent');
      expect(calls.length).toBe(1);
      const payload = calls[0].eventData;
      expect(payload.isAllDay).toBe(true);
      expect(payload.start.dateTime).toBe('2026-09-12');
      expect(payload.end.dateTime).toBe('2026-09-14'); // exclusive end
      expect(payload.showAs).toBe('oof');

      // Linkage persisted on the marker
      expect(res.body.graphData).toBeTruthy();
      expect(res.body.graphData.id).toBeTruthy();
      const stored = await db.collection(MARKERS_COLLECTION).findOne({ _id: { $exists: true } });
      expect(stored.graphData.id).toBe(res.body.graphData.id);
    });

    it('update a pushed marker → patches the linked Graph event', async () => {
      const created = await post(adminToken, validMarker({ pushToOutlook: true }));
      const id = created.body._id;
      graphApiMock.clearCallHistory();

      const res = await put(adminToken, id, { ...validMarker(), pushToOutlook: true, name: 'Renamed Holiday' });
      expect(res.status).toBe(200);
      const patches = graphApiMock.getCallHistory('updateCalendarEvent');
      expect(patches.length).toBe(1);
      expect(patches[0].eventData.subject).toBe('Renamed Holiday');
    });

    it('stage → activate: turning pushToOutlook false→true creates the Graph event', async () => {
      const created = await post(adminToken, validMarker({ pushToOutlook: false }));
      const id = created.body._id;
      expect(created.body.graphData).toBeNull();
      graphApiMock.clearCallHistory();

      const res = await put(adminToken, id, { ...validMarker(), pushToOutlook: true });
      expect(res.status).toBe(200);
      expect(graphApiMock.getCallHistory('createCalendarEvent').length).toBe(1);
      expect(res.body.graphData.id).toBeTruthy();
    });

    it('un-push: turning pushToOutlook true→false deletes the Graph event and clears linkage', async () => {
      const created = await post(adminToken, validMarker({ pushToOutlook: true }));
      const id = created.body._id;
      graphApiMock.clearCallHistory();

      const res = await put(adminToken, id, { ...validMarker(), pushToOutlook: false });
      expect(res.status).toBe(200);
      expect(graphApiMock.getCallHistory('deleteCalendarEvent').length).toBe(1);
      expect(res.body.graphData).toBeNull();
    });

    it('delete a pushed marker → deletes the linked Graph event', async () => {
      const created = await post(adminToken, validMarker({ pushToOutlook: true }));
      const id = created.body._id;
      graphApiMock.clearCallHistory();

      const res = await del(adminToken, id);
      expect(res.status).toBe(200);
      expect(graphApiMock.getCallHistory('deleteCalendarEvent').length).toBe(1);
    });

    it('Graph create failure is isolated: marker still persists, error surfaced', async () => {
      graphApiMock.setMockError('createCalendarEvent', new Error('Graph 503'));
      const res = await post(adminToken, validMarker({ pushToOutlook: true }));

      // Marker write succeeds despite the Graph failure
      expect(res.status).toBe(201);
      expect(res.body.graphSyncError).toBe('Graph 503');
      expect(await db.collection(MARKERS_COLLECTION).countDocuments({ active: true })).toBe(1);
      // No linkage stored because the create failed
      const stored = await db.collection(MARKERS_COLLECTION).findOne({});
      expect(stored.graphData).toBeNull();
    });
  });

  describe('Isolation from event surfaces (regression)', () => {
    it('markers do not appear in /api/events/list', async () => {
      await post(adminToken, validMarker());
      // Markers live in a separate collection, so the event list cannot see them.
      const res = await request(app)
        .get('/api/events/list?view=my-events')
        .set('Authorization', `Bearer ${adminToken}`);
      // The list endpoint should never surface a marker document.
      const items = Array.isArray(res.body) ? res.body : res.body?.events || res.body?.items || [];
      expect(items.some((e) => e.type === 'holiday' || e.name === 'Rosh Hashanah')).toBe(false);
    });
  });
});
