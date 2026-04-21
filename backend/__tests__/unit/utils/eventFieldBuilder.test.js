/**
 * Unit tests for eventFieldBuilder utility
 *
 * Tests: computeDateTimes, normalizeLocationIds, buildEventFields,
 *        buildRequestedByObject, buildStatusHistoryEntry, remapToCalendarData,
 *        CALENDAR_DATA_FIELDS
 */

const { ObjectId } = require('mongodb');
const {
  buildEventFields,
  buildRequestedByObject,
  buildStatusHistoryEntry,
  CALENDAR_DATA_FIELDS,
  normalizeLocationIds,
  remapToCalendarData,
  computeDateTimes,
} = require('../../../utils/eventFieldBuilder');

// ---------------------------------------------------------------------------
// Mock locationUtils — unit tests should not hit MongoDB
// ---------------------------------------------------------------------------
jest.mock('../../../utils/locationUtils', () => ({
  calculateLocationDisplayNames: jest.fn(async (ids) => {
    // Return semicolon-joined fake names based on ID count
    return ids.map((_, i) => `Room ${i + 1}`).join('; ');
  }),
}));

const { calculateLocationDisplayNames } = require('../../../utils/locationUtils');

// ---------------------------------------------------------------------------
// computeDateTimes
// ---------------------------------------------------------------------------
describe('computeDateTimes', () => {
  test('strategy 1: provided ISO datetime with Z suffix stripped', () => {
    const result = computeDateTimes({
      startDateTime: '2026-03-15T10:00:00Z',
      endDateTime: '2026-03-15T12:00:00Z',
    });

    expect(result.startDateTime).toBe('2026-03-15T10:00:00');
    expect(result.endDateTime).toBe('2026-03-15T12:00:00');
    expect(result.startDate).toBe('2026-03-15');
    expect(result.startTime).toBe('10:00');
    expect(result.endDate).toBe('2026-03-15');
    expect(result.endTime).toBe('12:00');
  });

  test('strategy 1: provided ISO datetime without Z suffix', () => {
    const result = computeDateTimes({
      startDateTime: '2026-03-15T10:00:00',
      endDateTime: '2026-03-15T12:00:00',
    });

    expect(result.startDateTime).toBe('2026-03-15T10:00:00');
    expect(result.endDateTime).toBe('2026-03-15T12:00:00');
  });

  test('strategy 2: constructed from date + time parts', () => {
    const result = computeDateTimes({
      startDate: '2026-03-15',
      startTime: '09:30',
      endDate: '2026-03-15',
      endTime: '11:30',
    });

    expect(result.startDateTime).toBe('2026-03-15T09:30:00');
    expect(result.endDateTime).toBe('2026-03-15T11:30:00');
    expect(result.startDate).toBe('2026-03-15');
    expect(result.startTime).toBe('09:30');
    expect(result.endDate).toBe('2026-03-15');
    expect(result.endTime).toBe('11:30');
  });

  test('strategy 2: falls back to reservationStartTime when startTime missing', () => {
    const result = computeDateTimes({
      startDate: '2026-03-15',
      reservationStartTime: '08:00',
      endDate: '2026-03-15',
      reservationEndTime: '14:00',
    });

    expect(result.startDateTime).toBe('2026-03-15T08:00:00');
    expect(result.endDateTime).toBe('2026-03-15T14:00:00');
  });

  test('strategy 2: defaults to 00:00/23:59 when no time parts', () => {
    const result = computeDateTimes({
      startDate: '2026-03-15',
      endDate: '2026-03-15',
    });

    expect(result.startDateTime).toBe('2026-03-15T00:00:00');
    expect(result.endDateTime).toBe('2026-03-15T23:59:00');
  });

  test('strategy 3: null when no date or datetime provided', () => {
    const result = computeDateTimes({});

    expect(result.startDateTime).toBe(null);
    expect(result.endDateTime).toBe(null);
    expect(result.startDate).toBe(null);
    expect(result.startTime).toBe(null);
    expect(result.endDate).toBe(null);
    expect(result.endTime).toBe(null);
  });

  test('[Hold] detection: eventStartTime empty string preserved', () => {
    const result = computeDateTimes({
      startDateTime: '2026-03-15T10:00:00Z',
      endDateTime: '2026-03-15T12:00:00Z',
      eventStartTime: '',
      eventEndTime: '',
    });

    // Empty string signals [Hold] — must NOT become null
    expect(result.startTime).toBe('');
    expect(result.endTime).toBe('');
    // DateTimes still computed
    expect(result.startDateTime).toBe('2026-03-15T10:00:00');
    expect(result.endDateTime).toBe('2026-03-15T12:00:00');
  });

  test('[Hold] detection: eventStartTime with value overrides derived time', () => {
    const result = computeDateTimes({
      startDateTime: '2026-03-15T10:00:00Z',
      eventStartTime: '14:00',
    });

    expect(result.startTime).toBe('14:00');
  });

  test('explicit startDate/startTime take precedence over startDateTime', () => {
    // When both startDate and startDateTime are provided, startDate builds the datetime
    // but startTime from body is used directly
    const result = computeDateTimes({
      startDate: '2026-03-15',
      startTime: '09:00',
      startDateTime: '2026-03-20T14:00:00Z',
    });

    // startDateTime is provided so it wins for the composite datetime
    expect(result.startDateTime).toBe('2026-03-20T14:00:00');
    // But startDate/startTime from body are used for the components
    expect(result.startDate).toBe('2026-03-15');
    expect(result.startTime).toBe('09:00');
  });
});

