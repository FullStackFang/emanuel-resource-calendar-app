/**
 * Scheduling Sheet email tests (SE-1 to SE-51)
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
const { graphError, graphNetworkError } = require('../__helpers__/graphApiMock');

const DAYS = 'templeEvents__SchedulingSheetDays';

describe('Scheduling Sheet emails (SE-1 to SE-51)', () => {
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

  test('SE-29 renamed and reordered metadata roles feed the email body and calendar', async () => {
    const sheet = await createSheet();
    const { day, rowId } = await dayWithMetadata(sheet);
    const renamedRows = [
      { ...day.rows.find((row) => row.metadataRole === 'ends'), label: 'Wrap' },
      day.rows.find((row) => row.id === rowId('Greeter')),
      { ...day.rows.find((row) => row.metadataRole === 'location'), label: 'Where' },
      { ...day.rows.find((row) => row.metadataRole === 'begins'), label: 'Go' },
      { ...day.rows.find((row) => row.metadataRole === 'callTime'), label: 'Crew arrival' },
      { ...day.rows.find((row) => row.metadataRole === 'doorsOpen'), label: 'House' },
    ];
    const structure = await request(app)
      .put(`/api/scheduling-sheets/${sheet._id}/days/${day._id}/structure`)
      .set(auth(adminToken))
      .send({ expectedVersion: day._version, columns: day.columns, rows: renamedRows });
    expect(structure.status).toBe(200);

    const byRole = Object.fromEntries(structure.body.rows.map((row) => [row.metadataRole, row.id]));
    await putCell(sheet._id, day._id, byRole.callTime, 'c1', { segments: [text('4:30 PM')] });
    await putCell(sheet._id, day._id, byRole.begins, 'c1', { segments: [text('6:00 PM')] });
    await putCell(sheet._id, day._id, byRole.ends, 'c1', { segments: [text('8:00 PM')] });
    await putCell(sheet._id, day._id, byRole.location, 'c1', { segments: [loc('Wise Hall')] });
    await putCell(sheet._id, day._id, rowId('Greeter'), 'c1', {
      segments: [person('Sarah', 'sarah@x.org')],
    });

    const res = await sendSchedules(sheet._id, { dayId: day._id, includeCalendar: true });
    expect(res.status).toBe(200);
    const html = sendSpy.mock.calls[0][2];
    expect(html).toContain('4:30 PM');
    expect(html).toMatch(/6:00 PM\s*&ndash;\s*8:00 PM/);
    expect(html).toContain('Wise Hall');

    const calendar = calendarFrom(sendSpy.mock.calls[0]);
    expect(propsOf(calendar, 'DTSTART')).toEqual(['20270911T203000Z']);
    expect(propsOf(calendar, 'DTEND')).toEqual(['20270912T000000Z']);
    expect(propsOf(calendar, 'LOCATION')).toEqual(['Wise Hall']);
  });

  test('SE-30 historical orphaned cells do not create recipients, body content, or calendar events', async () => {
    const sheet = await createSheet();
    const { day, rowId } = await dayWithMetadata(sheet);
    await putCell(sheet._id, day._id, rowId('Greeter'), 'c1', {
      segments: [person('Sarah', 'sarah@x.org')],
    });
    await db.collection(DAYS).updateOne(
      { _id: new ObjectId(String(day._id)) },
      {
        $set: {
          'cells.missing-row:missing-column': {
            segments: [person('Ghost', 'ghost@x.org')],
            note: null,
          },
          taggedEmails: ['ghost@x.org', 'sarah@x.org'],
        },
      }
    );

    const res = await sendSchedules(sheet._id, { dayId: day._id, includeCalendar: true });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0]).toBe('sarah@x.org');
    expect(sendSpy.mock.calls[0][2]).not.toContain('Ghost');
    expect(calendarFrom(sendSpy.mock.calls[0])).not.toContain('Ghost');
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

  // ---------------------------------------------------------------------------
  // Chronological order. The fan-out used to sort each recipient's entries by
  // date and then COLUMN NAME, so a 5:00 PM dinner under 'YP Dinner' printed
  // below a 7:30 PM service under 'Erev Service'. Column names are chosen so
  // that alphabetical and chronological order DISAGREE, otherwise a regression
  // to the old sort would still pass.
  // ---------------------------------------------------------------------------
  test('SE-26 posts are listed by call time, not by column name', async () => {
    const sheet = await createSheet();
    let { day, rowId } = await dayWithMetadata(sheet);
    day = await addColumns(sheet._id, day, [
      { id: 'c1', name: 'Erev Service' },
      { id: 'c2', name: 'YP Dinner' },
    ]);

    await putCell(sheet._id, day._id, rowId('Call Time'), 'c1', { segments: [text('7:30 PM')] });
    await putCell(sheet._id, day._id, rowId('Call Time'), 'c2', { segments: [text('5:00 PM')] });
    for (const col of ['c1', 'c2']) {
      await putCell(sheet._id, day._id, rowId('Greeter'), col, { segments: [person('Sarah', 'sarah@x.org')] });
    }

    const res = await sendSchedules(sheet._id, { dayId: day._id, includeCalendar: true });
    expect(res.status).toBe(200);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const html = sendSpy.mock.calls[0][2];
    expect(html.indexOf('YP Dinner')).toBeLessThan(html.indexOf('Erev Service'));
    expect(html.indexOf('5:00 PM')).toBeLessThan(html.indexOf('7:30 PM'));

    // The calendar file is emitted in the same order (5:00 PM EDT = 21:00Z).
    const ics = calendarFrom(sendSpy.mock.calls[0]);
    expect(propsOf(ics, 'DTSTART')).toEqual(['20270911T210000Z', '20270911T233000Z']);
  });

  test('SE-27 my-assignments comes back in chronological order across days and within a day', async () => {
    const sheet = await createSheet();
    // The LATER day is created first so that insertion order disagrees with date order.
    let later = await dayWithMetadata(sheet, { date: '2099-09-20', title: 'Kol Nidre' });
    const earlier = await dayWithMetadata(sheet, { date: '2099-09-11', title: 'Erev RH' });
    const laterDay = await addColumns(sheet._id, later.day, [
      { id: 'c1', name: 'Erev Service' },
      { id: 'c2', name: 'YP Dinner' },
    ]);

    const me = person('Events Coordinator', eventsRequesterUser.email);
    await putCell(sheet._id, laterDay._id, later.rowId('Call Time'), 'c1', { segments: [text('7:30 PM')] });
    await putCell(sheet._id, laterDay._id, later.rowId('Call Time'), 'c2', { segments: [text('5:00 PM')] });
    await putCell(sheet._id, laterDay._id, later.rowId('Greeter'), 'c1', { segments: [me] });
    await putCell(sheet._id, laterDay._id, later.rowId('Greeter'), 'c2', { segments: [me] });
    await putCell(sheet._id, earlier.day._id, earlier.rowId('Greeter'), 'c1', { segments: [me] });

    const res = await request(app).get('/api/my-assignments').set(auth(eventsRequesterToken));
    expect(res.status).toBe(200);
    expect(res.body.map((e) => [e.date, e.columnName])).toEqual([
      ['2099-09-11', 'Erev Service'],
      ['2099-09-20', 'YP Dinner'],
      ['2099-09-20', 'Erev Service'],
    ]);
  });

  // --------------------------------------------------------------------------
  // SE-28 - recipient attribution. The workbook PDF beside it is ONE blob
  // attached identically to every message; the calendar file is not, so it
  // must not go out under one shared name.
  // --------------------------------------------------------------------------

  test('SE-28 each recipient gets a calendar file named and addressed to them', async () => {
    const sheet = await createSheet();
    const { day, rowId } = await dayWithMetadata(sheet);

    await putCell(sheet._id, day._id, rowId('Call Time'), 'c1', { segments: [text('4:30 PM')] });
    await putCell(sheet._id, day._id, rowId('Greeter'), 'c1', {
      segments: [person('Sarah Cohen', 'sarah@x.org'), person('Ben Ross', 'ben@x.org')],
    });

    const res = await sendSchedules(sheet._id, { dayId: day._id, includeCalendar: true });
    expect(res.status).toBe(200);

    const nameOf = (email) =>
      ((callFor(email)[3] || {}).attachments || []).find(
        (a) => typeof a.contentType === 'string' && a.contentType.startsWith('text/calendar')
      ).name;

    // Two different files must not arrive under one name.
    expect(nameOf('sarah@x.org')).not.toBe(nameOf('ben@x.org'));
    expect(nameOf('sarah@x.org').endsWith(' - Sarah Cohen.ics')).toBe(true);
    expect(nameOf('ben@x.org').endsWith(' - Ben Ross.ics')).toBe(true);

    // And the attribution that survives a forward, once the filename is gone.
    expect(calendarFrom(callFor('sarah@x.org'))).toContain('Schedule for: Sarah Cohen');
    expect(calendarFrom(callFor('ben@x.org'))).toContain('Schedule for: Ben Ross');
    expect(calendarFrom(callFor('ben@x.org'))).not.toContain('Sarah Cohen');
  });

  // ---------------------------------------------------------------------------
  // Arbitrary day selection (dayIds) — openspec change
  // scheduling-sheet-approver-editing-and-scoped-sharing, capability
  // scheduling-sheet-scoped-distribution. Scope used to be a two-way branch
  // (one dayId, or the whole workbook), so there was nothing to validate. An
  // arbitrary list can be internally inconsistent, and the cost of accepting a
  // bad one is a mass-mailing — so every rejection below also asserts that NO
  // message went out, not merely that the status code was right.
  // ---------------------------------------------------------------------------

  /** Current server _version of a day, for the send snapshot preflight. */
  async function versionOf(dayId) {
    const doc = await db.collection(DAYS).findOne({ _id: new ObjectId(String(dayId)) });
    return doc._version;
  }

  /** Three days a week apart, one person posted on all three. */
  async function threeDaySheet() {
    const sheet = await createSheet();
    const a = await dayWithMetadata(sheet, { date: '2027-09-11', title: 'Erev RH' });
    const b = await dayWithMetadata(sheet, { date: '2027-09-15', title: 'Tashlich' });
    const c = await dayWithMetadata(sheet, { date: '2027-09-20', title: 'Kol Nidre' });
    for (const d of [a, b, c]) {
      await putCell(sheet._id, d.day._id, d.rowId('Greeter'), 'c1', {
        segments: [person('Sarah', 'sarah@x.org')],
      });
    }
    return { sheet, a, b, c };
  }

  test('SE-31 nonconsecutive dayIds cover exactly those days and skip the one between', async () => {
    const { sheet, a, c } = await threeDaySheet();

    const res = await sendSchedules(sheet._id, { dayIds: [String(c.day._id), String(a.day._id)] });
    expect(res.status).toBe(200);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const html = sendSpy.mock.calls[0][2];
    expect(html).toContain('Sep 11');
    expect(html).toContain('Sep 20');
    // The unselected middle day must not appear at all.
    expect(html).not.toContain('Sep 15');
    // ...and the days are chronological even though the ids were not.
    expect(html.indexOf('Sep 11')).toBeLessThan(html.indexOf('Sep 20'));
  });

  test('SE-32 an explicitly empty dayIds list is refused and never means every day', async () => {
    const { sheet } = await threeDaySheet();
    const res = await sendSchedules(sheet._id, { dayIds: [] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('EMPTY_SCOPE');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('SE-33 an unknown day id is a 404 and sends nothing', async () => {
    const { sheet, a } = await threeDaySheet();
    const res = await sendSchedules(sheet._id, {
      dayIds: [String(a.day._id), String(new ObjectId())],
    });
    expect(res.status).toBe(404);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('SE-34 a day belonging to another workbook is refused exactly like an unknown one', async () => {
    const { sheet, a } = await threeDaySheet();
    const other = await createSheet({ name: '2028 High Holy Days' });
    const foreign = await dayWithMetadata(other, { date: '2028-09-11', title: 'Erev RH' });

    const res = await sendSchedules(sheet._id, {
      dayIds: [String(a.day._id), String(foreign.day._id)],
    });
    expect(res.status).toBe(404);
    // Nothing in the response may reveal the day exists in another workbook.
    expect(JSON.stringify(res.body)).not.toMatch(/2028 High Holy Days/);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('SE-35 mixing dayIds with a legacy scope field is refused', async () => {
    const { sheet, a } = await threeDaySheet();
    const res = await sendSchedules(sheet._id, { dayIds: [String(a.day._id)], wholeSheet: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MIXED_SCOPE');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('SE-36 the same day listed twice is refused rather than silently de-duplicated', async () => {
    const { sheet, a } = await threeDaySheet();
    const id = String(a.day._id);
    const res = await sendSchedules(sheet._id, { dayIds: [id, id] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DUPLICATE_DAYS');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('SE-37 an explicitly empty recipients list is refused, where it used to mean everyone', async () => {
    const { sheet, a } = await threeDaySheet();
    const res = await sendSchedules(sheet._id, { dayIds: [String(a.day._id)], recipients: [] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('EMPTY_RECIPIENTS');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('SE-38 a recipient named in different case still resolves to the assigned person', async () => {
    // Person chips are free text, so the panel cannot guarantee the casing a
    // caller will use. The cell writer lowercases the stored address, so the
    // chip below is stored as 'sarah.levine@x.org' whatever case it arrived in;
    // this pins that BOTH sides are normalized before comparison, so recipient
    // selection cannot start silently matching nobody.
    const sheet = await createSheet();
    const { day, rowId } = await dayWithMetadata(sheet, { date: '2027-09-11' });
    await putCell(sheet._id, day._id, rowId('Greeter'), 'c1', {
      segments: [person('Sarah Levine', 'Sarah.Levine@x.org')],
    });

    const res = await sendSchedules(sheet._id, {
      dayIds: [String(day._id)],
      recipients: ['sarah.levine@X.ORG'],
    });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0]).toBe('sarah.levine@x.org');
  });

  test('SE-39 an unassigned address is refused instead of being quietly dropped', async () => {
    const { sheet, a } = await threeDaySheet();
    const res = await sendSchedules(sheet._id, {
      dayIds: [String(a.day._id)],
      recipients: ['sarah@x.org', 'stranger@x.org'],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INELIGIBLE_RECIPIENT');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('SE-40 a stale send snapshot is a 409 that sends nothing; a current one sends', async () => {
    const { sheet, a, c } = await threeDaySheet();
    const dayIds = [String(a.day._id), String(c.day._id)];
    const current = {
      [dayIds[0]]: await versionOf(dayIds[0]),
      [dayIds[1]]: await versionOf(dayIds[1]),
    };

    const stale = await sendSchedules(sheet._id, {
      dayIds,
      expectedDayVersions: { ...current, [dayIds[1]]: current[dayIds[1]] - 1 },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_SHEET');
    expect(stale.body.staleDayIds).toEqual([dayIds[1]]);
    expect(sendSpy).not.toHaveBeenCalled();

    const fresh = await sendSchedules(sheet._id, { dayIds, expectedDayVersions: current });
    expect(fresh.status).toBe(200);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  test('SE-41 a partial version map is a 400 — a new client bug, not an old client', async () => {
    const { sheet, a, c } = await threeDaySheet();
    const dayIds = [String(a.day._id), String(c.day._id)];
    const res = await sendSchedules(sheet._id, {
      dayIds,
      expectedDayVersions: { [dayIds[0]]: await versionOf(dayIds[0]) },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INCOMPLETE_VERSIONS');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('SE-42 perDay grouping is refused rather than silently sending one combined email', async () => {
    const { sheet, a } = await threeDaySheet();
    const res = await sendSchedules(sheet._id, { dayIds: [String(a.day._id)], grouping: 'perDay' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNSUPPORTED_GROUPING');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('SE-43 legacy dayId and wholeSheet requests behave exactly as they did', async () => {
    const { sheet, a } = await threeDaySheet();

    const oneDay = await sendSchedules(sheet._id, { dayId: String(a.day._id) });
    expect(oneDay.status).toBe(200);
    expect(oneDay.body.sent).toBe(1);
    expect(sendSpy.mock.calls[0][2]).toContain('Sep 11');
    expect(sendSpy.mock.calls[0][2]).not.toContain('Sep 20');

    sendSpy.mockClear();
    const whole = await sendSchedules(sheet._id, { wholeSheet: true });
    expect(whole.status).toBe(200);
    const html = sendSpy.mock.calls[0][2];
    for (const d of ['Sep 11', 'Sep 15', 'Sep 20']) expect(html).toContain(d);

    // No scope at all is still the original 400.
    sendSpy.mockClear();
    const noScope = await sendSchedules(sheet._id, {});
    expect(noScope.status).toBe(400);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Per-send subject. Every recipient of one send shares a subject, and it used
  // to be derived solely from scope — so two different sends from the same
  // workbook were indistinguishable in an inbox. The panel now prefills an
  // editable field and sends the result; absent or blank keeps the old default.
  // ---------------------------------------------------------------------------

  test('SE-44 a supplied subject is used verbatim for every recipient', async () => {
    const sheet = await createSheet();
    let { day, rowId } = await dayWithMetadata(sheet, { date: '2027-09-11' });
    day = await addColumns(sheet._id, day, [
      { id: 'c1', name: 'Erev Service' },
      { id: 'c2', name: 'YP Dinner' },
    ]);
    await putCell(sheet._id, day._id, rowId('Greeter'), 'c1', {
      segments: [person('Sarah', 'sarah@x.org')],
    });
    await putCell(sheet._id, day._id, rowId('Greeter'), 'c2', {
      segments: [person('Ben', 'ben@x.org')],
    });

    const res = await sendSchedules(sheet._id, {
      dayIds: [String(day._id)],
      subject: 'Erev RH posts - please confirm',
    });
    expect(res.status).toBe(200);
    expect(sendSpy).toHaveBeenCalledTimes(2);
    // Both recipients, one subject: it describes the SEND, not the person.
    for (const call of sendSpy.mock.calls) {
      expect(call[1]).toBe('Erev RH posts - please confirm');
    }
  });

  test('SE-45 an absent or blank subject keeps the existing default', async () => {
    const sheet = await createSheet();
    const { day, rowId } = await dayWithMetadata(sheet, { date: '2027-09-11' });
    await putCell(sheet._id, day._id, rowId('Greeter'), 'c1', {
      segments: [person('Sarah', 'sarah@x.org')],
    });

    const absent = await sendSchedules(sheet._id, { dayIds: [String(day._id)] });
    expect(absent.status).toBe(200);
    const defaultSubject = sendSpy.mock.calls[0][1];
    expect(defaultSubject).toMatch(/Your assignments for/);

    // Whitespace is not a subject. It must not send an empty header.
    sendSpy.mockClear();
    const blank = await sendSchedules(sheet._id, { dayIds: [String(day._id)], subject: '   ' });
    expect(blank.status).toBe(200);
    expect(sendSpy.mock.calls[0][1]).toBe(defaultSubject);
  });

  test('SE-46 a subject carrying newlines or excess length is normalized, not rejected', async () => {
    const sheet = await createSheet();
    const { day, rowId } = await dayWithMetadata(sheet, { date: '2027-09-11' });
    await putCell(sheet._id, day._id, rowId('Greeter'), 'c1', {
      segments: [person('Sarah', 'sarah@x.org')],
    });

    const res = await sendSchedules(sheet._id, {
      dayIds: [String(day._id)],
      subject: `Erev RH\r\nBcc: sneaky@x.org${' padding'.repeat(60)}`,
    });
    expect(res.status).toBe(200);

    const subject = sendSpy.mock.calls[0][1];
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject.length).toBeLessThanOrEqual(200);
    expect(subject.startsWith('Erev RH Bcc: sneaky@x.org')).toBe(true);
  });

  test('SE-47 a supplied subject still resolves template variables', async () => {
    // The subject goes through the same renderer as the default, so a sender who
    // wants the scope or the person named can still say so.
    const sheet = await createSheet();
    const { day, rowId } = await dayWithMetadata(sheet, { date: '2027-09-11' });
    await putCell(sheet._id, day._id, rowId('Greeter'), 'c1', {
      segments: [person('Sarah', 'sarah@x.org')],
    });

    const res = await sendSchedules(sheet._id, {
      dayIds: [String(day._id)],
      subject: '{{recipientName}} - {{scopeLabel}}',
    });
    expect(res.status).toBe(200);
    expect(sendSpy.mock.calls[0][1]).toBe('Sarah - Saturday, September 11, 2027');
  });
  // ---------------------------------------------------------------------------
  // Fan-out under load (SE-48..50). Graph allows 4 concurrent requests per
  // mailbox and rejects the rest with 429 — it does not queue them. A
  // 40-person holiday sheet must therefore be sent through a bounded window,
  // and a throttled send must be retried rather than reported as failed.
  // ---------------------------------------------------------------------------

  /** A day with N distinct people, one per column, in the first starter row. */
  async function createCrowdedDay(n) {
    const sheet = await createSheet();
    let day = await createDay(sheet._id, { date: '2027-09-11', title: 'Erev RH' });
    const columns = Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `Post ${i}` }));
    day = await addColumns(sheet._id, day, columns);
    const r1 = day.rows[0].id;
    for (let i = 0; i < n; i++) {
      await putCell(sheet._id, day._id, r1, `c${i}`, {
        segments: [person(`Person ${i}`, `person${i}@x.org`)],
      });
    }
    return { sheet, day };
  }

  test('SE-48 forty recipients never have more than four sends in flight, and all forty go out', async () => {
    const { sheet, day } = await createCrowdedDay(40);

    let inFlight = 0;
    let highWater = 0;
    sendSpy.mockImplementation(async () => {
      inFlight++;
      highWater = Math.max(highWater, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { success: true };
    });

    const res = await sendSchedules(sheet._id, { dayId: day._id });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(40);
    expect(res.body.failed).toBe(0);
    expect(sendSpy).toHaveBeenCalledTimes(40);
    expect(highWater).toBeLessThanOrEqual(4);
    expect(highWater).toBeGreaterThan(1); // still parallel, not serialized
  }, 30000);

  test('SE-49 a throttled (429) send is retried and reported as sent, not failed', async () => {
    const { sheet, day } = await createCrowdedDay(3);

    let throttledOnce = false;
    sendSpy.mockImplementation(async (to) => {
      if (to === 'person1@x.org' && !throttledOnce) {
        throttledOnce = true;
        throw graphError(429, 'Application is over its MailboxConcurrency limit.');
      }
      return { success: true };
    });

    const res = await sendSchedules(sheet._id, { dayId: day._id });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(3);
    expect(res.body.failed).toBe(0);
    expect(sendSpy.mock.calls.filter(([to]) => to === 'person1@x.org')).toHaveLength(2);

    // The retried recipient is logged exactly once, like everybody else.
    const stored = await db.collection(DAYS).findOne({ _id: new ObjectId(day._id) });
    expect(stored.emailLog.filter((e) => e.email === 'person1@x.org')).toHaveLength(1);
  }, 15000);

  test('SE-50 a permanent (400) failure is reported once and never retried', async () => {
    const { sheet, day } = await createCrowdedDay(3);

    sendSpy.mockImplementation(async (to) => {
      if (to === 'person1@x.org') throw graphError(400, 'Invalid recipient');
      return { success: true };
    });

    const res = await sendSchedules(sheet._id, { dayId: day._id });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(2);
    expect(res.body.failed).toBe(1);
    expect(res.body.results.find((r) => r.email === 'person1@x.org')).toMatchObject({
      success: false,
      error: 'Invalid recipient',
    });
    expect(sendSpy.mock.calls.filter(([to]) => to === 'person1@x.org')).toHaveLength(1);
  });
  test('SE-51 each failed recipient carries a reason code beside the raw error', async () => {
    const { sheet, day } = await createCrowdedDay(4);

    sendSpy.mockImplementation(async (to) => {
      if (to === 'person0@x.org') throw graphError(400, 'Invalid recipient');
      if (to === 'person1@x.org') throw graphError(429, 'Application is over its MailboxConcurrency limit.');
      if (to === 'person2@x.org') throw graphNetworkError('ECONNRESET');
      if (to === 'person3@x.org') throw new Error('No valid email recipients');
      return { success: true };
    });

    const res = await sendSchedules(sheet._id, { dayId: day._id });
    expect(res.status).toBe(200);
    expect(res.body.failed).toBe(4);

    const byEmail = Object.fromEntries(res.body.results.map((r) => [r.email, r]));
    expect(byEmail['person0@x.org']).toMatchObject({ success: false, reason: 'rejected', error: 'Invalid recipient' });
    expect(byEmail['person1@x.org']).toMatchObject({ success: false, reason: 'throttled' });
    expect(byEmail['person2@x.org']).toMatchObject({ success: false, reason: 'unavailable' });
    expect(byEmail['person3@x.org']).toMatchObject({ success: false, reason: 'unknown', error: 'No valid email recipients' });
    // A success carries no reason at all.
    expect(res.body.results.every((r) => r.success === false)).toBe(true);
  }, 20000);
});
