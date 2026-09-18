/**
 * Scheduling Sheet email composer: resolved body on the sheet GET, the
 * real-recipient preview, and send-a-preview-to-me.
 *
 * openspec/changes/schedule-email-template-editing (D4, D6, D7, D8).
 *   SAB-*  assignmentEmailBody on GET /api/scheduling-sheets/:id
 *   SPV-*  POST /api/scheduling-sheets/:id/email/preview
 *   STS-*  POST /api/scheduling-sheets/:id/email/test-send
 *
 * The load-bearing assertions are SPV-1 (the preview IS what the send renders)
 * and STS-1 (a test-send reaches the signed-in sender and nobody else, even
 * when the body names another address).
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
const SETTINGS = 'templeEvents__SystemSettings';

describe('Scheduling Sheet email composer (SAB, SPV, STS)', () => {
  let mongoClient, db, app;
  let adminUser, adminToken, eventsRequesterToken, plainRequesterToken;
  let sendSpy;

  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  async function createSheet(body = { name: '2026 High Holy Days' }) {
    const res = await request(app).post('/api/scheduling-sheets').set(auth(adminToken)).send(body);
    expect(res.status).toBe(201);
    return res.body;
  }

  async function createDay(sheetId, body) {
    const res = await request(app).post(`/api/scheduling-sheets/${sheetId}/days`).set(auth(adminToken)).send(body);
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

  // Sarah on Erev Service, Ben on YP Dinner, plus an addressless placeholder.
  async function seedSheet() {
    const sheet = await createSheet();
    let day = await createDay(sheet._id, { date: '2027-09-11', title: 'Erev RH' });
    day = await addColumns(sheet._id, day, [
      { id: 'c1', name: 'Erev Service' },
      { id: 'c2', name: 'YP Dinner' },
    ]);
    const r1 = day.rows[0].id;
    await putCell(sheet._id, day._id, r1, 'c1', {
      segments: [person('Sarah', 'sarah@x.org'), { type: 'person', name: '@usher_team', placeholder: true }],
    });
    await putCell(sheet._id, day._id, r1, 'c2', { segments: [person('Ben', 'ben@x.org')] });
    return { sheet, day: await db.collection(DAYS).findOne({ _id: new ObjectId(day._id) }) };
  }

  const preview = (sheetId, body, token = adminToken) =>
    request(app).post(`/api/scheduling-sheets/${sheetId}/email/preview`).set(auth(token)).send(body);
  const testSend = (sheetId, body, token = adminToken) =>
    request(app).post(`/api/scheduling-sheets/${sheetId}/email/test-send`).set(auth(token)).send(body);

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('schedulingSheetEmailPreview'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection('templeEvents__SchedulingSheets').deleteMany({});
    await db.collection(DAYS).deleteMany({});
    await db.collection(SETTINGS).deleteMany({});

    adminUser = createAdmin({ email: 'sender@emanuelnyc.org' });
    const eventsRequester = createRequester({ email: 'eventscoord@emanuelnyc.org', department: 'events' });
    const plainRequester = createRequester({ email: 'plain@emanuelnyc.org' });
    await insertUsers(db, [adminUser, eventsRequester, plainRequester]);
    adminToken = await createMockToken(adminUser);
    eventsRequesterToken = await createMockToken(eventsRequester);
    plainRequesterToken = await createMockToken(plainRequester);

    sendSpy = jest.spyOn(emailService, 'sendEmail').mockResolvedValue({ success: true });
  });

  afterEach(() => {
    sendSpy.mockRestore();
  });

  describe('assignmentEmailBody on the sheet GET', () => {
    test('SAB-1 carries the code default when nothing is customized', async () => {
      const sheet = await createSheet();
      const res = await request(app).get(`/api/scheduling-sheets/${sheet._id}`).set(auth(eventsRequesterToken));
      expect(res.status).toBe(200);
      expect(typeof res.body.assignmentEmailBody).toBe('string');
      expect(res.body.assignmentEmailBody).toContain('{{assignmentsTable}}');
    });

    test('SAB-2 a stored override wins over the default', async () => {
      await db.collection(SETTINGS).insertOne({
        _id: 'email-template-assignment-schedule',
        subject: 'Custom subject',
        body: '<p>Custom body {{assignmentsTable}}</p>',
        updatedAt: new Date(),
        updatedBy: 'someone@x.org',
      });
      const sheet = await createSheet();
      const res = await request(app).get(`/api/scheduling-sheets/${sheet._id}`).set(auth(eventsRequesterToken));
      expect(res.body.assignmentEmailBody).toBe('<p>Custom body {{assignmentsTable}}</p>');
      expect(res.body.assignmentEmailSubject).toBe('Custom subject');
    });
  });

  describe('POST /email/preview', () => {
    test('SPV-1 the preview equals what the send renders for the same recipient and scope', async () => {
      const { sheet, day } = await seedSheet();
      const subject = 'Your assignments for {{scopeLabel}}';

      const pv = await preview(sheet._id, { dayIds: [String(day._id)], subject, recipientEmail: 'sarah@x.org' });
      expect(pv.status).toBe(200);
      expect(pv.body.recipientName).toBe('Sarah');

      const sent = await request(app)
        .post(`/api/scheduling-sheets/${sheet._id}/email`)
        .set(auth(adminToken))
        .send({ dayIds: [String(day._id)], subject, recipients: ['sarah@x.org'] });
      expect(sent.status).toBe(200);
      const [, sentSubject, sentHtml] = sendSpy.mock.calls[0];

      expect(pv.body.subject).toBe(sentSubject);
      expect(pv.body.html).toBe(sentHtml);
      expect(pv.body.html).toContain('Erev Service');
      expect(pv.body.html).not.toContain('YP Dinner');
    });

    test.each([
      ['an address nobody holds', 'nobody@x.org'],
      ['a missing address', undefined],
    ])('SPV-2 400 RECIPIENT_NOT_IN_SCOPE for %s', async (_label, recipientEmail) => {
      const { sheet, day } = await seedSheet();
      const res = await preview(sheet._id, { dayIds: [String(day._id)], recipientEmail });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('RECIPIENT_NOT_IN_SCOPE');
    });

    test('SPV-3 a placeholder chip is not a previewable recipient even if it carries an address', async () => {
      const sheet = await createSheet();
      let day = await createDay(sheet._id, { date: '2027-09-11' });
      day = await addColumns(sheet._id, day, [{ id: 'c1', name: 'Erev Service' }]);
      await putCell(sheet._id, day._id, day.rows[0].id, 'c1', {
        segments: [person('Ushers', 'ushers@x.org', { placeholder: true })],
      });
      const res = await preview(sheet._id, { dayIds: [String(day._id)], recipientEmail: 'ushers@x.org' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('RECIPIENT_NOT_IN_SCOPE');
    });

    test('SPV-4 recipient matching is case-insensitive', async () => {
      const { sheet, day } = await seedSheet();
      const res = await preview(sheet._id, { dayIds: [String(day._id)], recipientEmail: 'SARAH@X.org' });
      expect(res.status).toBe(200);
      expect(res.body.recipientName).toBe('Sarah');
    });

    test('SPV-5 a non-manager is refused', async () => {
      const { sheet, day } = await seedSheet();
      const res = await preview(sheet._id, { dayIds: [String(day._id)], recipientEmail: 'sarah@x.org' }, plainRequesterToken);
      expect(res.status).toBe(403);
    });

    test('SPV-6 an events-department sender can preview', async () => {
      const { sheet, day } = await seedSheet();
      const res = await preview(sheet._id, { dayIds: [String(day._id)], recipientEmail: 'ben@x.org' }, eventsRequesterToken);
      expect(res.status).toBe(200);
    });

    test('SPV-7 a preview writes nothing and sends nothing', async () => {
      const { sheet, day } = await seedSheet();
      const before = await db.collection(DAYS).findOne({ _id: day._id });
      await preview(sheet._id, { dayIds: [String(day._id)], recipientEmail: 'sarah@x.org' });
      const after = await db.collection(DAYS).findOne({ _id: day._id });
      expect(after._version).toBe(before._version);
      expect(after.lastModifiedAt).toEqual(before.lastModifiedAt);
      expect(after.emailLog || []).toEqual(before.emailLog || []);
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  describe('POST /email/test-send', () => {
    test('STS-1 exactly one send, to the signed-in sender, ignoring a body `to`', async () => {
      const { sheet, day } = await seedSheet();
      const res = await testSend(sheet._id, {
        dayIds: [String(day._id)],
        recipientEmail: 'sarah@x.org',
        to: 'third.party@x.org',
      });
      expect(res.status).toBe(200);
      expect(res.body.sent).toBe(true);
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy.mock.calls[0][0]).toBe('sender@emanuelnyc.org');
      // The previewed person's content, addressed to the sender.
      expect(sendSpy.mock.calls[0][2]).toContain('Erev Service');
    });

    test('STS-2 the subject is prefixed [Preview]', async () => {
      const { sheet, day } = await seedSheet();
      await testSend(sheet._id, {
        dayIds: [String(day._id)],
        recipientEmail: 'sarah@x.org',
        subject: 'Your assignments for Rosh Hashanah',
      });
      expect(sendSpy.mock.calls[0][1]).toBe('[Preview] Your assignments for Rosh Hashanah');
    });

    test('STS-3 includeCalendar true attaches an .ics of the previewed person only', async () => {
      const { sheet, day } = await seedSheet();
      const res = await testSend(sheet._id, {
        dayIds: [String(day._id)], recipientEmail: 'sarah@x.org', includeCalendar: true,
      });
      expect(res.body.calendarAttached).toBe(true);
      const { attachments } = sendSpy.mock.calls[0][3];
      const ics = attachments.find((a) => a.contentType.startsWith('text/calendar'));
      const text = Buffer.from(ics.contentBase64, 'base64').toString('utf8');
      expect(text).toContain('Erev Service');
      expect(text).not.toContain('YP Dinner');
    });

    test('STS-4 no calendar unless includeCalendar === true', async () => {
      const { sheet, day } = await seedSheet();
      await testSend(sheet._id, { dayIds: [String(day._id)], recipientEmail: 'sarah@x.org', includeCalendar: 'yes' });
      expect(sendSpy.mock.calls[0][3].attachments).toBeUndefined();
    });

    test('STS-5 a valid PDF rides along; an oversized one is dropped with a warning and the send still happens', async () => {
      const { sheet, day } = await seedSheet();
      const ok = await testSend(sheet._id, {
        dayIds: [String(day._id)], recipientEmail: 'sarah@x.org',
        attachment: { fileName: 'sheet.pdf', contentBase64: 'JVBERi0xLjQK' },
      });
      expect(ok.body.attached).toBe(true);
      expect(sendSpy.mock.calls[0][3].attachments[0]).toMatchObject({ name: 'sheet.pdf', contentType: 'application/pdf' });

      const big = await testSend(sheet._id, {
        dayIds: [String(day._id)], recipientEmail: 'sarah@x.org',
        attachment: { fileName: 'sheet.pdf', contentBase64: 'A'.repeat(4.2 * 1024 * 1024) },
      });
      expect(big.status).toBe(200);
      expect(big.body.attached).toBe(false);
      expect(big.body.attachmentWarning).toMatch(/mail limit/);
      expect(sendSpy).toHaveBeenCalledTimes(2);
    });

    test('STS-6 no emailLog, _version or lastModifiedAt change', async () => {
      const { sheet, day } = await seedSheet();
      const before = await db.collection(DAYS).findOne({ _id: day._id });
      await testSend(sheet._id, { dayIds: [String(day._id)], recipientEmail: 'sarah@x.org' });
      const after = await db.collection(DAYS).findOne({ _id: day._id });
      expect(after._version).toBe(before._version);
      expect(after.lastModifiedAt).toEqual(before.lastModifiedAt);
      expect(after.emailLog || []).toEqual([]);
    });

    test('STS-7 delivery disabled answers { sent: false, skipped: true }', async () => {
      sendSpy.mockResolvedValue({ success: true, skipped: true });
      const { sheet, day } = await seedSheet();
      const res = await testSend(sheet._id, { dayIds: [String(day._id)], recipientEmail: 'sarah@x.org' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ sent: false, skipped: true });
    });

    test('STS-8 recipient checks and the manager gate match the preview', async () => {
      const { sheet, day } = await seedSheet();
      const out = await testSend(sheet._id, { dayIds: [String(day._id)], recipientEmail: 'nobody@x.org' });
      expect(out.status).toBe(400);
      expect(out.body.code).toBe('RECIPIENT_NOT_IN_SCOPE');
      const denied = await testSend(sheet._id, { dayIds: [String(day._id)], recipientEmail: 'sarah@x.org' }, plainRequesterToken);
      expect(denied.status).toBe(403);
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });
});