// ---------------------------------------------------------------------------
// normalizeLocationIds
// ---------------------------------------------------------------------------
describe('normalizeLocationIds', () => {
  test('converts string IDs to ObjectIds', () => {
    const id = new ObjectId();
    const result = normalizeLocationIds([id.toString()]);

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(ObjectId);
    expect(result[0].toString()).toBe(id.toString());
  });

  test('passes through existing ObjectIds', () => {
    const id = new ObjectId();
    const result = normalizeLocationIds([id]);

    expect(result[0]).toBe(id);
  });

  test('handles mixed string and ObjectId input', () => {
    const id1 = new ObjectId();
    const id2 = new ObjectId();
    const result = normalizeLocationIds([id1.toString(), id2]);

    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(ObjectId);
    expect(result[1]).toBe(id2);
  });

  test('returns empty array for null/undefined/empty input', () => {
    expect(normalizeLocationIds(null)).toEqual([]);
    expect(normalizeLocationIds(undefined)).toEqual([]);
    expect(normalizeLocationIds([])).toEqual([]);
  });

  test('keeps invalid values as-is', () => {
    const result = normalizeLocationIds(['not-a-valid-objectid']);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('not-a-valid-objectid');
  });
});


// ---------------------------------------------------------------------------
// buildEventFields — mode='create'
// ---------------------------------------------------------------------------
describe('buildEventFields (mode=create)', () => {
  const mockDb = {}; // mock db, location lookup is mocked

  beforeEach(() => {
    calculateLocationDisplayNames.mockClear();
  });

  test('returns calendarDataDoc with all fields populated', async () => {
    const body = {
      eventTitle: '  Test Event  ',
      eventDescription: 'A test event',
      startDateTime: '2026-03-15T10:00:00Z',
      endDateTime: '2026-03-15T12:00:00Z',
      requestedRooms: [new ObjectId().toString()],
      attendeeCount: 50,
      categories: ['Social'],
      services: { catering: true },
      organizerName: 'Test User',
    };

    const result = await buildEventFields(body, mockDb, { mode: 'create' });

    expect(result.calendarDataDoc).toBeDefined();
    expect(result.topLevelFields).toBeDefined();
    expect(result.calendarDataFields).toBeUndefined();

    const cd = result.calendarDataDoc;
    expect(cd.eventTitle).toBe('Test Event'); // trimmed
    expect(cd.eventDescription).toBe('A test event');
    expect(cd.startDateTime).toBe('2026-03-15T10:00:00'); // Z stripped
    expect(cd.endDateTime).toBe('2026-03-15T12:00:00');
    expect(cd.locations).toHaveLength(1);
    expect(cd.locations[0]).toBeInstanceOf(ObjectId);
    expect(cd.locationDisplayNames).toBe('Room 1'); // from mock
    expect(cd.attendeeCount).toBe(50);
    expect(cd.categories).toEqual(['Social']);
    expect(cd.services).toEqual({ catering: true });
    expect(cd.organizerName).toBe('Test User');
  });

  test('defaults for missing optional fields', async () => {
    const body = {
      eventTitle: 'Minimal Event',
      startDate: '2026-03-15',
      endDate: '2026-03-15',
    };

    const { calendarDataDoc: cd } = await buildEventFields(body, mockDb, { mode: 'create' });

    expect(cd.eventDescription).toBe('');
    expect(cd.isAllDayEvent).toBe(false);
    expect(cd.setupTime).toBe(null);
    expect(cd.teardownTime).toBe(null);
    expect(cd.doorOpenTime).toBe(null);
    expect(cd.doorCloseTime).toBe(null);
    expect(cd.setupTimeMinutes).toBe(0);
    expect(cd.teardownTimeMinutes).toBe(0);
    expect(cd.setupNotes).toBe('');
    expect(cd.doorNotes).toBe('');
    expect(cd.eventNotes).toBe('');
    expect(cd.locations).toEqual([]);
    expect(cd.locationDisplayNames).toBe('');
    expect(cd.isOffsite).toBe(false);
    expect(cd.attendeeCount).toBe(null);
    expect(cd.specialRequirements).toBe('');
    expect(cd.categories).toEqual([]);
    expect(cd.services).toEqual({});
    expect(cd.assignedTo).toBe('');
    expect(cd.virtualMeetingUrl).toBe(null);
    expect(cd.recurrence).toBe(null);
    expect(cd.occurrenceOverrides).toEqual([]);
    expect(cd.requiredFeatures).toEqual([]);
    expect(cd.isOnBehalfOf).toBe(false);
    expect(cd.contactName).toBe('');
    expect(cd.contactEmail).toBe('');
    expect(cd.organizerName).toBe('');
    expect(cd.organizerPhone).toBe('');
    expect(cd.organizerEmail).toBe('');
    expect(cd.assignedRabbi).toEqual([]);
    expect(cd.assignedCantor).toEqual([]);
  });

  test('eventType derivation: singleInstance when no recurrence', async () => {
    const { topLevelFields } = await buildEventFields(
      { eventTitle: 'Single' },
      mockDb,
      { mode: 'create' }
    );

    expect(topLevelFields.eventType).toBe('singleInstance');
    expect(topLevelFields.recurrence).toBe(null);
  });

  test('eventType derivation: seriesMaster when recurrence has pattern+range', async () => {
    const body = {
      eventTitle: 'Series',
      recurrence: {
        pattern: { type: 'weekly', interval: 1 },
        range: { type: 'endDate', endDate: '2026-06-01' },
      },
    };

    const { topLevelFields } = await buildEventFields(body, mockDb, { mode: 'create' });

    expect(topLevelFields.eventType).toBe('seriesMaster');
    expect(topLevelFields.recurrence).toEqual(body.recurrence);
  });

  test('eventType: singleInstance when recurrence has pattern but no range', async () => {
    const body = {
      eventTitle: 'Incomplete',
      recurrence: { pattern: { type: 'weekly' } },
    };

    const { topLevelFields } = await buildEventFields(body, mockDb, { mode: 'create' });
    expect(topLevelFields.eventType).toBe('singleInstance');
  });

  test('offsite location: display names built from name + address', async () => {
    const body = {
      eventTitle: 'Offsite Event',
      isOffsite: true,
      offsiteName: 'Central Park',
      offsiteAddress: '59th St, New York',
    };

    const { calendarDataDoc: cd } = await buildEventFields(body, mockDb, { mode: 'create' });

    expect(cd.isOffsite).toBe(true);
    expect(cd.locationDisplayNames).toBe('Central Park (Offsite) - 59th St, New York');
    expect(cd.locations).toEqual([]);
    expect(cd.offsiteName).toBe('Central Park');
    expect(cd.offsiteAddress).toBe('59th St, New York');
    // calculateLocationDisplayNames should NOT have been called
    expect(calculateLocationDisplayNames).not.toHaveBeenCalled();
  });

  test('offsite location: display names without address', async () => {
    const body = {
      eventTitle: 'Offsite No Addr',
      isOffsite: true,
      offsiteName: 'Some Venue',
    };

    const { calendarDataDoc: cd } = await buildEventFields(body, mockDb, { mode: 'create' });

    expect(cd.locationDisplayNames).toBe('Some Venue (Offsite)');
  });

  test('offsite clears location-related fields', async () => {
    const body = {
      eventTitle: 'Offsite',
      isOffsite: true,
      offsiteName: 'Place',
    };

    const { calendarDataDoc: cd } = await buildEventFields(body, mockDb, { mode: 'create' });

    expect(cd.offsiteName).toBe('Place');
    expect(cd.offsiteAddress).toBe('');
    expect(cd.offsiteLat).toBe(null);
    expect(cd.offsiteLon).toBe(null);
  });

  test('non-offsite clears offsite fields', async () => {
    const body = {
      eventTitle: 'Onsite',
      isOffsite: false,
      offsiteName: 'Should be cleared',
      offsiteAddress: 'Should be cleared',
    };

    const { calendarDataDoc: cd } = await buildEventFields(body, mockDb, { mode: 'create' });

    expect(cd.offsiteName).toBe('');
    expect(cd.offsiteAddress).toBe('');
    expect(cd.offsiteLat).toBe(null);
    expect(cd.offsiteLon).toBe(null);
  });

  test('skipLocationResolution: stores room IDs but empty display names', async () => {
    calculateLocationDisplayNames.mockClear();
    const roomId = new ObjectId();

    const { calendarDataDoc: cd } = await buildEventFields(
      { eventTitle: 'Guest', requestedRooms: [roomId.toString()] },
      mockDb,
      { mode: 'create', skipLocationResolution: true }
    );

    expect(cd.locations).toHaveLength(1);
    expect(cd.locations[0]).toBeInstanceOf(ObjectId);
    expect(cd.locationDisplayNames).toBe('');
    expect(calculateLocationDisplayNames).not.toHaveBeenCalled();
  });

  test('isOnBehalfOf: populates contact fields', async () => {
    const body = {
      eventTitle: 'On Behalf',
      isOnBehalfOf: true,
      contactName: 'Jane Doe',
      contactEmail: 'jane@example.com',
    };

    const { calendarDataDoc: cd } = await buildEventFields(body, mockDb, { mode: 'create' });

    expect(cd.isOnBehalfOf).toBe(true);
    expect(cd.contactName).toBe('Jane Doe');
    expect(cd.contactEmail).toBe('jane@example.com');
  });

  test('isOnBehalfOf false: clears contact fields', async () => {
    const body = {
      eventTitle: 'Self',
      isOnBehalfOf: false,
      contactName: 'Should be cleared',
    };

    const { calendarDataDoc: cd } = await buildEventFields(body, mockDb, { mode: 'create' });

    expect(cd.isOnBehalfOf).toBe(false);
    expect(cd.contactName).toBe('');
    expect(cd.contactEmail).toBe('');
  });

  test('clergy fields: default to empty arrays in create mode', async () => {
    const { calendarDataDoc: cd } = await buildEventFields(
      { eventTitle: 'No Clergy' },
      mockDb,
      { mode: 'create' }
    );

    expect(cd.assignedRabbi).toEqual([]);
    expect(cd.assignedCantor).toEqual([]);
  });

  test('clergy fields: pass through array data', async () => {
    const rabbis = [{ userId: 'r1', displayName: 'Rabbi One' }, { userId: 'r2', displayName: 'Rabbi Two' }];
    const cantors = [{ userId: 'c1', displayName: 'Cantor One' }];

    const { calendarDataDoc: cd } = await buildEventFields(
      { eventTitle: 'With Clergy', assignedRabbi: rabbis, assignedCantor: cantors },
      mockDb,
      { mode: 'create' }
    );

    expect(cd.assignedRabbi).toEqual(rabbis);
    expect(cd.assignedCantor).toEqual(cantors);
  });

  test('mecCategories accepted as fallback for categories', async () => {
    const body = {
      eventTitle: 'MEC',
      mecCategories: ['Worship'],
    };

    const { calendarDataDoc: cd } = await buildEventFields(body, mockDb, { mode: 'create' });
    expect(cd.categories).toEqual(['Worship']);
  });

  test('allowedConcurrentCategories normalized to ObjectIds in topLevelFields', async () => {
    const catId = new ObjectId();
    const body = {
      eventTitle: 'Concurrent',
      isAllowedConcurrent: true,
      allowedConcurrentCategories: [catId.toString()],
    };

    const { topLevelFields } = await buildEventFields(body, mockDb, { mode: 'create' });

    expect(topLevelFields.isAllowedConcurrent).toBe(true);
    expect(topLevelFields.allowedConcurrentCategories).toHaveLength(1);
    expect(topLevelFields.allowedConcurrentCategories[0]).toBeInstanceOf(ObjectId);
  });
});

