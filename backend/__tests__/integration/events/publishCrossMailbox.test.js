/**
 * Cross-Mailbox Publish Resolution Tests (PCM)
 *
 * Regression coverage for the bug where switching the admin's default calendar
 * caused publishes to land in the wrong (old) mailbox.
 *
 * Root cause: when targetCalendar was a Graph calendar ID, the backend kept
 * event.calendarOwner (set at creation) as the publish owner, producing a
 * cross-mailbox tuple (sandbox owner + production calendar ID) that Graph
 * silently resolved against the sandbox default calendar.
 *
 * Fix: reverse-lookup the owner from the calendar ID via
 *      getCalendarOwnerFromConfig(targetCalendar). Owner and calendarId then
 *      always come from the same mailbox.
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const { createPendingEvent, insertEvents } = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');
const graphApiMock = require('../../__helpers__/graphApiMock');

// IDs lifted from backend/calendar-config.json. The reverse-lookup uses that file,
// so the test must use the real strings or it won't exercise the fix path.
const SANDBOX_OWNER = 'templeeventssandbox@emanuelnyc.org';
const PRODUCTION_OWNER = 'templeevents@emanuelnyc.org';
const PRODUCTION_CALENDAR_ID =
  'AAMkADgwMDdhZjYzLWM0NmEtNDkwMS1iNDE5LTVhNDU1MTdhMTZiZABGAAAAAACfSy_DEMqQRoVhNzy5-0oVBwDD2Ip2-foaTaGvZlaNMb4-AAAAAAEGAADD2Ip2-foaTaGvZlaNMb4-AALX9NflAAA=';
const SANDBOX_CALENDAR_ID =
  'AAMkADgwMDdhZjYzLWM0NmEtNDkwMS1iNDE5LTVhNDU1MTdhMTZiZABGAAAAAACfSy_DEMqQRoVhNzy5-0oVBwDD2Ip2-foaTaGvZlaNMb4-AAAAAAEGAADD2Ip2-foaTaGvZlaNMb4-AALftN6zAAA=';
const UNKNOWN_CALENDAR_ID = 'AAMkUNKNOWNXYZ123notInConfigJson===';

describe('Cross-Mailbox Publish Resolution (PCM)', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('publishCrossMailbox'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    graphApiMock.resetMocks();

    approverUser = createApprover();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, requesterUser]);

    approverToken = await createMockToken(approverUser);
  });

  // PCM-1 — the actual user-reported bug.
  it('PCM-1: targetCalendar=<production-id> with stored sandbox owner publishes to production mailbox', async () => {
    const pending = createPendingEvent({
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      eventTitle: 'PCM-1 Cross Mailbox',
      calendarOwner: SANDBOX_OWNER,
      calendarId: SANDBOX_CALENDAR_ID,
    });
    const [saved] = await insertEvents(db, [pending]);

    await request(app)
      .put(`/api/admin/events/${saved._id}/publish`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({
        createCalendarEvent: true,
        targetCalendar: PRODUCTION_CALENDAR_ID,
      })
      .expect(200);

    const calls = graphApiMock.getCallHistory('createCalendarEvent');
    expect(calls).toHaveLength(1);
    expect(calls[0].calendarOwner).toBe(PRODUCTION_OWNER);
    expect(calls[0].calendarId).toBe(PRODUCTION_CALENDAR_ID);
  });

  // PCM-2 — email-form override is unchanged by the fix.
  it('PCM-2: targetCalendar=email@form keeps email as owner and null calendarId', async () => {
    const pending = createPendingEvent({
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      eventTitle: 'PCM-2 Email Form',
      calendarOwner: SANDBOX_OWNER,
    });
    const [saved] = await insertEvents(db, [pending]);

    await request(app)
      .put(`/api/admin/events/${saved._id}/publish`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({
        createCalendarEvent: true,
        targetCalendar: 'someone@example.com',
      })
      .expect(200);

    const calls = graphApiMock.getCallHistory('createCalendarEvent');
    expect(calls).toHaveLength(1);
    expect(calls[0].calendarOwner).toBe('someone@example.com');
    expect(calls[0].calendarId).toBeNull();
  });

  // PCM-3 — unknown calendar IDs are safe: fall through to event.calendarOwner.
  it('PCM-3: unknown targetCalendar falls back to event.calendarOwner (no regression)', async () => {
    const pending = createPendingEvent({
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      eventTitle: 'PCM-3 Unknown Cal',
      calendarOwner: SANDBOX_OWNER,
    });
    const [saved] = await insertEvents(db, [pending]);

    await request(app)
      .put(`/api/admin/events/${saved._id}/publish`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({
        createCalendarEvent: true,
        targetCalendar: UNKNOWN_CALENDAR_ID,
      })
      .expect(200);

    const calls = graphApiMock.getCallHistory('createCalendarEvent');
    expect(calls).toHaveLength(1);
    expect(calls[0].calendarOwner).toBe(SANDBOX_OWNER);
    expect(calls[0].calendarId).toBe(UNKNOWN_CALENDAR_ID);
  });

  // PCM-4 — no targetCalendar: existing behavior (use event-stored owner/calendarId).
  it('PCM-4: no targetCalendar uses event.calendarOwner / event.calendarId unchanged', async () => {
    const pending = createPendingEvent({
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      eventTitle: 'PCM-4 No Override',
      calendarOwner: SANDBOX_OWNER,
      calendarId: SANDBOX_CALENDAR_ID,
    });
    const [saved] = await insertEvents(db, [pending]);

    await request(app)
      .put(`/api/admin/events/${saved._id}/publish`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ createCalendarEvent: true })
      .expect(200);

    const calls = graphApiMock.getCallHistory('createCalendarEvent');
    expect(calls).toHaveLength(1);
    expect(calls[0].calendarOwner).toBe(SANDBOX_OWNER);
    expect(calls[0].calendarId).toBe(SANDBOX_CALENDAR_ID);
  });
});
