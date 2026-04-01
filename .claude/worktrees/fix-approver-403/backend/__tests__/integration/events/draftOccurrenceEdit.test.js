/**
 * Draft Occurrence Edit Tests (DOE-1 to DOE-10)
 *
 * Tests per-occurrence editing of draft recurring events:
 * - thisEvent scope writes to occurrenceOverrides without touching recurrence/eventType
 * - allEvents scope preserves occurrenceOverrides when recurrence unchanged
 * - allEvents scope clears occurrenceOverrides when recurrence pattern/range changes
 * - Occurrence date validation against series range
 * - Multiple thisEvent edits accumulate correctly
 * - Calendar load normalizer promotes recurrence to top level
 * - DOE-8, DOE-9: New trackable override fields
 * - DOE-10: Null-time overrides ([Hold] occurrence support)
 */

const request = require('supertest');

const { createTestApp, setTestDatabase } = require('../../__helpers__/testApp');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const {
  createRequester,
  createApprover,
  insertUsers,
} = require('../../__helpers__/userFactory');
const {
  createDraftEvent,
  createRecurringSeriesMaster,
  insertEvents,
} = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, STATUS, TEST_CALENDAR_OWNER } = require('../../__helpers__/testConstants');

describe('Draft Occurrence Edit Tests (DOE-1 to DOE-7)', () => {
  let mongoClient;
  let db;
  let app;
  let requesterUser, approverUser;
  let requesterToken, approverToken;

  beforeAll(async () => {
    await initTestKeys();

    ({ db, client: mongoClient } = await connectToGlobalServer('draftOccurrenceEdit'));

    setTestDatabase(db);
    app = createTestApp();
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    requesterUser = createRequester();
    approverUser = createApprover();
    await insertUsers(db, [requesterUser, approverUser]);

    requesterToken = await createMockToken(requesterUser);
    approverToken = await createMockToken(approverUser);
  });

  /**
   * Helper to create a recurring draft with daily pattern 3/11-3/13
   */
  function createRecurringDraft(overrides = {}) {
    const recurrence = {
      pattern: { type: 'daily', interval: 1 },
      range: { type: 'endDate', startDate: '2026-03-11', endDate: '2026-03-13' },
      additions: [],
      exclusions: [],
    };
    const startDateTime = new Date('2026-03-11T14:00:00');
    const endDateTime = new Date('2026-03-11T15:00:00');

    return createDraftEvent({
      userId: requesterUser.odataId,
      requesterEmail: requesterUser.email,
      eventType: 'seriesMaster',
      recurrence,
      startDateTime,
      endDateTime,
      calendarData: {
        eventTitle: 'Recurring Draft',
        eventDescription: 'Test recurring draft',
        startDateTime: '2026-03-11T14:00:00',
        endDateTime: '2026-03-11T15:00:00',
        startDate: '2026-03-11',
        startTime: '14:00',
        endDate: '2026-03-11',
        endTime: '15:00',
        locations: [],
        locationDisplayNames: '',
        categories: ['Meeting'],
        recurrence,
        setupTimeMinutes: 0,
        teardownTimeMinutes: 0,
      },
      ...overrides,
    });
  }

  describe('DOE-1: thisEvent save writes to occurrenceOverrides', () => {
    it('should write override without changing recurrence or eventType', async () => {
      const draft = createRecurringDraft();
      await insertEvents(db, [draft]);

      const res = await request(app)
        .put(`/api/room-reservations/draft/${draft._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          eventTitle: 'Modified Occurrence',
          startTime: '16:00',
          endTime: '17:00',
        });

      expect(res.status).toBe(200);

      // Verify the override was written
      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: draft._id });
      expect(updated.occurrenceOverrides).toHaveLength(1);
      expect(updated.occurrenceOverrides[0].occurrenceDate).toBe('2026-03-12');
      expect(updated.occurrenceOverrides[0].startTime).toBe('16:00');
      expect(updated.occurrenceOverrides[0].endTime).toBe('17:00');
      expect(updated.occurrenceOverrides[0].eventTitle).toBe('Modified Occurrence');

      // Verify recurrence and eventType are NOT changed
      expect(updated.calendarData.recurrence).toEqual(draft.calendarData.recurrence);
      expect(updated.eventType).toBe('seriesMaster');
    });
  });

  describe('DOE-2: allEvents save preserves occurrenceOverrides when recurrence unchanged', () => {
    it('should preserve overrides when saving allEvents with same recurrence', async () => {
      const draft = createRecurringDraft({
        occurrenceOverrides: [
          { occurrenceDate: '2026-03-12', startTime: '16:00', endTime: '17:00' },
        ],
      });
      await insertEvents(db, [draft]);

      const res = await request(app)
        .put(`/api/room-reservations/draft/${draft._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          editScope: 'allEvents',
          eventTitle: 'Updated All Events',
          startDate: '2026-03-11',
          endDate: '2026-03-11',
          startTime: '14:00',
          endTime: '15:00',
          recurrence: draft.calendarData.recurrence,
        });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: draft._id });
      expect(updated.occurrenceOverrides).toHaveLength(1);
      expect(updated.occurrenceOverrides[0].occurrenceDate).toBe('2026-03-12');
      expect(updated.calendarData.eventTitle).toBe('Updated All Events');
    });
  });

  describe('DOE-3: thisEvent with occurrenceDate outside series range', () => {
    it('should return 400 when occurrence date is outside range', async () => {
      const draft = createRecurringDraft();
      await insertEvents(db, [draft]);

      const res = await request(app)
        .put(`/api/room-reservations/draft/${draft._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-04-15',
          eventTitle: 'Out of range',
          startTime: '10:00',
          endTime: '11:00',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/outside series range/i);
    });
  });

  describe('DOE-4: Multiple thisEvent edits accumulate correctly', () => {
    it('should accumulate overrides for different dates', async () => {
      const draft = createRecurringDraft();
      await insertEvents(db, [draft]);

      // Edit occurrence on 3/12
      await request(app)
        .put(`/api/room-reservations/draft/${draft._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          eventTitle: 'Modified 3/12',
          startTime: '16:00',
          endTime: '17:00',
        });

      // Edit occurrence on 3/13
      await request(app)
        .put(`/api/room-reservations/draft/${draft._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-13',
          eventTitle: 'Modified 3/13',
          startTime: '10:00',
          endTime: '11:00',
        });

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: draft._id });
      expect(updated.occurrenceOverrides).toHaveLength(2);

      const override12 = updated.occurrenceOverrides.find(o => o.occurrenceDate === '2026-03-12');
      const override13 = updated.occurrenceOverrides.find(o => o.occurrenceDate === '2026-03-13');
      expect(override12.eventTitle).toBe('Modified 3/12');
      expect(override12.startTime).toBe('16:00');
      expect(override13.eventTitle).toBe('Modified 3/13');
      expect(override13.startTime).toBe('10:00');
    });

    it('should replace existing override for same date', async () => {
      const draft = createRecurringDraft();
      await insertEvents(db, [draft]);

      // First edit on 3/12
      await request(app)
        .put(`/api/room-reservations/draft/${draft._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          eventTitle: 'First edit',
          startTime: '16:00',
          endTime: '17:00',
        });

      // Second edit on same date 3/12
      await request(app)
        .put(`/api/room-reservations/draft/${draft._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          eventTitle: 'Second edit',
          startTime: '18:00',
          endTime: '19:00',
        });

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: draft._id });
      expect(updated.occurrenceOverrides).toHaveLength(1);
      expect(updated.occurrenceOverrides[0].eventTitle).toBe('Second edit');
      expect(updated.occurrenceOverrides[0].startTime).toBe('18:00');
    });
  });

  describe('DOE-6: allEvents with recurrence change clears occurrenceOverrides', () => {
    it('should clear overrides when recurrence pattern changes', async () => {
      const draft = createRecurringDraft({
        occurrenceOverrides: [
          { occurrenceDate: '2026-03-12', startTime: '16:00', endTime: '17:00' },
        ],
      });
      await insertEvents(db, [draft]);

      const changedRecurrence = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
        range: { type: 'endDate', startDate: '2026-03-11', endDate: '2026-04-01' },
        additions: [],
        exclusions: [],
      };

      const res = await request(app)
        .put(`/api/room-reservations/draft/${draft._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          editScope: 'allEvents',
          clearOccurrenceOverrides: true,
          eventTitle: 'Changed Pattern',
          startDate: '2026-03-11',
          endDate: '2026-03-11',
          startTime: '14:00',
          endTime: '15:00',
          recurrence: changedRecurrence,
        });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: draft._id });
      expect(updated.occurrenceOverrides).toEqual([]);
      expect(updated.calendarData.eventTitle).toBe('Changed Pattern');
      expect(updated.calendarData.recurrence.pattern.type).toBe('weekly');
    });
  });

  describe('DOE-7: allEvents without recurrence change preserves overrides and updates fields', () => {
    it('should update series-level fields while keeping overrides intact', async () => {
      const draft = createRecurringDraft({
        occurrenceOverrides: [
          { occurrenceDate: '2026-03-12', startTime: '16:00', endTime: '17:00', eventTitle: 'Custom 3/12' },
          { occurrenceDate: '2026-03-13', categories: ['Special'] },
        ],
      });
      await insertEvents(db, [draft]);

      const res = await request(app)
        .put(`/api/room-reservations/draft/${draft._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          editScope: 'allEvents',
          eventTitle: 'New Series Title',
          categories: ['Program'],
          startDate: '2026-03-11',
          endDate: '2026-03-11',
          startTime: '14:00',
          endTime: '15:00',
          recurrence: draft.calendarData.recurrence,
        });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: draft._id });
      // Series-level fields updated
      expect(updated.calendarData.eventTitle).toBe('New Series Title');
      expect(updated.calendarData.categories).toEqual(['Program']);
      // Overrides preserved
      expect(updated.occurrenceOverrides).toHaveLength(2);
      expect(updated.occurrenceOverrides[0].occurrenceDate).toBe('2026-03-12');
      expect(updated.occurrenceOverrides[0].eventTitle).toBe('Custom 3/12');
      expect(updated.occurrenceOverrides[1].occurrenceDate).toBe('2026-03-13');
      expect(updated.occurrenceOverrides[1].categories).toEqual(['Special']);
    });
  });

  describe('DOE-5: Calendar load returns draft with recurrence at top level', () => {
    it('should promote calendarData.recurrence to top-level recurrence', async () => {
      const draft = createRecurringDraft();
      await insertEvents(db, [draft]);

      const res = await request(app)
        .post('/api/events/calendar-load')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          calendarOwner: TEST_CALENDAR_OWNER,
          startDate: '2026-03-01T00:00:00',
          endDate: '2026-03-31T23:59:59',
        });

      expect(res.status).toBe(200);
      const events = res.body.events;
      const found = events.find(e => String(e._id) === String(draft._id));
      expect(found).toBeDefined();

      // Verify recurrence is promoted to top level
      expect(found.recurrence).toBeDefined();
      expect(found.recurrence.pattern.type).toBe('daily');
      expect(found.recurrence.range.startDate).toBe('2026-03-11');
      expect(found.recurrence.range.endDate).toBe('2026-03-13');
    });
  });

  describe('DOE-8: thisEvent save with attendeeCount stores in override', () => {
    it('should store attendeeCount in override', async () => {
      const draft = createRecurringDraft();
      await insertEvents(db, [draft]);

      const res = await request(app)
        .put(`/api/room-reservations/draft/${draft._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          attendeeCount: 25,
        });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: draft._id });
      const override = updated.occurrenceOverrides[0];
      expect(override.occurrenceDate).toBe('2026-03-12');
      expect(override.attendeeCount).toBe(25);
    });
  });

  describe('DOE-9: thisEvent save with note and offsite fields stores in override', () => {
    it('should store eventNotes, setupNotes, doorNotes, specialRequirements, and offsite fields', async () => {
      const draft = createRecurringDraft();
      await insertEvents(db, [draft]);

      const res = await request(app)
        .put(`/api/room-reservations/draft/${draft._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          eventNotes: 'Draft event notes',
          setupNotes: 'Need extra tables',
          doorNotes: 'Front entrance only',
          specialRequirements: 'Projector needed',
          isOffsite: true,
          offsiteName: 'Park Pavilion',
          offsiteAddress: '100 Park Ave',
        });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: draft._id });
      const override = updated.occurrenceOverrides[0];
      expect(override.occurrenceDate).toBe('2026-03-12');
      expect(override.eventNotes).toBe('Draft event notes');
      expect(override.setupNotes).toBe('Need extra tables');
      expect(override.doorNotes).toBe('Front entrance only');
      expect(override.specialRequirements).toBe('Projector needed');
      expect(override.isOffsite).toBe(true);
      expect(override.offsiteName).toBe('Park Pavilion');
      expect(override.offsiteAddress).toBe('100 Park Ave');
    });
  });

  describe('DOE-10: thisEvent save with null startTime/endTime stores null times and null datetimes', () => {
    it('should store startTime: null, endTime: null, startDateTime: null, endDateTime: null in override', async () => {
      const draft = createRecurringDraft();
      await insertEvents(db, [draft]);

      const res = await request(app)
        .put(`/api/room-reservations/draft/${draft._id}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          editScope: 'thisEvent',
          occurrenceDate: '2026-03-12',
          startTime: null,
          endTime: null,
          reservationStartTime: '13:30',
          reservationEndTime: '15:30',
        });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ _id: draft._id });
      expect(updated.occurrenceOverrides).toHaveLength(1);

      const override = updated.occurrenceOverrides[0];
      expect(override.occurrenceDate).toBe('2026-03-12');
      expect(override.startTime).toBeNull();
      expect(override.endTime).toBeNull();
      expect(override.startDateTime).toBeNull();
      expect(override.endDateTime).toBeNull();
      // Reservation times should still be stored
      expect(override.reservationStartTime).toBe('13:30');
      expect(override.reservationEndTime).toBe('15:30');
    });
  });
});