// ---------------------------------------------------------------------------
// buildEventFields — mode='update'
// ---------------------------------------------------------------------------
describe('buildEventFields (mode=update)', () => {
  const mockDb = {};

  test('returns dot-notation calendarDataFields', async () => {
    const body = {
      eventTitle: 'Updated Title',
      startDate: '2026-04-01',
      startTime: '14:00',
      endDate: '2026-04-01',
      endTime: '16:00',
    };

    const result = await buildEventFields(body, mockDb, { mode: 'update' });

    expect(result.calendarDataFields).toBeDefined();
    expect(result.calendarDataDoc).toBeUndefined();

    expect(result.calendarDataFields['calendarData.eventTitle']).toBe('Updated Title');
    expect(result.calendarDataFields['calendarData.startDateTime']).toBe('2026-04-01T14:00:00');
    expect(result.calendarDataFields['calendarData.endDateTime']).toBe('2026-04-01T16:00:00');
    expect(result.calendarDataFields['calendarData.startDate']).toBe('2026-04-01');
    expect(result.calendarDataFields['calendarData.startTime']).toBe('14:00');
  });

  test('includes all fields in dot-notation (full update)', async () => {
    const body = { eventTitle: 'Full Update' };
    const { calendarDataFields } = await buildEventFields(body, mockDb, { mode: 'update' });

    // Spot-check that common fields are present with dot-notation keys
    expect('calendarData.eventTitle' in calendarDataFields).toBe(true);
    expect('calendarData.eventDescription' in calendarDataFields).toBe(true);
    expect('calendarData.locations' in calendarDataFields).toBe(true);
    expect('calendarData.categories' in calendarDataFields).toBe(true);
    expect('calendarData.services' in calendarDataFields).toBe(true);
  });

  test('clergy fields: produces dot-notation keys in update mode', async () => {
    const rabbis = [{ userId: 'r1', displayName: 'Rabbi A' }];
    const { calendarDataFields } = await buildEventFields(
      { eventTitle: 'Clergy Update', assignedRabbi: rabbis },
      mockDb,
      { mode: 'update' }
    );

    expect(calendarDataFields['calendarData.assignedRabbi']).toEqual(rabbis);
    expect(calendarDataFields['calendarData.assignedCantor']).toEqual([]);
  });

  test('topLevelFields includes eventType in update mode', async () => {
    const body = {
      eventTitle: 'Series Update',
      recurrence: { pattern: { type: 'daily' }, range: { type: 'endDate' } },
    };

    const { topLevelFields } = await buildEventFields(body, mockDb, { mode: 'update' });
    expect(topLevelFields.eventType).toBe('seriesMaster');
  });
});

