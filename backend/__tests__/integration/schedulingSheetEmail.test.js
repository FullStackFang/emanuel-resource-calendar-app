/**
 * Scheduling Sheet email tests (SE-1 to SE-11)
 *
 * POST /api/scheduling-sheets/:id/email against the real server with
 * emailService.sendEmail spied. Covers: one-email-per-person aggregation (day
 * and whole-sheet scope), placeholders being skipped and reported rather than
 * blocking, Promise.allSettled per-recipient failure isolation, the recipients
 * subset, emailLog append + computed staleness (edit-after-send reads stale),
 * the disabled-delivery path that resolves instead of throwing, and the
 * client-rendered PDF attachment with its size guard.
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { setupTestApp } = require('../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../__helpers__/testSetup');
const { createRequester, createAdmin, insertUsers } = require('../__helpers__/userFactory');
const { createMockToken, initTestKeys } = require('../__helpers__/authHelpers');
const { COLLECTIONS } = require('../__helpers__/testConstants');

const emailService = require('../../services/emailService');

const DAYS = 'templeEvents__SchedulingSheetDays';

describe('Scheduling Sheet emails (SE-1 to SE-11)', () => {
  let mongoClient, db, app;
  let adminUser, eventsRequesterUser;
  let adminToken, eventsRequesterToken;
  let sendSpy;

  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  async function createSheet(body = { name: '2026 High Holy Days' }) {
    const res = await request(app).post('/api/scheduling-sheets').set(auth(adminToken)).send(body);
    expect(res.status).toBe(201);
    return res.body;
  }

  async function createDay(sheetId, body) {
    const res = await request(app)
      .post(`/api/scheduling-sheets/${sheetId}/days`)
      .set(auth(adminToken))
      .send(body);
    expect(res.status).toBe(201);
    return res.body;
  }

  async function addColumns(sheetId, day, columns) {
    const res = await request(app)
      .put(`/api/scheduling-sheets/${sheetId}/days/${day._id}/structure`)
      .set(auth(adminToken))
      .send({ expectedVersion: day._version, columns, rows: day.rows });
    expect(res.status).toBe(200);
    return res.body;
  }

  async function putCell(sheetId, dayId, rowId, colId, cell) {
    const res = await request(app)
      .put(`/api/scheduling-sheets/${sheetId}/days/${dayId}/cells/${rowId}/${colId}`)
      .set(auth(adminToken))
      .send({ cell });
    expect(res.status).toBe(200);
    return res.body;
  }

  const person = (name, email, extra = {}) => ({ type: 'person', name, email, ...extra });

  function sendSchedules(sheetId, body, token = adminToken) {
    return request(app)
      .post(`/api/scheduling-sheets/${sheetId}/email`)
      .set(auth(token))
      .send(body);
  }

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('schedulingSheetEmail'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection('templeEvents__SchedulingSheets').deleteMany({});
    await db.collection(DAYS).deleteMany({});

    adminUser = createAdmin();
    eventsRequesterUser = createRequester({
      email: 'eventscoord@emanuelnyc.org',
      displayName: 'Events Coordinator',
      department: 'events',
    });
    await insertUsers(db, [adminUser, eventsRequesterUser]);
    adminToken = await createMockToken(adminUser);
    eventsRequesterToken = await createMockToken(eventsRequesterUser);

    sendSpy = jest.spyOn(emailService, 'sendEmail').mockResolvedValue({ success: true });
  });

  afterEach(() => {
    sendSpy.mockRestore();
  });

  test('SE-1 one email per person aggregates all their cells for the day', async () => {
    const sheet = await createSheet();
    let day = await createDay(sheet._id, { date: '2027-09-11', title: 'Erev RH' });
    day = await addColumns(sheet._id, day, [
      { id: 'c1', name: 'Erev Service' },
      { id: 'c2', name: 'YP Dinner' },
    ]);
    const r1 = day.rows[0].id;
    const r2 = day.rows[1].id;

    await putCell(sheet._id, day._id, r1, 'c1', { segments: [person('Sarah', 'sarah@x.org')] });
    await putCell(sheet._id, day._id, r2, 'c1', { segments: [person('Sarah', 'sarah@x.org')] });
    await putCell(sheet._id, day._id, r1, 'c2', { segments: [person('Sarah', 'sarah@x.org')] });

    const res = await sendSchedules(sheet._id, { dayId: day._id });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const [to, subject, html] = sendSpy.mock.calls[0];
    expect(to).toBe('sarah@x.org');
    expect(subject).toContain('September 11');
    expect(html).toContain('Erev Service');
    expect(html).toContain('YP Dinner');
  });

  test('SE-2 whole-sheet scope sends one email covering all the persons days', async () => {
    const sheet = await createSheet();
    let day1 = await createDay(sheet._id, { date: '2027-09-11' });
    let day2 = await createDay(sheet._id, { date: '2027-09-20' });
    day1 = await addColumns(sheet._id, day1, [{ id: 'c1', name: 'Erev Service' }]);
    day2 = await addColumns(sheet._id, day2, [{ id: 'c1', name: 'Kol Nidre' }]);

    await putCell(sheet._id, day1._id, day1.rows[0].id, 'c1', { segments: [person('A', 'a@x.org')] });
    await putCell(sheet._id, day2._id, day2.rows[0].id, 'c1', { segments: [person('A', 'a@x.org')] });

    const res = await sendSchedules(sheet._id, { wholeSheet: true });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const [, subject, html] = sendSpy.mock.calls[0];
    expect(subject).toContain('2026 High Holy Days');
    expect(html).toContain('September 11');
    expect(html).toContain('September 20');
  });

  // A placeholder has no address. It never withholds the schedule from the
  // people who DO have one — it is skipped and named back to the sender.
  // (Replaces the former 422 UNRESOLVED_PLACEHOLDERS block + admin override.)
  test('SE-3 placeholder in scope is skipped, not blocking, and is reported', async () => {
    const sheet = await createSheet();
    let day = await createDay(sheet._id, { date: '2027-09-11' });
    day = await addColumns(sheet._id, day, [{ id: 'c1', name: 'Erev Service' }]);

    await putCell(sheet._id, day._id, day.rows[0].id, 'c1', {
      segments: [person('A', 'a@x.org'), { type: 'person', name: '@usher_team', placeholder: true }],
    });

    const res = await sendSchedules(sheet._id, { dayId: day._id });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
    expect(res.body.skippedPlaceholders).toEqual(['@usher_team']);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  test('SE-4 a scope of nothing but placeholders sends no mail and says so', async () => {
    const sheet = await createSheet();
    let day = await createDay(sheet._id, { date: '2027-09-11' });
    day = await addColumns(sheet._id, day, [{ id: 'c1', name: 'Erev Service' }]);

    await putCell(sheet._id, day._id, day.rows[0].id, 'c1', {
      segments: [{ type: 'person', name: '@usher_team', placeholder: true }],
    });

    const res = await sendSchedules(sheet._id, { dayId: day._id });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(0);
    expect(res.body.skippedPlaceholders).toEqual(['@usher_team']);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('SE-5 a non-admin events-department manager sends past placeholders too', async () => {
    const sheet = await createSheet();
    let day = await createDay(sheet._id, { date: '2027-09-11' });
    day = await addColumns(sheet._id, day, [{ id: 'c1', name: 'Erev Service' }]);

    await putCell(sheet._id, day._id, day.rows[0].id, 'c1', {
      segments: [person('A', 'a@x.org'), { type: 'person', name: '@usher_team', placeholder: true }],
    });

    const res = await sendSchedules(sheet._id, { dayId: day._id }, eventsRequesterToken);
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
    expect(res.body.skippedPlaceholders).toEqual(['@usher_team']);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  test('SE-6 one bad address of 7 fails alone; emailLog records only successes', async () => {
    const sheet = await createSheet();
    let day = await createDay(sheet._id, { date: '2027-09-11' });
    day = await addColumns(sheet._id, day, [{ id: 'c1', name: 'Erev Service' }]);

    const people = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => person(n.toUpperCase(), `${n}@x.org`));
    await putCell(sheet._id, day._id, day.rows[0].id, 'c1', { segments: people });

    sendSpy.mockImplementation(async (to) => {
      if (to === 'd@x.org') throw new Error('mailbox unavailable');
      return { success: true };
    });

    const res = await sendSchedules(sheet._id, { dayId: day._id });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(6);
    expect(res.body.failed).toBe(1);
    const failure = res.body.results.find((r) => !r.success);
    expect(failure.email).toBe('d@x.org');
    expect(failure.error).toBe('mailbox unavailable');

    const stored = await db.collection(DAYS).findOne({ _id: new ObjectId(String(day._id)) });
    const loggedEmails = stored.emailLog.map((e) => e.email).sort();
    expect(loggedEmails).toEqual(['a@x.org', 'b@x.org', 'c@x.org', 'e@x.org', 'f@x.org', 'g@x.org']);
  });

  test('SE-7 emailStatus reads sent-fresh after a send and stale after a later edit', async () => {
    const sheet = await createSheet();
    let day = await createDay(sheet._id, { date: '2027-09-11' });
    day = await addColumns(sheet._id, day, [{ id: 'c1', name: 'Erev Service' }]);
    await putCell(sheet._id, day._id, day.rows[0].id, 'c1', { segments: [person('A', 'a@x.org')] });

    await sendSchedules(sheet._id, { dayId: day._id });

    let sheetRes = await request(app).get(`/api/scheduling-sheets/${sheet._id}`).set(auth(adminToken));
    let status = sheetRes.body.days[0].emailStatus.find((s) => s.email === 'a@x.org');
    expect(status.sentAt).toBeTruthy();
    expect(status.stale).toBe(false);

    await new Promise((r) => setTimeout(r, 15));
    await putCell(sheet._id, day._id, day.rows[1].id, 'c1', { segments: [{ type: 'text', text: '17:00' }] });

    sheetRes = await request(app).get(`/api/scheduling-sheets/${sheet._id}`).set(auth(adminToken));
    status = sheetRes.body.days[0].emailStatus.find((s) => s.email === 'a@x.org');
    expect(status.stale).toBe(true);
  });

  test('SE-8 recipients subset restricts the fan-out', async () => {
    const sheet = await createSheet();
    let day = await createDay(sheet._id, { date: '2027-09-11' });
    day = await addColumns(sheet._id, day, [{ id: 'c1', name: 'Erev Service' }]);
    await putCell(sheet._id, day._id, day.rows[0].id, 'c1', {
      segments: [person('A', 'a@x.org'), person('B', 'b@x.org')],
    });

    const res = await sendSchedules(sheet._id, { dayId: day._id, recipients: ['B@X.org'] });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0]).toBe('b@x.org');
  });

  // sendEmail RESOLVES with { skipped: true } when delivery is disabled in
  // system settings — it does not throw. Counting that as a send would stamp
  // an emailLog entry (and therefore a 'sent' pill) for mail nobody received.
  test('SE-9 delivery disabled reports not-sent and writes no emailLog', async () => {
    const sheet = await createSheet();
    let day = await createDay(sheet._id, { date: '2027-09-11' });
    day = await addColumns(sheet._id, day, [{ id: 'c1', name: 'Erev Service' }]);
    await putCell(sheet._id, day._id, day.rows[0].id, 'c1', { segments: [person('A', 'a@x.org')] });

    sendSpy.mockResolvedValue({ success: true, skipped: true });

    const res = await sendSchedules(sheet._id, { dayId: day._id });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(0);
    expect(res.body.skipped).toBe(1);
    expect(res.body.failed).toBe(0);
    expect(res.body.results[0]).toMatchObject({ email: 'a@x.org', success: false, skipped: true });

    const sheetRes = await request(app).get(`/api/scheduling-sheets/${sheet._id}`).set(auth(adminToken));
    const status = (sheetRes.body.days[0].emailStatus || []).find((s) => s.email === 'a@x.org');
    expect(status && status.sentAt).toBeFalsy();
  });

  test('SE-10 a client-rendered PDF rides along on every recipient email', async () => {
    const sheet = await createSheet();
    let day = await createDay(sheet._id, { date: '2027-09-11' });
    day = await addColumns(sheet._id, day, [{ id: 'c1', name: 'Erev Service' }]);
    await putCell(sheet._id, day._id, day.rows[0].id, 'c1', {
      segments: [person('A', 'a@x.org'), person('B', 'b@x.org')],
    });

    const contentBase64 = Buffer.from('%PDF-1.4 pretend').toString('base64');
    const res = await sendSchedules(sheet._id, {
      dayId: day._id,
      // Path separators and odd characters must not survive into the name a
      // mail client hands to a save dialog.
      attachment: { fileName: '../../2026 High Holy Days*.pdf', contentBase64 },
    });

    expect(res.status).toBe(200);
    expect(res.body.attached).toBe(true);
    expect(res.body.attachmentWarning).toBeUndefined();
    expect(sendSpy).toHaveBeenCalledTimes(2);
    for (const call of sendSpy.mock.calls) {
      expect(call[3].attachments).toEqual([
        { name: '2026 High Holy Days.pdf', contentType: 'application/pdf', contentBase64 },
      ]);
    }
  });

  test('SE-11 an oversized attachment warns but never withholds the schedules', async () => {
    const sheet = await createSheet();
    let day = await createDay(sheet._id, { date: '2027-09-11' });
    day = await addColumns(sheet._id, day, [{ id: 'c1', name: 'Erev Service' }]);
    await putCell(sheet._id, day._id, day.rows[0].id, 'c1', { segments: [person('A', 'a@x.org')] });

    const res = await sendSchedules(sheet._id, {
      dayId: day._id,
      attachment: { fileName: 'huge.pdf', contentBase64: 'A'.repeat(4_200_000) },
    });

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
    expect(res.body.attached).toBe(false);
    expect(res.body.attachmentWarning).toMatch(/over the 3MB mail limit/i);
    expect(sendSpy.mock.calls[0][3].attachments).toBeUndefined();
  });
});
