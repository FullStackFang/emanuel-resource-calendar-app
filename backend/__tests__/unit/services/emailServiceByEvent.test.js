/**
 * emailService byEvent helpers — focused unit tests.
 *
 * Covers the new event-document-driven helpers (§8.3):
 *   - buildReservationFromEvent: resolves calendarData/requestedBy/location
 *     names internally; gracefully degrades when the location resolution
 *     fails or when dbConnection is absent.
 *   - The send*ByEvent wrappers route to the legacy send* functions
 *     with the resolved reservation shape.
 *
 * Tests focus on the contract that distinguishes the new helpers from
 * the legacy ones: callers stop pre-resolving location names and
 * pre-building the reservationForEmail shape.
 */

// Mock locationUtils BEFORE requiring emailService so the import binding
// resolves to the mock.
jest.mock('../../../utils/locationUtils', () => ({
  calculateLocationDisplayNames: jest.fn(),
}));

jest.mock('../../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const emailService = require('../../../services/emailService');
const { calculateLocationDisplayNames } = require('../../../utils/locationUtils');
const logger = require('../../../utils/logger');

describe('emailService.buildReservationFromEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null for null/undefined event', async () => {
    const result = await emailService.buildReservationFromEvent(null);
    expect(result).toBeNull();
  });

  it('extracts calendarData and requestedBy fields without resolving locations when display names already present', async () => {
    emailService.setDbConnection({ collection: jest.fn() });

    const event = {
      _id: 'evt-1',
      calendarData: {
        eventTitle: 'Friday Service',
        startDateTime: '2026-05-15T18:00:00',
        endDateTime: '2026-05-15T20:00:00',
        locations: ['loc-1'],
        locationDisplayNames: 'Main Sanctuary', // already present
        attendeeCount: 250,
      },
      roomReservationData: {
        requestedBy: { name: 'Cantor Smith', email: 'cantor@example.com' },
        contactPerson: { email: 'contact@example.com' },
      },
    };

    const result = await emailService.buildReservationFromEvent(event);

    expect(result).toEqual({
      _id: 'evt-1',
      eventTitle: 'Friday Service',
      requesterName: 'Cantor Smith',
      requesterEmail: 'cantor@example.com',
      contactEmail: 'contact@example.com',
      startDateTime: '2026-05-15T18:00:00',
      endDateTime: '2026-05-15T20:00:00',
      locationDisplayNames: ['Main Sanctuary'],
      attendeeCount: 250,
    });

    // Did NOT call the resolver because display names were already present.
    expect(calculateLocationDisplayNames).not.toHaveBeenCalled();
  });

  it('resolves location display names from the locations array when not already set', async () => {
    const mockDb = { collection: jest.fn() };
    emailService.setDbConnection(mockDb);
    calculateLocationDisplayNames.mockResolvedValue('Library, Garden Room');

    const event = {
      _id: 'evt-2',
      calendarData: {
        eventTitle: 'Study Session',
        locations: ['loc-2', 'loc-3'],
        // no locationDisplayNames
      },
      roomReservationData: { requestedBy: { name: 'Rabbi', email: 'rabbi@example.com' } },
    };

    const result = await emailService.buildReservationFromEvent(event);

    expect(calculateLocationDisplayNames).toHaveBeenCalledWith(['loc-2', 'loc-3'], mockDb);
    expect(result.locationDisplayNames).toEqual(['Library, Garden Room']);
  });

  it('gracefully degrades to empty location names when the resolver throws', async () => {
    emailService.setDbConnection({ collection: jest.fn() });
    calculateLocationDisplayNames.mockRejectedValue(new Error('Cosmos rate-limited'));

    const event = {
      _id: 'evt-3',
      calendarData: { eventTitle: 'Event', locations: ['loc-x'] },
      roomReservationData: { requestedBy: { name: 'X', email: 'x@example.com' } },
    };

    const result = await emailService.buildReservationFromEvent(event);

    // Did not throw; falls back to empty
    expect(result.locationDisplayNames).toEqual([]);
    expect(result.eventTitle).toBe('Event');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('location resolution failed'),
      expect.any(String)
    );
  });

  it('skips location resolution entirely when dbConnection is absent', async () => {
    // Reset connection
    emailService.setDbConnection(null);

    const event = {
      _id: 'evt-4',
      calendarData: { eventTitle: 'Event', locations: ['loc-y'] },
      roomReservationData: { requestedBy: { email: 'y@example.com' } },
    };

    const result = await emailService.buildReservationFromEvent(event);

    expect(calculateLocationDisplayNames).not.toHaveBeenCalled();
    expect(result.locationDisplayNames).toEqual([]);
  });

  it('falls back to top-level event fields when calendarData is missing', async () => {
    emailService.setDbConnection({ collection: jest.fn() });

    const event = {
      _id: 'evt-5',
      eventTitle: 'Top-level Title',
      startDateTime: '2026-05-15T10:00',
      endDateTime: '2026-05-15T11:00',
      roomReservationData: { requestedBy: { email: 'top@example.com' } },
    };

    const result = await emailService.buildReservationFromEvent(event);

    expect(result.eventTitle).toBe('Top-level Title');
    expect(result.startDateTime).toBe('2026-05-15T10:00');
    expect(result.endDateTime).toBe('2026-05-15T11:00');
  });
});