// ---------------------------------------------------------------------------
// remapToCalendarData
// ---------------------------------------------------------------------------
describe('remapToCalendarData', () => {
  test('remaps CALENDAR_DATA_FIELDS to calendarData.* keys', () => {
    const ops = {
      eventTitle: 'Admin Event',
      eventDescription: 'Desc',
      graphData: { id: 'abc' }, // NOT a calendar field
    };

    const result = remapToCalendarData(ops);

    expect(result['calendarData.eventTitle']).toBe('Admin Event');
    expect(result['calendarData.eventDescription']).toBe('Desc');
    expect(result['graphData']).toEqual({ id: 'abc' }); // kept at top level
    expect(result['eventTitle']).toBeUndefined(); // should not be at top level
  });

  test('derives startDate/startTime from startDateTime', () => {
    const result = remapToCalendarData({
      startDateTime: '2026-03-15T10:00:00',
    });

    expect(result['calendarData.startDateTime']).toBe('2026-03-15T10:00:00');
    expect(result['calendarData.startDate']).toBe('2026-03-15');
    expect(result['calendarData.startTime']).toBe('10:00');
  });

  test('explicit startTime takes precedence over dateTime derivation', () => {
    const result = remapToCalendarData({
      startDateTime: '2026-03-15T10:00:00',
      startTime: '14:00', // explicit override
    });

    expect(result['calendarData.startTime']).toBe('14:00');
  });

  test('normalizes location IDs to ObjectIds', () => {
    const id = new ObjectId();
    const result = remapToCalendarData({
      locations: [id.toString()],
    });

    expect(result['calendarData.locations']).toHaveLength(1);
    expect(result['calendarData.locations'][0]).toBeInstanceOf(ObjectId);
    // Also sets roomReservationData.requestedRooms for backward compat
    expect(result['roomReservationData.requestedRooms']).toHaveLength(1);
  });

  test('remaps clergy fields to calendarData.*', () => {
    const rabbis = [{ userId: 'r1', displayName: 'Rabbi A' }];
    const result = remapToCalendarData({
      assignedRabbi: rabbis,
      assignedCantor: [],
    });

    expect(result['calendarData.assignedRabbi']).toEqual(rabbis);
    expect(result['calendarData.assignedCantor']).toEqual([]);
    expect(result['assignedRabbi']).toBeUndefined();
  });

  test('normalizes requestedRooms same as locations', () => {
    const id = new ObjectId();
    const result = remapToCalendarData({
      requestedRooms: [id.toString()],
    });

    expect(result['calendarData.locations']).toHaveLength(1);
    expect(result['roomReservationData.requestedRooms']).toHaveLength(1);
    // requestedRooms should NOT leak as a top-level key
    expect(result['requestedRooms']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildRequestedByObject
// ---------------------------------------------------------------------------
describe('buildRequestedByObject', () => {
  test('builds canonical requestedBy shape', () => {
    const result = buildRequestedByObject(
      { requesterName: 'John Doe', phone: '555-1234' },
      'user-123',
      'John@Example.com',
      'Admin Dept'
    );

    expect(result.requestedBy).toEqual({
      userId: 'user-123',
      name: 'John Doe',
      email: 'john@example.com', // lowercased
      department: 'Admin Dept',
      phone: '555-1234',
    });
    expect(result.contactPerson).toBe(null);
  });

  test('falls back to email for name', () => {
    const result = buildRequestedByObject(
      {},
      'user-123',
      'user@example.com',
      ''
    );

    expect(result.requestedBy.name).toBe('user@example.com');
  });

  test('builds contactPerson when isOnBehalfOf', () => {
    const result = buildRequestedByObject(
      {
        isOnBehalfOf: true,
        contactName: 'Jane Doe',
        contactEmail: 'jane@example.com',
      },
      'user-123',
      'user@example.com',
      ''
    );

    expect(result.contactPerson).toEqual({
      name: 'Jane Doe',
      email: 'jane@example.com',
      isOnBehalfOf: true,
    });
  });

  test('contactPerson null when not on behalf', () => {
    const result = buildRequestedByObject(
      { isOnBehalfOf: false },
      'user-123',
      'user@example.com',
      ''
    );

    expect(result.contactPerson).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// buildStatusHistoryEntry
// ---------------------------------------------------------------------------
describe('buildStatusHistoryEntry', () => {
  test('builds correct shape', () => {
    const before = new Date();
    const entry = buildStatusHistoryEntry(
      'pending',
      'user-123',
      'user@example.com',
      'Event request submitted'
    );

    expect(entry.status).toBe('pending');
    expect(entry.changedBy).toBe('user-123');
    expect(entry.changedByEmail).toBe('user@example.com');
    expect(entry.reason).toBe('Event request submitted');
    expect(entry.changedAt).toBeInstanceOf(Date);
    expect(entry.changedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  test('works for all status values', () => {
    for (const status of ['draft', 'pending', 'published', 'rejected', 'deleted']) {
      const entry = buildStatusHistoryEntry(status, 'uid', 'e@e.com', 'reason');
      expect(entry.status).toBe(status);
    }
  });
});

// ---------------------------------------------------------------------------
// CALENDAR_DATA_FIELDS
// ---------------------------------------------------------------------------
describe('CALENDAR_DATA_FIELDS', () => {
  test('contains all expected core fields', () => {
    const expected = [
      'eventTitle', 'eventDescription',
      'startDateTime', 'endDateTime', 'startDate', 'startTime', 'endDate', 'endTime',
      'locations', 'locationDisplayNames',
      'categories', 'services',
      'recurrence',
      'isOffsite', 'offsiteName',
      'organizerName', 'organizerPhone', 'organizerEmail',
      'requiredFeatures',
    ];

    for (const field of expected) {
      expect(CALENDAR_DATA_FIELDS).toContain(field);
    }
  });

  test('contains legacy location field', () => {
    expect(CALENDAR_DATA_FIELDS).toContain('location');
  });

  test('does NOT contain top-level-only fields', () => {
    const topLevelOnly = ['eventId', 'userId', 'status', 'graphData', '_version',
      'calendarOwner', 'isDeleted', 'createdAt', 'roomReservationData'];
    for (const field of topLevelOnly) {
      expect(CALENDAR_DATA_FIELDS).not.toContain(field);
    }
  });
});
