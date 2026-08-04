/**
 * Event Reassignment Tests (ER-1 to ER-16)
 *
 * Tests PUT /api/admin/events/:id/reassign — approver-initiated transfer of
 * event ownership (roomReservationData.requestedBy) to another registered user.
 *
 * Covers: happy path with server-resolved identity, ownership-query follow-through,
 * permission gate, guards (deleted / already-owner / incomplete target / child
 * documents), optimistic concurrency, series-master cascade, audit entry, and
 * new-owner-only email notification.
 */

const request = require('supertest');

const { setupTestApp } = require('../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../__helpers__/testSetup');
const {
  createApprover,
  createRequester,
  createOtherRequester,
  createViewer,
  insertUsers,
} = require('../__helpers__/userFactory');
const {
  createPendingEvent,
  createDeletedEvent,
  createRecurringSeriesMaster,
  createExceptionDocument,
  createAdditionDocument,
  insertEvents,
} = require('../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, ENDPOINTS } = require('../__helpers__/testConstants');
const emailService = require('../../services/emailService');

const reassignUrl = (id) => `/api/admin/events/${id}/reassign`;

describe('Event Reassignment Tests (ER-1 to ER-16)', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let emilyUser;      // current owner (requester role)
  let emilyToken;
  let jeannetteUser;  // reassignment target (requester role)
  let jeannetteToken;
  let viewerUser;
  let viewerToken;
  let emailSpy;

  beforeAll(async () => {
    await initTestKeys();

    ({ db, client: mongoClient } = await connectToGlobalServer('eventReassignment'));

    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    approverUser = createApprover();
    emilyUser = createRequester({
      displayName: 'Emily Assistant',
      department: 'Clergy Office',
      phone: '555-1111',
    });
    jeannetteUser = createOtherRequester({
      displayName: 'Jeannette Assistant',
      department: 'Rabbinic Office',
      phone: '555-2222',
    });
    viewerUser = createViewer();

    await insertUsers(db, [approverUser, emilyUser, jeannetteUser, viewerUser]);

    approverToken = await createMockToken(approverUser);
    emilyToken = await createMockToken(emilyUser);
    jeannetteToken = await createMockToken(jeannetteUser);
    viewerToken = await createMockToken(viewerUser);

    emailSpy = jest
      .spyOn(emailService, 'sendReassignmentNotification')
      .mockResolvedValue({ success: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Build + insert a pending event owned by Emily. */
  async function insertEmilyEvent(overrides = {}) {
    const event = createPendingEvent({
      userId: emilyUser.userId,
      requesterEmail: emilyUser.email,
      requesterName: emilyUser.displayName,
      department: emilyUser.department,
      phone: emilyUser.phone,
      eventTitle: 'Shabbat Dinner Setup',
      ...overrides,
    });
    const [saved] = await insertEvents(db, [event]);
    return saved;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Happy path
  // ──────────────────────────────────────────────────────────────────────────

  describe('Successful reassignment', () => {
    it('ER-1: approver reassigns a pending event — 200, server-resolved identity, version bump', async () => {
      const saved = await insertEmilyEvent();

      const res = await request(app)
        .put(reassignUrl(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ targetUserId: String(jeannetteUser._id), expectedVersion: saved._version })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body._version).toBe(saved._version + 1);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      const owner = updated.roomReservationData.requestedBy;
      expect(owner.email).toBe(jeannetteUser.email.toLowerCase());
      expect(owner.name).toBe(jeannetteUser.displayName);
      expect(owner.department).toBe(jeannetteUser.department);
      expect(owner.phone).toBe(jeannetteUser.phone);
      expect(owner.userId).toBe(jeannetteUser.userId);
      expect(updated._version).toBe(saved._version + 1);
      expect(updated.lastModifiedBy).toBe(approverUser.email);
      expect(updated.lastModifiedDateTime).toBeInstanceOf(Date);
    });

    it('ER-2: client-supplied identity fields are ignored — server resolves from the user record', async () => {
      const saved = await insertEmilyEvent();

      await request(app)
        .put(reassignUrl(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({
          targetUserId: String(jeannetteUser._id),
          expectedVersion: saved._version,
          // Spoofed identity — must not reach the document
          requestedBy: { email: 'attacker@example.com', name: 'Attacker' },
          email: 'attacker@example.com',
          name: 'Attacker',
        })
        .expect(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(updated.roomReservationData.requestedBy.email).toBe(jeannetteUser.email.toLowerCase());
      expect(updated.roomReservationData.requestedBy.name).toBe(jeannetteUser.displayName);
    });

    it('ER-3: ownership queries follow the transfer (my-events moves lists)', async () => {
      const saved = await insertEmilyEvent();

      const beforeEmily = await request(app)
        .get(`${ENDPOINTS.LIST_EVENTS}?view=my-events&status=pending`)
        .set('Authorization', `Bearer ${emilyToken}`)
        .expect(200);
      expect(beforeEmily.body.events).toHaveLength(1);

      await request(app)
        .put(reassignUrl(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ targetUserId: String(jeannetteUser._id), expectedVersion: saved._version })
        .expect(200);

      const afterEmily = await request(app)
        .get(`${ENDPOINTS.LIST_EVENTS}?view=my-events&status=pending`)
        .set('Authorization', `Bearer ${emilyToken}`)
        .expect(200);
      expect(afterEmily.body.events).toHaveLength(0);

      const afterJeannette = await request(app)
        .get(`${ENDPOINTS.LIST_EVENTS}?view=my-events&status=pending`)
        .set('Authorization', `Bearer ${jeannetteToken}`)
        .expect(200);
      expect(afterJeannette.body.events).toHaveLength(1);
      expect(afterJeannette.body.events[0].eventId).toBe(saved.eventId);
    });

    it('ER-4: every non-deleted status is reassignable', async () => {
      for (const status of [STATUS.DRAFT, STATUS.PENDING, STATUS.PUBLISHED, STATUS.REJECTED]) {
        const saved = await insertEmilyEvent({ status, eventId: `reassign-${status}` });

        await request(app)
          .put(reassignUrl(saved._id))
          .set('Authorization', `Bearer ${approverToken}`)
          .send({ targetUserId: String(jeannetteUser._id), expectedVersion: saved._version })
          .expect(200);

        const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
        expect(updated.roomReservationData.requestedBy.email).toBe(jeannetteUser.email.toLowerCase());
        expect(updated.status).toBe(status);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Guards
  // ──────────────────────────────────────────────────────────────────────────

  describe('Guards', () => {
    it('ER-5: requester (non-approver) is rejected — 403, event unchanged', async () => {
      const saved = await insertEmilyEvent();

      await request(app)
        .put(reassignUrl(saved._id))
        .set('Authorization', `Bearer ${emilyToken}`)
        .send({ targetUserId: String(jeannetteUser._id), expectedVersion: saved._version })
        .expect(403);

      const unchanged = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(unchanged.roomReservationData.requestedBy.email).toBe(emilyUser.email);
      expect(unchanged._version).toBe(saved._version);
    });

    it('ER-6: viewer is rejected — 403', async () => {
      const saved = await insertEmilyEvent();

      await request(app)
        .put(reassignUrl(saved._id))
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ targetUserId: String(jeannetteUser._id), expectedVersion: saved._version })
        .expect(403);
    });

    it('ER-7: unknown event — 404', async () => {
      const missingId = '507f1f77bcf86cd799439011';

      await request(app)
        .put(reassignUrl(missingId))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ targetUserId: String(jeannetteUser._id), expectedVersion: 1 })
        .expect(404);
    });

    it('ER-8: unknown target user — 404, nothing written', async () => {
      const saved = await insertEmilyEvent();

      await request(app)
        .put(reassignUrl(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ targetUserId: '507f1f77bcf86cd799439099', expectedVersion: saved._version })
        .expect(404);

      const unchanged = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(unchanged.roomReservationData.requestedBy.email).toBe(emilyUser.email);
      expect(unchanged._version).toBe(saved._version);
    });

    it('ER-9: missing targetUserId — 400', async () => {
      const saved = await insertEmilyEvent();

      const res = await request(app)
        .put(reassignUrl(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ expectedVersion: saved._version })
        .expect(400);

      expect(res.body.error).toMatch(/targetUserId/i);
    });

    it('ER-10: deleted event — 400 EVENT_DELETED', async () => {
      const deleted = createDeletedEvent({
        userId: emilyUser.userId,
        requesterEmail: emilyUser.email,
      });
      const [saved] = await insertEvents(db, [deleted]);

      const res = await request(app)
        .put(reassignUrl(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ targetUserId: String(jeannetteUser._id), expectedVersion: saved._version })
        .expect(400);

      expect(res.body.code).toBe('EVENT_DELETED');
    });

    it('ER-11: target already owns the event (case-insensitive) — 400 ALREADY_OWNER', async () => {
      const saved = await insertEmilyEvent({
        requesterEmail: jeannetteUser.email.toUpperCase(),
      });

      const res = await request(app)
        .put(reassignUrl(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ targetUserId: String(jeannetteUser._id), expectedVersion: saved._version })
        .expect(400);

      expect(res.body.code).toBe('ALREADY_OWNER');

      const unchanged = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(unchanged._version).toBe(saved._version);
    });

    it('ER-12: target user record has no email — 400 TARGET_USER_INCOMPLETE, nothing written', async () => {
      const saved = await insertEmilyEvent();
      await db.collection(COLLECTIONS.USERS).updateOne(
        { _id: jeannetteUser._id },
        { $unset: { email: '' } }
      );

      const res = await request(app)
        .put(reassignUrl(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ targetUserId: String(jeannetteUser._id), expectedVersion: saved._version })
        .expect(400);

      expect(res.body.code).toBe('TARGET_USER_INCOMPLETE');

      const unchanged = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(unchanged.roomReservationData.requestedBy.email).toBe(emilyUser.email);
      expect(unchanged._version).toBe(saved._version);
    });

    it('ER-13: exception/addition children are not independently reassignable — 400 INVALID_TARGET_EVENT_TYPE', async () => {
      const master = createRecurringSeriesMaster({
        userId: emilyUser.userId,
        requesterEmail: emilyUser.email,
        status: STATUS.PENDING,
      });
      const exception = createExceptionDocument(master, '2026-03-17', { startTime: '14:00' });
      const addition = createAdditionDocument(master, '2026-04-07');
      const [, savedException, savedAddition] = await insertEvents(db, [master, exception, addition]);

      for (const child of [savedException, savedAddition]) {
        const res = await request(app)
          .put(reassignUrl(child._id))
          .set('Authorization', `Bearer ${approverToken}`)
          .send({ targetUserId: String(jeannetteUser._id), expectedVersion: child._version })
          .expect(400);

        expect(res.body.code).toBe('INVALID_TARGET_EVENT_TYPE');
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Optimistic concurrency
  // ──────────────────────────────────────────────────────────────────────────

  describe('Optimistic concurrency', () => {
    it('ER-14: stale expectedVersion — 409 VERSION_CONFLICT, ownership unchanged', async () => {
      const saved = await insertEmilyEvent();

      const res = await request(app)
        .put(reassignUrl(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ targetUserId: String(jeannetteUser._id), expectedVersion: saved._version + 5 })
        .expect(409);

      expect(res.body.details.code).toBe('VERSION_CONFLICT');
      expect(res.body.details.currentVersion).toBe(saved._version);

      const unchanged = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(unchanged.roomReservationData.requestedBy.email).toBe(emilyUser.email);
      expect(unchanged._version).toBe(saved._version);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Series master cascade
  // ──────────────────────────────────────────────────────────────────────────

  describe('Series master cascade', () => {
    it('ER-15: master cascades new ownership to non-deleted children only', async () => {
      const master = createRecurringSeriesMaster({
        userId: emilyUser.userId,
        requesterEmail: emilyUser.email,
        status: STATUS.PENDING,
      });
      const childA = createExceptionDocument(master, '2026-03-17', { startTime: '14:00' });
      const childB = createExceptionDocument(master, '2026-03-24', { startTime: '15:00' });
      const childDeleted = createExceptionDocument(
        master,
        '2026-03-31',
        { startTime: '16:00' },
        { isDeleted: true, status: STATUS.DELETED }
      );
      const [savedMaster, savedA, savedB, savedDeleted] = await insertEvents(
        db, [master, childA, childB, childDeleted]
      );

      await request(app)
        .put(reassignUrl(savedMaster._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ targetUserId: String(jeannetteUser._id), expectedVersion: savedMaster._version })
        .expect(200);

      const events = db.collection(COLLECTIONS.EVENTS);
      for (const id of [savedA._id, savedB._id]) {
        const child = await events.findOne({ _id: id });
        expect(child.roomReservationData.requestedBy.email).toBe(jeannetteUser.email.toLowerCase());
      }

      const stillDeleted = await events.findOne({ _id: savedDeleted._id });
      expect(stillDeleted.roomReservationData.requestedBy.email).toBe(emilyUser.email);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Audit + notification
  // ──────────────────────────────────────────────────────────────────────────

  describe('Audit and notification', () => {
    it('ER-16: audit entry records the previous and new owner', async () => {
      const saved = await insertEmilyEvent();

      await request(app)
        .put(reassignUrl(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ targetUserId: String(jeannetteUser._id), expectedVersion: saved._version })
        .expect(200);

      const audit = await db.collection(COLLECTIONS.AUDIT_HISTORY).findOne({
        eventId: saved.eventId,
        action: 'ownership-reassigned',
      });

      expect(audit).toBeTruthy();
      expect(audit.performedByEmail).toBe(approverUser.email);
      expect(audit.metadata.from.email).toBe(emilyUser.email);
      expect(audit.metadata.from.name).toBe(emilyUser.displayName);
      expect(audit.metadata.to.email).toBe(jeannetteUser.email.toLowerCase());
      expect(audit.metadata.to.name).toBe(jeannetteUser.displayName);
    });

    it('ER-17: only the new owner is emailed — no notification reaches the previous owner', async () => {
      // Every other requester-facing notification helper routes to the event's
      // requestedBy.email. Spying on all of them proves the reassign path emails
      // exactly once, and sendReassignmentNotification derives its recipient
      // from the newOwner argument (not the event), so the recipient is Jeannette.
      const otherSenders = [
        'sendEventUpdatedNotification',
        'sendPublishNotification',
        'sendRejectionNotification',
        'sendDeletionNotification',
        'sendResubmissionConfirmation',
      ].map(fn => jest.spyOn(emailService, fn).mockResolvedValue({ success: true }));

      const saved = await insertEmilyEvent();

      await request(app)
        .put(reassignUrl(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ targetUserId: String(jeannetteUser._id), expectedVersion: saved._version })
        .expect(200);

      expect(emailSpy).toHaveBeenCalledTimes(1);
      const [, newOwnerArg] = emailSpy.mock.calls[0];
      expect(newOwnerArg.email).toBe(jeannetteUser.email.toLowerCase());
      expect(newOwnerArg.email).not.toBe(emilyUser.email);

      otherSenders.forEach(spy => expect(spy).not.toHaveBeenCalled());
    });

    it('ER-19: the recipient comes from the newOwner argument, never from the event document', async () => {
      // Guards against a regression where the helper falls back to
      // extractRecipientEmail(event) and mails whoever the document names.
      // With no newOwner email it must bail out — even though the event
      // document carries a perfectly usable requestedBy.email (Emily's).
      emailSpy.mockRestore();

      const eventNamingEmily = {
        _id: 'abc',
        eventTitle: 'Shabbat Dinner Setup',
        roomReservationData: { requestedBy: { name: 'Emily Assistant', email: emilyUser.email } },
      };

      const result = await emailService.sendReassignmentNotification(
        eventNamingEmily,
        { name: 'Jeannette Assistant' }, // email deliberately missing
        'Test Approver'
      );

      expect(result).toEqual({ success: false, error: 'No recipient email' });
    });

    it('ER-18: email failure does not fail the transfer', async () => {
      emailSpy.mockRejectedValue(new Error('SMTP down'));
      const saved = await insertEmilyEvent();

      await request(app)
        .put(reassignUrl(saved._id))
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ targetUserId: String(jeannetteUser._id), expectedVersion: saved._version })
        .expect(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: saved._id });
      expect(updated.roomReservationData.requestedBy.email).toBe(jeannetteUser.email.toLowerCase());
    });
  });
});
