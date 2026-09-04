/**
 * Scheduling Sheet email tests (SE-1 to SE-24)
 *
 * POST /api/scheduling-sheets/:id/email against the real server with
 * emailService.sendEmail spied. Covers: one-email-per-person aggregation (day
 * and whole-sheet scope), placeholders being skipped and reported rather than
 * blocking, Promise.allSettled per-recipient failure isolation, the recipients
 * subset, emailLog append + computed staleness (edit-after-send reads stale),
 * the disabled-delivery path that resolves instead of throwing, and the
 * client-rendered PDF attachment with its size guard, and the per-recipient
 * .ics calendar attachment (scope, opt-out default, identity, failure isolation).
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { setupTestApp } = require('../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../__helpers__/testSetup');
const { createRequester, createAdmin, insertUsers } = require('../__helpers__/userFactory');
const { createMockToken, initTestKeys } = require('../__helpers__/authHelpers');
const { COLLECTIONS } = require('../__helpers__/testConstants');

const emailService = require('../../services/emailService');
const icsBuilder = require('../../utils/icsBuilder');

const DAYS = 'templeEvents__SchedulingSheetDays';

describe('Scheduling Sheet emails (SE-1 to SE-24)', () => {
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
    // Both days get their own heading. The short 'Saturday, Sep 11' form is
    // the standard one now; the long 'September 11, 2027' wrapped its column.
    expect(html).toContain('Saturday, Sep 11');
    expect(html).toContain('Monday, Sep 20');
    expect(html).toContain('Erev Service');
    expect(html).toContain('Kol Nidre');
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

  // --------------------------------------------------------------------------
  // SE-12..SE-16 — the email BODY. SE-1..SE-11 above cover fan-out, logging and
  // attachments and deliberately say almost nothing about what the message
  // reads like, which is how the dropped-location defect survived: the Location
  // starter row holds `location` segments, and the server's own text extractor
  // kept only `text` segments, so a cell holding two location chips plus a
  // stray '6:00 PM' reported its location as '6:00 PM'.
  // --------------------------------------------------------------------------

  const loc = (name) => ({ type: 'location', name });
  const text = (t) => ({ type: 'text', text: t });

  /**
   * A day with one column and one CUSTOM row ('Greeter') below the five
   * starter rows, so a person chip can sit on a real post rather than on a
   * metadata row the extractor also reads back.
   */
  async function dayWithMetadata(sheet, { date = '2027-09-11', title = 'Erev Rosh Hashanah' } = {}) {
    let day = await createDay(sheet._id, { date, title });
    const res = await request(app)
      .put(`/api/scheduling-sheets/${sheet._id}/days/${day._id}/structure`)
      .set(auth(adminToken))
      .send({
        expectedVersion: day._version,
        columns: [{ id: 'c1', name: 'Erev Service' }],
        rows: [...day.rows, { id: 'rGreeter', label: 'Greeter', kind: 'custom' }],
      });
    expect(res.status).toBe(200);
    day = res.body;
    const rowId = (label) => day.rows.find((r) => r.label === label).id;
    return { day, rowId };
  }

  test('SE-12 location chips reach the email, one per line, with stray text after them', async () => {
    const sheet = await createSheet();
    const { day, rowId } = await dayWithMetadata(sheet);

    // The exact reported shape: two location chips and a loose time in the
    // Location row.
    await putCell(sheet._id, day._id, rowId('Location'), 'c1', {
      segments: [loc('5th Avenue Sanctuary'), loc('Live Stream - Temple'), text('6:00 PM')],
    });
    await putCell(sheet._id, day._id, rowId('Greeter'), 'c1', {
      segments: [person('Stephen Fang', 'stephen.fang@emanuelnyc.org')],
    });

    const res = await sendSchedules(sheet._id, { dayId: day._id });
    expect(res.status).toBe(200);

    const html = sendSpy.mock.calls[0][2];
    expect(html).toContain('5th Avenue Sanctuary');
    expect(html).toContain('Live Stream - Temple');
    // One per line, locations before the loose text.
    expect(html).toMatch(/5th Avenue Sanctuary<br>Live Stream - Temple<br>6:00 PM/);
  });

  test('SE-13 call time and the event window both appear; neither displaces the other', async () => {
    const sheet = await createSheet();
    const { day, rowId } = await dayWithMetadata(sheet);

    await putCell(sheet._id, day._id, rowId('Call Time'), 'c1', { segments: [text('5:00 PM')] });
    await putCell(sheet._id, day._id, rowId('Begins'), 'c1', { segments: [text('6:00 PM')] });
    await putCell(sheet._id, day._id, rowId('Ends'), 'c1', { segments: [text('7:30 PM')] });

    await putCell(sheet._id, day._id, rowId('Greeter'), 'c1', {
      segments: [person('Stephen Fang', 'stephen.fang@emanuelnyc.org')],
    });

    const res = await sendSchedules(sheet._id, { dayId: day._id });
    expect(res.status).toBe(200);

    const html = sendSpy.mock.calls[0][2];
    expect(html).toContain('5:00 PM');
    expect(html).toMatch(/6:00 PM\s*&ndash;\s*7:30 PM/);
  });

  test('SE-14 day headings use the short standardized date, not the long wrapping one', async () => {
    const sheet = await createSheet();
    const { day, rowId } = await dayWithMetadata(sheet);
    await putCell(sheet._id, day._id, rowId('Greeter'), 'c1', {
      segments: [person('Stephen Fang', 'stephen.fang@emanuelnyc.org')],
    });

    const res = await sendSchedules(sheet._id, { wholeSheet: true });
    expect(res.status).toBe(200);

    const html = sendSpy.mock.calls[0][2];
    expect(html).toContain('Saturday, Sep 11');
    // The long form no longer appears anywhere in a whole-sheet body: the h2 is
    // the workbook name, and every day heading is short.
    expect(html).not.toContain('September 11, 2027');
    // The day's own title rides along with its heading.
    expect(html).toContain('Erev Rosh Hashanah');
  });

  test('SE-15 the corrected location also reaches GET /api/my-assignments', async () => {
    const sheet = await createSheet();
    const { day, rowId } = await dayWithMetadata(sheet, { date: '2099-09-11' });

    await putCell(sheet._id, day._id, rowId('Location'), 'c1', {
      segments: [loc('5th Avenue Sanctuary'), loc('Live Stream - Temple')],
    });
    await putCell(sheet._id, day._id, rowId('Greeter'), 'c1', {
      segments: [person('Events Coordinator', eventsRequesterUser.email)],
    });

    const res = await request(app).get('/api/my-assignments').set(auth(eventsRequesterToken));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].location).toBe('5th Avenue Sanctuary, Live Stream - Temple');
    expect(res.body[0].locationLines).toEqual(['5th Avenue Sanctuary', 'Live Stream - Temple']);
  });

  test('SE-17 a per-person HH:MM override prints on the same clock as the sheet, free text untouched', async () => {
    const sheet = await createSheet();
    const { day, rowId } = await dayWithMetadata(sheet);

    // The column call time is free text a manager typed; the override is the
    // HH:MM the cell editor stores. Both land in the same slot of the email.
    await putCell(sheet._id, day._id, rowId('Call Time'), 'c1', {
      segments: [text('HD 4:30pm / Reg 4:45pm')],
    });
    await putCell(sheet._id, day._id, rowId('Greeter'), 'c1', {
      segments: [person('Stephen Fang', 'stephen.fang@emanuelnyc.org', { callTimeOverride: '17:30' })],
    });

    const res = await sendSchedules(sheet._id, { dayId: day._id });
    expect(res.status).toBe(200);

    const html = sendSpy.mock.calls[0][2];
    expect(html).toContain('5:30 PM');
    expect(html).not.toContain('17:30');

    // Free text is never parsed: it can hold two times and a label at once.
    await putCell(sheet._id, day._id, rowId('Greeter'), 'c1', {
      segments: [person('Stephen Fang', 'stephen.fang@emanuelnyc.org')],
    });
    sendSpy.mockClear();
    await sendSchedules(sheet._id, { dayId: day._id });
    expect(sendSpy.mock.calls[0][2]).toContain('HD 4:30pm / Reg 4:45pm');
  });

  test('SE-16 a schedule spanning two years carries the year in every day heading', async () => {
    const sheet = await createSheet({ name: 'Winter Coverage' });
    const a = await dayWithMetadata(sheet, { date: '2027-12-31', title: 'New Year Eve' });
    const b = await dayWithMetadata(sheet, { date: '2028-01-01', title: 'New Year Day' });

    for (const { day, rowId } of [a, b]) {
      await putCell(sheet._id, day._id, rowId('Greeter'), 'c1', {
        segments: [person('Stephen Fang', 'stephen.fang@emanuelnyc.org')],
      });
    }

    const res = await sendSchedules(sheet._id, { wholeSheet: true });
    expect(res.status).toBe(200);

    const html = sendSpy.mock.calls[0][2];
    expect(html).toContain('Friday, Dec 31, 2027');
    expect(html).toContain('Saturday, Jan 1, 2028');
  });
  // --------------------------------------------------------------------------
  // SE-18..SE-24 - the per-recipient CALENDAR attachment. Unlike the workbook
  // PDF, which is one identical blob built once and attached to every message,
  // the .ics differs per person and is therefore built inside the fan-out. The
  // format itself is covered by unit/utils/icsBuilder.test.js; what these
  // assert is the wiring: scoping, the opt-out default, identity across sends,
  // and that a broken file never withholds anybody's schedule.
  // --------------------------------------------------------------------------

  /** The decoded .ics from one sendEmail call, or null if none rode along. */
  function calendarFrom(call) {
    const att = ((call[3] || {}).attachments || []).find(
      (a) => typeof a.contentType === 'string' && a.contentType.startsWith('text/calendar')
    );
    return att ? Buffer.from(att.contentBase64, 'base64').toString('utf8') : null;
  }

  /** Logical (unfolded) lines, so assertions read as the file does. */
  const linesOf = (ics) => ics.replace(/\r\n /g, '').split('\r\n');
  const propsOf = (ics, name) =>
    linesOf(ics).filter((l) => l.startsWith(name + ':')).map((l) => l.slice(name.length + 1));
  const callFor = (email) => sendSpy.mock.calls.find((c) => c[0] === email);

  test('SE-18 a day-scoped send gives each recipient a file of only their own shifts', async () => {
    const sheet = await createSheet();
    const { day, rowId } = await dayWithMetadata(sheet);

    await putCell(sheet._id, day._id, rowId('Call Time'), 'c1', { segments: [text('4:30 PM')] });
    await putCell(sheet._id, day._id, rowId('Begins'), 'c1', { segments: [text('6:00 PM')] });
    await putCell(sheet._id, day._id, rowId('Ends'), 'c1', { segments: [text('8:00 PM')] });
    await putCell(sheet._id, day._id, rowId('Location'), 'c1', { segments: [loc('5th Avenue Sanctuary')] });
    await putCell(sheet._id, day._id, rowId('Greeter'), 'c1', {
      segments: [person('Sarah', 'sarah@x.org'), person('Ben', 'ben@x.org')],
    });
    await putCell(sheet._id, day._id, rowId('Doors Open'), 'c1', {
      segments: [person('Sarah', 'sarah@x.org')],
    });

    const res = await sendSchedules(sheet._id, { dayId: day._id, includeCalendar: true });
    expect(res.status).toBe(200);
    expect(res.body.calendarAttached).toBe(true);
    expect(res.body.calendarWarning).toBeUndefined();
    expect(sendSpy).toHaveBeenCalledTimes(2);

    const sarah = calendarFrom(callFor('sarah@x.org'));
    const ben = calendarFrom(callFor('ben@x.org'));

    // Sarah is on two posts, Ben on one. Neither sees the other's file.
    expect(linesOf(sarah).filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2);
    expect(linesOf(ben).filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(sarah).toContain('sarah-x-org@emanuelnyc.org');
    expect(sarah).not.toContain('ben-x-org@emanuelnyc.org');
    expect(ben).not.toContain('sarah-x-org@emanuelnyc.org');

    // The CALL TIME is what gets blocked, not the 6:00 PM service start.
    // 4:30 PM on Sep 11 2027 is EDT, so 20:30Z.
    expect(propsOf(ben, 'DTSTART')).toEqual(['20270911T203000Z']);
    expect(propsOf(ben, 'DTEND')).toEqual(['20270912T000000Z']);
    expect(propsOf(ben, 'LOCATION')).toEqual(['5th Avenue Sanctuary']);

    // PUBLISH, never an invitation.
    expect(ben).toContain('METHOD:PUBLISH');
    expect(ben).not.toContain('ATTENDEE');
  });

  test('SE-19 a whole-workbook send puts both days in one file', async () => {
    const sheet = await createSheet();
    const a = await dayWithMetadata(sheet, { date: '2027-09-11', title: 'Erev RH' });
    const b = await dayWithMetadata(sheet, { date: '2027-09-20', title: 'Kol Nidre' });

    for (const { day, rowId } of [a, b]) {
      await putCell(sheet._id, day._id, rowId('Call Time'), 'c1', { segments: [text('5:30')] });
      await putCell(sheet._id, day._id, rowId('Greeter'), 'c1', {
        segments: [person('Sarah', 'sarah@x.org')],
      });
    }

    const res = await sendSchedules(sheet._id, { wholeSheet: true, includeCalendar: true });
    expect(res.status).toBe(200);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const ics = calendarFrom(sendSpy.mock.calls[0]);
    expect(linesOf(ics).filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2);
    // '5:30' with no meridiem takes the documented PM reading (17:30 EDT = 21:30Z).
    expect(propsOf(ics, 'DTSTART').sort()).toEqual(['20270911T213000Z', '20270920T213000Z']);
  });

  test('SE-20 an omitted or false includeCalendar sends the PDF only', async () => {
    const sheet = await createSheet();
    let day = await createDay(sheet._id, { date: '2027-09-11' });
    day = await addColumns(sheet._id, day, [{ id: 'c1', name: 'Erev Service' }]);
    await putCell(sheet._id, day._id, day.rows[0].id, 'c1', { segments: [person('A', 'a@x.org')] });

    const contentBase64 = Buffer.from('%PDF-1.4 pretend').toString('base64');

    // Absent - the pre-change behavior, reproduced exactly.
    const absent = await sendSchedules(sheet._id, {
      dayId: day._id,
      attachment: { fileName: 'sheet.pdf', contentBase64 },
    });
    expect(absent.body.calendarAttached).toBe(false);
    expect(absent.body.attached).toBe(true);
    expect(sendSpy.mock.calls[0][3].attachments).toEqual([
      { name: 'sheet.pdf', contentType: 'application/pdf', contentBase64 },
    ]);

    // Explicitly cleared by the sender.
    sendSpy.mockClear();
    const off = await sendSchedules(sheet._id, { dayId: day._id, includeCalendar: false });
    expect(off.body.calendarAttached).toBe(false);
    expect(sendSpy.mock.calls[0][3].attachments).toBeUndefined();
  });

  // Mutation check: force the builder to throw and prove the send survives it.
  test('SE-21 a calendar that cannot be built warns but never withholds the email', async () => {
    const sheet = await createSheet();
    let day = await createDay(sheet._id, { date: '2027-09-11' });
    day = await addColumns(sheet._id, day, [{ id: 'c1', name: 'Erev Service' }]);
    await putCell(sheet._id, day._id, day.rows[0].id, 'c1', { segments: [person('A', 'a@x.org')] });

    const icsSpy = jest.spyOn(icsBuilder, 'buildAssignmentsCalendar').mockImplementation(() => {
      throw new Error('calendar generation blew up');
    });
    try {
      const res = await sendSchedules(sheet._id, { dayId: day._id, includeCalendar: true });
      expect(res.status).toBe(200);
      expect(res.body.sent).toBe(1);
      expect(res.body.results[0]).toMatchObject({ email: 'a@x.org', success: true });
      expect(res.body.calendarAttached).toBe(false);
      expect(res.body.calendarWarning).toMatch(/could not be generated/i);
      expect(sendSpy.mock.calls[0][3].attachments).toBeUndefined();
    } finally {
      icsSpy.mockRestore();
    }

    // The send still counts: the emailLog entry is there, so the roster reads 'sent'.
    const sheetRes = await request(app).get(`/api/scheduling-sheets/${sheet._id}`).set(auth(adminToken));
    const status = (sheetRes.body.days[0].emailStatus || []).find((s) => s.email === 'a@x.org');
    expect(status && status.sentAt).toBeTruthy();
  });

  test('SE-22 placeholders produce no events and stay reported as skipped', async () => {
    const sheet = await createSheet();
    let day = await createDay(sheet._id, { date: '2027-09-11' });
    day = await addColumns(sheet._id, day, [{ id: 'c1', name: 'Erev Service' }]);
    await putCell(sheet._id, day._id, day.rows[0].id, 'c1', {
      segments: [person('A', 'a@x.org'), { type: 'person', name: '@usher_team', placeholder: true }],
    });

    const res = await sendSchedules(sheet._id, { dayId: day._id, includeCalendar: true });
    expect(res.status).toBe(200);
    expect(res.body.skippedPlaceholders).toEqual(['@usher_team']);
    expect(res.body.calendarAttached).toBe(true);

    const ics = calendarFrom(sendSpy.mock.calls[0]);
    expect(linesOf(ics).filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(ics).not.toContain('usher_team');
  });

  test('SE-23 a re-send keeps the UID and only advances SEQUENCE after an edit', async () => {
    const sheet = await createSheet();
    const { day, rowId } = await dayWithMetadata(sheet);
    await putCell(sheet._id, day._id, rowId('Greeter'), 'c1', {
      segments: [person('Sarah', 'sarah@x.org')],
    });

    const first = await sendSchedules(sheet._id, { dayId: day._id, includeCalendar: true });
    expect(first.status).toBe(200);
    const icsA = calendarFrom(sendSpy.mock.calls[0]);

    sendSpy.mockClear();
    await sendSchedules(sheet._id, { dayId: day._id, includeCalendar: true });
    const icsB = calendarFrom(sendSpy.mock.calls[0]);

    // Nothing changed between the sends: same identity, same version.
    expect(propsOf(icsB, 'UID')).toEqual(propsOf(icsA, 'UID'));
    expect(propsOf(icsB, 'SEQUENCE')).toEqual(propsOf(icsA, 'SEQUENCE'));

    // An edit bumps the day _version, which IS the sequence source.
    await putCell(sheet._id, day._id, rowId('Begins'), 'c1', { segments: [text('7:00 PM')] });
    sendSpy.mockClear();
    await sendSchedules(sheet._id, { dayId: day._id, includeCalendar: true });
    const icsC = calendarFrom(sendSpy.mock.calls[0]);

    expect(propsOf(icsC, 'UID')).toEqual(propsOf(icsA, 'UID'));
    expect(Number(propsOf(icsC, 'SEQUENCE')[0])).toBeGreaterThan(Number(propsOf(icsA, 'SEQUENCE')[0]));
  });

  test('SE-24 reordering columns does not re-identify anybody', async () => {
    const sheet = await createSheet();
    let day = await createDay(sheet._id, { date: '2027-09-11' });
    day = await addColumns(sheet._id, day, [
      { id: 'c1', name: 'Erev Service' },
      { id: 'c2', name: 'YP Dinner' },
    ]);
    await putCell(sheet._id, day._id, day.rows[0].id, 'c1', { segments: [person('Sarah', 'sarah@x.org')] });
    await putCell(sheet._id, day._id, day.rows[0].id, 'c2', { segments: [person('Sarah', 'sarah@x.org')] });

    await sendSchedules(sheet._id, { dayId: day._id, includeCalendar: true });
    const before = propsOf(calendarFrom(sendSpy.mock.calls[0]), 'UID').sort();

    // Drag reorder moves array POSITIONS, never ids - which is exactly why the
    // UID can be composed from them.
    const current = await request(app).get(`/api/scheduling-sheets/${sheet._id}`).set(auth(adminToken));
    const live = current.body.days[0];
    const reordered = await request(app)
      .put(`/api/scheduling-sheets/${sheet._id}/days/${live._id}/structure`)
      .set(auth(adminToken))
      .send({ expectedVersion: live._version, columns: [...live.columns].reverse(), rows: live.rows });
    expect(reordered.status).toBe(200);

    sendSpy.mockClear();
    await sendSchedules(sheet._id, { dayId: day._id, includeCalendar: true });
    const after = propsOf(calendarFrom(sendSpy.mock.calls[0]), 'UID').sort();

    expect(after).toEqual(before);
    expect(after).toHaveLength(2);
  });

  // extractDayAssignments gained rowId/colId/sequence/linkedSnapshot for the
  // calendar file, and GET /api/my-assignments SPREADS the extractor's entry —
  // so without the destructuring guard in that handler, all four would leak
  // into a response whose contract predates this change. The key set below was
  // measured against HEAD before the extractor grew, not assumed.
  test('SE-25 my-assignments returns exactly the fields it always has', async () => {
    const sheet = await createSheet();
    const { day, rowId } = await dayWithMetadata(sheet, { date: '2099-09-11' });
    await putCell(sheet._id, day._id, rowId('Greeter'), 'c1', {
      segments: [person('Events Coordinator', eventsRequesterUser.email)],
    });

    const res = await request(app).get('/api/my-assignments').set(auth(eventsRequesterToken));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(Object.keys(res.body[0]).sort()).toEqual(
      [
        'begins',
        'callTime',
        'columnName',
        'date',
        'dayId',
        'dayTitle',
        'email',
        'ends',
        'location',
        'locationLines',
        'note',
        'rowLabel',
        'sheetId',
        'sheetName',
      ].sort()
    );
  });
});
