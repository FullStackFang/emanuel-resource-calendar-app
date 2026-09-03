/**
 * Scheduling Sheets integration tests (SS-1 to SS-26)
 *
 * Covers the workbook/day/grid route family against the REAL api-server via
 * createAppForTest:
 *   - the requireAssignmentManager gate (DB re-fetch, not JWT claims)
 *   - workbook + day CRUD (starter-row seeding, DUPLICATE_DATE, cross-workbook
 *     same-date, cascade delete)
 *   - structural OCC (409 VERSION_CONFLICT envelope) vs ungated cell writes
 *   - server-side taggedEmails recomputation (client input ignored)
 *   - copy-a-day / copy-a-workbook (emailLog reset, date-order mapping)
 *   - user-lookup gated by the assignment gate itself (NOT canManageUsers) —
 *     the regression this guards: GET /api/users would 403 an Events-dept
 *     requester whom this feature deliberately admits
 *   - GET /api/my-assignments derivation (own cells only, call-time override)
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { setupTestApp } = require('../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../__helpers__/testSetup');
const {
  createRequester,
  createApprover,
  createAdmin,
  createViewer,
  insertUsers,
} = require('../__helpers__/userFactory');
const { createMockToken, initTestKeys } = require('../__helpers__/authHelpers');
const { COLLECTIONS } = require('../__helpers__/testConstants');

const SHEETS = 'templeEvents__SchedulingSheets';
const DAYS = 'templeEvents__SchedulingSheetDays';

describe('Scheduling Sheets (SS-1 to SS-26)', () => {
  let mongoClient, db, app;
  let adminUser, approverUser, eventsRequesterUser, viewerUser;
  let adminToken, approverToken, eventsRequesterToken, viewerToken;

  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  async function createSheet(token, body = { name: '2026 High Holy Days' }) {
    const res = await request(app).post('/api/scheduling-sheets').set(auth(token)).send(body);
    expect(res.status).toBe(201);
    return res.body;
  }

  async function createDay(token, sheetId, body) {
    const res = await request(app)
      .post(`/api/scheduling-sheets/${sheetId}/days`)
      .set(auth(token))
      .send(body);
    expect(res.status).toBe(201);
    return res.body;
  }

  async function putCell(token, sheetId, dayId, rowId, colId, cell) {
    return request(app)
      .put(`/api/scheduling-sheets/${sheetId}/days/${dayId}/cells/${rowId}/${colId}`)
      .set(auth(token))
      .send({ cell });
  }

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('schedulingSheets'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(SHEETS).deleteMany({});
    await db.collection(DAYS).deleteMany({});

    adminUser = createAdmin();
    approverUser = createApprover({ department: 'facilities' });
    // The feature's target persona: a REQUESTER whose events-department grant
    // lives only in the DB record — the JWT carries no department claim.
    eventsRequesterUser = createRequester({
      email: 'eventscoord@emanuelnyc.org',
      displayName: 'Events Coordinator',
      department: 'events',
    });
    viewerUser = createViewer();
    await insertUsers(db, [adminUser, approverUser, eventsRequesterUser, viewerUser]);

    adminToken = await createMockToken(adminUser);
    approverToken = await createMockToken(approverUser);
    eventsRequesterToken = await createMockToken(eventsRequesterUser);
    viewerToken = await createMockToken(viewerUser);
  });

  // -------------------------------------------------------------------------
  // Gate (SS-1..4)
  // -------------------------------------------------------------------------

  test('SS-1 events-department requester is admitted (department read from DB, not token)', async () => {
    const res = await request(app).get('/api/scheduling-sheets').set(auth(eventsRequesterToken));
    expect(res.status).toBe(200);
  });

  test('SS-2 non-events approver is rejected', async () => {
    const res = await request(app).get('/api/scheduling-sheets').set(auth(approverToken));
    expect(res.status).toBe(403);
  });

  test('SS-3 admin is admitted', async () => {
    const res = await request(app).get('/api/scheduling-sheets').set(auth(adminToken));
    expect(res.status).toBe(200);
  });

  test('SS-4 viewer without a department is rejected on writes too', async () => {
    const res = await request(app)
      .post('/api/scheduling-sheets')
      .set(auth(viewerToken))
      .send({ name: 'Nope' });
    expect(res.status).toBe(403);
  });

  // -------------------------------------------------------------------------
  // Workbook CRUD (SS-5..8)
  // -------------------------------------------------------------------------

  test('SS-5 create workbook returns audit fields and id', async () => {
    const sheet = await createSheet(eventsRequesterToken);
    expect(sheet._id).toBeDefined();
    expect(sheet.name).toBe('2026 High Holy Days');
    expect(sheet.createdBy).toBe('eventscoord@emanuelnyc.org');
    expect(sheet.days).toEqual([]);
  });

  test('SS-6 create without a name is rejected', async () => {
    const res = await request(app)
      .post('/api/scheduling-sheets')
      .set(auth(adminToken))
      .send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  test('SS-7 rename round-trips', async () => {
    const sheet = await createSheet(adminToken);
    const res = await request(app)
      .put(`/api/scheduling-sheets/${sheet._id}`)
      .set(auth(adminToken))
      .send({ name: '2027 High Holy Days' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('2027 High Holy Days');
  });

  test('SS-8 delete cascades to day docs', async () => {
    const sheet = await createSheet(adminToken, { name: 'Doomed', seedDates: ['2027-09-01', '2027-09-02', '2027-09-03'] });
    expect(sheet.days).toHaveLength(3);

    const res = await request(app)
      .delete(`/api/scheduling-sheets/${sheet._id}`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);

    expect(await db.collection(SHEETS).countDocuments({})).toBe(0);
    expect(await db.collection(DAYS).countDocuments({})).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Day CRUD (SS-9..12)
  // -------------------------------------------------------------------------

  test('SS-9 new day seeds the five starter rows in order with no columns', async () => {
    const sheet = await createSheet(adminToken);
    const day = await createDay(adminToken, sheet._id, { date: '2027-09-11', title: '2027 Erev Rosh Hashanah' });

    expect(day.rows.map((r) => r.label)).toEqual(['Location', 'Call Time', 'Doors Open', 'Begins', 'Ends']);
    expect(day.rows.every((r) => r.kind === 'starter')).toBe(true);
    expect(day.columns).toEqual([]);
    expect(day.cells).toEqual({});
    expect(day._version).toBe(1);
  });

  test('SS-10 duplicate date within one workbook is rejected with DUPLICATE_DATE', async () => {
    const sheet = await createSheet(adminToken);
    await createDay(adminToken, sheet._id, { date: '2027-09-11' });

    const res = await request(app)
      .post(`/api/scheduling-sheets/${sheet._id}/days`)
      .set(auth(adminToken))
      .send({ date: '2027-09-11' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DUPLICATE_DATE');
  });

  test('SS-11 the same date is allowed in a different workbook', async () => {
    const a = await createSheet(adminToken, { name: 'High Holy Days' });
    const b = await createSheet(adminToken, { name: 'Annual Coverage' });
    await createDay(adminToken, a._id, { date: '2027-09-11' });
    await createDay(adminToken, b._id, { date: '2027-09-11' });
    expect(await db.collection(DAYS).countDocuments({ date: '2027-09-11' })).toBe(2);
  });

  test('SS-12 delete day removes only that day', async () => {
    const sheet = await createSheet(adminToken, { name: 'S', seedDates: ['2027-09-11', '2027-09-12'] });
    const dayId = sheet.days[0]._id;
    const res = await request(app)
      .delete(`/api/scheduling-sheets/${sheet._id}/days/${dayId}`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(await db.collection(DAYS).countDocuments({})).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Structural OCC (SS-13..14)
  // -------------------------------------------------------------------------

  test('SS-13 structural update with the current version succeeds and bumps _version', async () => {
    const sheet = await createSheet(adminToken);
    const day = await createDay(adminToken, sheet._id, { date: '2027-09-11' });

    const res = await request(app)
      .put(`/api/scheduling-sheets/${sheet._id}/days/${day._id}/structure`)
      .set(auth(adminToken))
      .send({
        expectedVersion: 1,
        columns: [{ id: 'c1', name: 'Erev Service' }],
        rows: [...day.rows, { id: 'r-custom', label: 'Security walkie channel', kind: 'custom' }],
      });

    expect(res.status).toBe(200);
    expect(res.body._version).toBe(2);
    expect(res.body.columns).toHaveLength(1);
    expect(res.body.rows.at(-1).label).toBe('Security walkie channel');
  });

  test('SS-14 stale expectedVersion returns the standard VERSION_CONFLICT envelope', async () => {
    const sheet = await createSheet(adminToken);
    const day = await createDay(adminToken, sheet._id, { date: '2027-09-11' });

    await request(app)
      .put(`/api/scheduling-sheets/${sheet._id}/days/${day._id}/structure`)
      .set(auth(adminToken))
      .send({ expectedVersion: 1, title: 'First writer wins' });

    const res = await request(app)
      .put(`/api/scheduling-sheets/${sheet._id}/days/${day._id}/structure`)
      .set(auth(adminToken))
      .send({ expectedVersion: 1, title: 'Second writer loses' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.details.code).toBe('VERSION_CONFLICT');
    expect(res.body.details.currentVersion).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Cell writes (SS-15..19)
  // -------------------------------------------------------------------------

  test('SS-15 cell write persists and recomputes taggedEmails lowercased', async () => {
    const sheet = await createSheet(adminToken);
    const day = await createDay(adminToken, sheet._id, { date: '2027-09-11' });
    const rowId = day.rows[0].id;

    const res = await putCell(adminToken, sheet._id, day._id, rowId, 'c1', {
      segments: [{ type: 'person', name: 'Sarah Levine', email: 'Sarah@EmanuelNYC.org' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.taggedEmails).toEqual(['sarah@emanuelnyc.org']);
    expect(res.body.cells[`${rowId}:c1`].segments[0].email).toBe('sarah@emanuelnyc.org');
  });

  test('SS-16 invalid segment type is rejected and the cell is unchanged', async () => {
    const sheet = await createSheet(adminToken);
    const day = await createDay(adminToken, sheet._id, { date: '2027-09-11' });

    const res = await putCell(adminToken, sheet._id, day._id, day.rows[0].id, 'c1', {
      segments: [{ type: 'formula', text: '=SUM(A1)' }],
    });
    expect(res.status).toBe(400);

    const stored = await db.collection(DAYS).findOne({ _id: new ObjectId(String(day._id)) });
    expect(stored.cells).toEqual({});
  });

  test('SS-17 concurrent writes to different cells both persist (no version gate)', async () => {
    const sheet = await createSheet(adminToken);
    const day = await createDay(adminToken, sheet._id, { date: '2027-09-11' });
    const [r1, r2] = [day.rows[0].id, day.rows[1].id];

    const [a, b] = await Promise.all([
      putCell(adminToken, sheet._id, day._id, r1, 'c1', {
        segments: [{ type: 'person', name: 'A', email: 'a@x.org' }],
      }),
      putCell(adminToken, sheet._id, day._id, r2, 'c1', {
        segments: [{ type: 'person', name: 'B', email: 'b@x.org' }],
      }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const stored = await db.collection(DAYS).findOne({ _id: new ObjectId(String(day._id)) });
    expect(Object.keys(stored.cells).sort()).toEqual([`${r1}:c1`, `${r2}:c1`].sort());
    expect(stored._version).toBe(3); // 1 + two ungated increments
  });

  test('SS-18 clearing a cell removes the key and its email from taggedEmails', async () => {
    const sheet = await createSheet(adminToken);
    const day = await createDay(adminToken, sheet._id, { date: '2027-09-11' });
    const rowId = day.rows[0].id;

    await putCell(adminToken, sheet._id, day._id, rowId, 'c1', {
      segments: [{ type: 'person', name: 'A', email: 'a@x.org' }],
    });
    const res = await putCell(adminToken, sheet._id, day._id, rowId, 'c1', { segments: [] });
    expect(res.status).toBe(200);
    expect(res.body.taggedEmails).toEqual([]);
    expect(res.body.cells).toEqual({});
  });

  test('SS-19 client-supplied taggedEmails are ignored — the stored array is derived', async () => {
    const sheet = await createSheet(adminToken);
    const day = await createDay(adminToken, sheet._id, { date: '2027-09-11' });

    const res = await request(app)
      .put(`/api/scheduling-sheets/${sheet._id}/days/${day._id}/cells/${day.rows[0].id}/c1`)
      .set(auth(adminToken))
      .send({
        cell: { segments: [{ type: 'text', text: 'no people here' }] },
        taggedEmails: ['spoofed@x.org'],
      });
    expect(res.status).toBe(200);
    expect(res.body.taggedEmails).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Copies (SS-20..21)
  // -------------------------------------------------------------------------

  test('SS-20 copy-a-day carries structure, cells, and people but resets emailLog', async () => {
    const sheet = await createSheet(adminToken);
    const day = await createDay(adminToken, sheet._id, { date: '2027-09-11', title: 'Erev RH' });
    await putCell(adminToken, sheet._id, day._id, day.rows[0].id, 'c1', {
      segments: [{ type: 'person', name: 'A', email: 'a@x.org' }],
    });
    await db.collection(DAYS).updateOne(
      { _id: new ObjectId(String(day._id)) },
      { $push: { emailLog: { email: 'a@x.org', sentAt: new Date().toISOString(), sentBy: 'admin@emanuelnyc.org' } } }
    );

    const copy = await createDay(adminToken, sheet._id, { date: '2028-09-29', copyFromDayId: day._id });
    expect(copy.title).toBe('Erev RH');
    expect(copy.taggedEmails).toEqual(['a@x.org']);
    expect(Object.keys(copy.cells)).toHaveLength(1);
    expect(copy.emailLog).toEqual([]);
    expect(copy._version).toBe(1);
  });

  test('SS-21 copy-a-workbook maps source days onto seeded dates in order; extra dates become blank days', async () => {
    const source = await createSheet(adminToken, { name: '2026', seedDates: ['2027-09-11', '2027-09-20'] });
    await request(app)
      .put(`/api/scheduling-sheets/${source._id}/days/${source.days[0]._id}/structure`)
      .set(auth(adminToken))
      .send({ expectedVersion: 1, columns: [{ id: 'c1', name: 'Erev Service' }] });

    const copy = await request(app)
      .post('/api/scheduling-sheets')
      .set(auth(adminToken))
      .send({ name: '2027', seedDates: ['2028-09-29', '2028-10-08', '2028-10-09'], copyFromSheetId: source._id });
    expect(copy.status).toBe(201);

    const days = copy.body.days;
    expect(days.map((d) => d.date)).toEqual(['2028-09-29', '2028-10-08', '2028-10-09']);
    expect(days[0].columns).toHaveLength(1); // carried from first source day
    expect(days[2].columns).toEqual([]); // extra target date: blank seeded day
    expect(days[2].rows.map((r) => r.label)).toEqual(['Location', 'Call Time', 'Doors Open', 'Begins', 'Ends']);
  });

  // -------------------------------------------------------------------------
  // user-lookup (SS-22..23)
  // -------------------------------------------------------------------------

  test('SS-22 events-dept requester can use the lookup (regression guard vs canManageUsers-gated /api/users)', async () => {
    const res = await request(app)
      .get('/api/scheduling-sheets/user-lookup?q=events coordinator')
      .set(auth(eventsRequesterToken));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.matches[0].email).toBe('eventscoord@emanuelnyc.org');
    expect(res.body.matches[0].userId).toBeDefined();
  });

  test('SS-23 non-manager cannot use the lookup', async () => {
    const res = await request(app)
      .get('/api/scheduling-sheets/user-lookup?q=a')
      .set(auth(viewerToken));
    expect(res.status).toBe(403);
  });

  // -------------------------------------------------------------------------
  // my-assignments (SS-24..26)
  // -------------------------------------------------------------------------

  test('SS-24 returns only the callers cells with effective call time (override wins, column fallback otherwise)', async () => {
    const sheet = await createSheet(adminToken, { name: '2027 High Holy Days' });
    const day = await createDay(adminToken, sheet._id, { date: '2027-09-30', title: 'Erev RH' });
    const callTimeRow = day.rows.find((r) => r.label === 'Call Time');
    const customRes = await request(app)
      .put(`/api/scheduling-sheets/${sheet._id}/days/${day._id}/structure`)
      .set(auth(adminToken))
      .send({
        expectedVersion: 1,
        columns: [{ id: 'c1', name: 'Erev Service' }, { id: 'c2', name: 'YP Dinner' }],
        rows: [...day.rows, { id: 'r-ushers', label: 'Ushers', kind: 'custom' }],
      });
    expect(customRes.status).toBe(200);

    // Column call time for c1
    await putCell(adminToken, sheet._id, day._id, callTimeRow.id, 'c1', {
      segments: [{ type: 'text', text: '16:30' }],
    });
    // Caller in c1 (no override → column call time) and c2 (override wins)
    await putCell(adminToken, sheet._id, day._id, 'r-ushers', 'c1', {
      segments: [{ type: 'person', name: 'Events Coordinator', email: 'eventscoord@emanuelnyc.org' }],
    });
    await putCell(adminToken, sheet._id, day._id, 'r-ushers', 'c2', {
      segments: [{ type: 'person', name: 'Events Coordinator', email: 'eventscoord@emanuelnyc.org', callTimeOverride: '16:00' }],
      note: { text: 'Bring the walkie', authorName: 'Admin', at: '2027-09-01T00:00:00Z' },
    });
    // Someone else's cell must NOT appear for the caller
    await putCell(adminToken, sheet._id, day._id, 'r-ushers', 'c1', {
      segments: [
        { type: 'person', name: 'Events Coordinator', email: 'eventscoord@emanuelnyc.org' },
        { type: 'person', name: 'Other Person', email: 'other@x.org' },
      ],
    });

    const res = await request(app).get('/api/my-assignments').set(auth(eventsRequesterToken));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const byCol = Object.fromEntries(res.body.map((a) => [a.columnName, a]));
    expect(byCol['Erev Service'].callTime).toBe('16:30');
    expect(byCol['Erev Service'].rowLabel).toBe('Ushers');
    expect(byCol['Erev Service'].sheetName).toBe('2027 High Holy Days');
    expect(byCol['YP Dinner'].callTime).toBe('16:00');
    expect(byCol['YP Dinner'].note).toBe('Bring the walkie');
    // No leakage of other people's data shape
    expect(JSON.stringify(res.body)).not.toContain('other@x.org');
  });

  test('SS-25 matches case-insensitively against the stored lowercase chips', async () => {
    const sheet = await createSheet(adminToken);
    const day = await createDay(adminToken, sheet._id, { date: '2027-09-30' });
    await putCell(adminToken, sheet._id, day._id, day.rows[0].id, 'c1', {
      segments: [{ type: 'person', name: 'EC', email: 'EventsCoord@EmanuelNYC.org' }],
    });

    const res = await request(app).get('/api/my-assignments').set(auth(eventsRequesterToken));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('SS-26 untagged user gets an empty list, not an error', async () => {
    const res = await request(app).get('/api/my-assignments').set(auth(viewerToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Workbook list ordering (SS-27)
  // -------------------------------------------------------------------------

  // GET /api/scheduling-sheets orders in memory, because Cosmos rejects an
  // order-by on a non-prefix index path and neither of its two UNFILTERED reads
  // has a usable index (the sheets collection has none; `date` is the second
  // key of both day indexes). This test cannot reproduce that failure —
  // MongoDB Memory Server honours any sort — so it locks the ORDERING the
  // in-memory sort has to keep producing.
  test('SS-27 workbooks come back name-ordered and their days date-ordered', async () => {
    const zulu = await createSheet(adminToken, { name: 'Zulu Retreat' });
    const alpha = await createSheet(adminToken, { name: 'Alpha Weekend' });

    // Insert out of chronological order so a dropped sort is visible.
    await createDay(adminToken, zulu._id, { date: '2026-10-05' });
    await createDay(adminToken, zulu._id, { date: '2026-09-11' });
    await createDay(adminToken, zulu._id, { date: '2026-09-30' });
    await createDay(adminToken, alpha._id, { date: '2026-03-02' });

    const res = await request(app).get('/api/scheduling-sheets').set(auth(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.map((s) => s.name)).toEqual(['Alpha Weekend', 'Zulu Retreat']);

    const zuluRow = res.body.find((s) => s.name === 'Zulu Retreat');
    expect(zuluRow.days.map((d) => d.date)).toEqual(['2026-09-11', '2026-09-30', '2026-10-05']);
  });
});
