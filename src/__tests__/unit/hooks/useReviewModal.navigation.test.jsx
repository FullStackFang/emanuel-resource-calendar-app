// useReviewModal — conflict-resolution navigation: the /api/events/:id
// fallback in navigateToEvent (Outlook-synced blockers carry no
// roomReservationData, so /api/room-reservations/:id 404s on exactly the
// events the conflict drawer needs to open), the single-entry
// navigationOrigin (D3: one hop deep, replaced not stacked), and the
// dirty-form guard that routes returns and conflict navigations through the
// discard-changes dialog instead of silently dropping edits.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));
vi.mock('../../../utils/logger', () => ({
  logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../../hooks/useDataRefreshBus', () => ({
  dispatchRefresh: vi.fn(),
}));
vi.mock('../../../services/editRequestsApi', () => ({
  createEditRequest: vi.fn(),
  approveEditRequestRaw: vi.fn(),
  rejectEditRequest: vi.fn(),
}));

const mockPermissions = {
  isAdmin: true,
  canCreateEvents: true,
  canSubmitReservation: true,
};
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => mockPermissions,
}));

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

// Per-test route table for the authenticated fetch
let authRoutes;
const mockFetch = vi.fn(async (url, opts) => authRoutes(url, opts));
vi.mock('../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => mockFetch,
}));

import { useReviewModal, adaptEventToReservationShape } from '../../../hooks/useReviewModal';

// Origin item: the pending series under review. singleInstance so openModal
// performs no seriesMaster hydration fetch.
const SERIES_ITEM = {
  _id: 'series-1',
  status: 'pending',
  eventTitle: 'Torah Class',
  eventType: 'singleInstance',
  _version: 3,
};

// Reservation-shaped response for the primary source
const RES_1 = {
  _id: 'res-1',
  eventTitle: 'Sisterhood Luncheon',
  status: 'published',
  eventType: 'singleInstance',
  _version: 2,
};
const RES_3 = {
  _id: 'res-3',
  eventTitle: 'Third Event',
  status: 'published',
  eventType: 'singleInstance',
  _version: 1,
};

// Raw /api/events/:id doc — Outlook-synced, no reservation data
const RAW_OUTLOOK_EVENT = {
  _id: 'evt-2',
  eventId: 'uuid-evt-2',
  status: 'published',
  eventType: 'singleInstance',
  _version: 5,
  roomReservationData: null,
  calendarData: {
    eventTitle: 'Outlook Event',
    eventDescription: 'Synced from Outlook',
    startDateTime: '2026-09-09T10:00:00',
    endDateTime: '2026-09-09T11:00:00',
    startDate: '2026-09-09',
    startTime: '10:00',
    endDate: '2026-09-09',
    endTime: '11:00',
    locations: ['room-1'],
    locationDisplayNames: ['Main Hall'],
    categories: ['Meeting'],
  },
  graphData: { subject: 'Outlook Event' },
  statusHistory: [],
  createdAt: '2026-09-01T00:00:00Z',
};

const ORIGIN_CONTEXT = { occurrenceDate: '2026-09-09', outstandingConflictCount: 3 };

// Route helpers
const reservationRoute = (id, response) => (url) =>
  url.includes(`/room-reservations/${id}`) ? response : null;
const eventsRoute = (id, response) => (url) =>
  url.endsWith(`/events/${id}`) ? response : null;

function buildRoutes(...matchers) {
  return (url, opts) => {
    for (const m of matchers) {
      const res = m(url, opts);
      if (res) return res;
    }
    return jsonResponse(200, {});
  };
}

const fallbackCalls = () =>
  mockFetch.mock.calls.filter(([url]) => /\/api\/events\/[^/]+$/.test(url));
const reservationCalls = (id) =>
  mockFetch.mock.calls.filter(([url]) => url.includes(`/room-reservations/${id}`));

describe('useReviewModal conflict-resolution navigation', () => {
  let onError;

  beforeEach(() => {
    vi.clearAllMocks();
    onError = vi.fn();
    mockPermissions.isAdmin = true;
    authRoutes = buildRoutes();
    // Availability prefetch uses the plain global fetch
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const setup = () =>
    renderHook(() => useReviewModal({
      apiToken: 'tok',
      graphToken: null,
      onSuccess: vi.fn(),
      onError,
      selectedCalendarId: '',
    }));

  describe('navigateToEvent fetch fallback', () => {
    it('NAV-1: a reservation resolves from the primary source with no fallback request', async () => {
      authRoutes = buildRoutes(reservationRoute('res-1', jsonResponse(200, RES_1)));
      const { result } = setup();

      await act(async () => { await result.current.navigateToEvent('res-1'); });

      expect(result.current.currentItem._id).toBe('res-1');
      expect(result.current.currentItem.eventTitle).toBe('Sisterhood Luncheon');
      expect(fallbackCalls()).toHaveLength(0);
    });

    it('NAV-2: a 404 from the reservations endpoint falls back to /api/events/:id', async () => {
      authRoutes = buildRoutes(
        reservationRoute('evt-2', jsonResponse(404, { error: 'Reservation not found' })),
        eventsRoute('evt-2', jsonResponse(200, { event: RAW_OUTLOOK_EVENT })),
      );
      const { result } = setup();

      await act(async () => { await result.current.navigateToEvent('evt-2'); });

      expect(fallbackCalls()).toHaveLength(1);
      expect(result.current.currentItem._id).toBe('evt-2');
      expect(result.current.currentItem.eventTitle).toBe('Outlook Event');
      expect(onError).not.toHaveBeenCalled();
    });

    it('NAV-3: both sources failing reports the load error and does not navigate', async () => {
      authRoutes = buildRoutes(reservationRoute('series-1', jsonResponse(200, SERIES_ITEM)));
      const { result } = setup();
      await act(async () => { await result.current.openModal(SERIES_ITEM); });

      authRoutes = buildRoutes(
        reservationRoute('missing', jsonResponse(404, { error: 'Reservation not found' })),
        eventsRoute('missing', jsonResponse(404, { error: 'Event not found' })),
      );
      await act(async () => { await result.current.navigateToEvent('missing'); });

      expect(onError).toHaveBeenCalledWith('Could not load the requested event');
      expect(result.current.currentItem._id).toBe('series-1');
    });

    it('NAV-4: the fallback result is adapted to the primary-source shape', async () => {
      authRoutes = buildRoutes(
        reservationRoute('evt-2', jsonResponse(404, { error: 'Reservation not found' })),
        eventsRoute('evt-2', jsonResponse(200, { event: RAW_OUTLOOK_EVENT })),
      );
      const { result } = setup();

      await act(async () => { await result.current.navigateToEvent('evt-2'); });

      const item = result.current.currentItem;
      // No consumer should ever see the raw { event } nesting or bare doc
      expect(item.event).toBeUndefined();
      // The flat reservation keys the primary source guarantees
      expect(item.startDateTime).toBe('2026-09-09T10:00:00');
      expect(item.endDateTime).toBe('2026-09-09T11:00:00');
      expect(item.requestedRooms).toEqual(['room-1']);
      expect(item.startDate).toBe('2026-09-09');
      expect(item.startTime).toBe('10:00');
      expect(item.categories).toEqual(['Meeting']);
      expect(item.recurrence).toBeNull();
      expect(item.eventType).toBe('singleInstance');
      expect(item._version).toBe(5);
      expect(item.statusHistory).toEqual([]);
      expect(item.calendarData).toEqual(RAW_OUTLOOK_EVENT.calendarData);
      // Outlook-synced: requester fields resolve empty, reservation block null
      expect(item.roomReservationData).toBeNull();
      expect(item.requesterName).toBeUndefined();
    });

    it('NAV-4b: adaptEventToReservationShape produces every key the primary transform returns', () => {
      const adapted = adaptEventToReservationShape(RAW_OUTLOOK_EVENT);
      // Key parity with the GET /api/room-reservations/:id response builder
      const primaryShapeKeys = [
        '_id', 'eventId', 'eventTitle', 'eventDescription',
        'startDateTime', 'endDateTime', 'status', 'requestedRooms',
        'attendeeCount', 'requesterId', 'requesterName', 'requesterEmail',
        'submittedAt', 'roomReservationData', 'rejectionReason', 'cancelReason',
        'actionDate', 'specialRequirements', 'setupTime', 'teardownTime',
        'doorOpenTime', 'doorCloseTime', 'startDate', 'startTime', 'endDate',
        'endTime', 'categories', 'services', 'occurrenceOverrides', 'eventType',
        'recurrence', 'seriesMasterId', 'seriesMasterEventId', '_version',
        'statusHistory', 'calendarData',
      ];
      expect(Object.keys(adapted).sort()).toEqual(primaryShapeKeys.slice().sort());
    });
  });

  describe('navigation origin (single entry)', () => {
    const openSeriesThenNavigate = async (result, options) => {
      authRoutes = buildRoutes(
        reservationRoute('res-1', jsonResponse(200, RES_1)),
        reservationRoute('res-3', jsonResponse(200, RES_3)),
        reservationRoute('series-1', jsonResponse(200, SERIES_ITEM)),
      );
      await act(async () => { await result.current.openModal(SERIES_ITEM); });
      await act(async () => { await result.current.navigateToEvent('res-1', options); });
    };

    it('NAV-5: a conflict-driven navigation records the origin with title, date, and count', async () => {
      const { result } = setup();
      await openSeriesThenNavigate(result, { origin: ORIGIN_CONTEXT });

      expect(result.current.navigationOrigin).toEqual({
        item: expect.objectContaining({ _id: 'series-1' }),
        title: 'Torah Class',
        occurrenceDate: '2026-09-09',
        outstandingConflictCount: 3,
      });
    });

    it('NAV-6: a second navigation replaces the origin; an ordinary one clears it', async () => {
      const { result } = setup();
      await openSeriesThenNavigate(result, { origin: ORIGIN_CONTEXT });

      // Conflict-driven hop from the blocker to a third event: replaced, not stacked
      await act(async () => {
        await result.current.navigateToEvent('res-3', {
          origin: { occurrenceDate: '2026-09-16', outstandingConflictCount: 2 },
        });
      });
      expect(result.current.navigationOrigin).toEqual({
        item: expect.objectContaining({ _id: 'res-1' }),
        title: 'Sisterhood Luncheon',
        occurrenceDate: '2026-09-16',
        outstandingConflictCount: 2,
      });

      // Ordinary navigation records nothing — the slot is cleared
      await act(async () => { await result.current.navigateToEvent('res-1'); });
      expect(result.current.navigationOrigin).toBeNull();
    });

    it('NAV-7: closing the modal clears the origin', async () => {
      const { result } = setup();
      await openSeriesThenNavigate(result, { origin: ORIGIN_CONTEXT });
      expect(result.current.navigationOrigin).not.toBeNull();

      await act(async () => { await result.current.closeModal(true); });
      expect(result.current.navigationOrigin).toBeNull();
    });

    it('NAV-8: ordinary navigation records no origin', async () => {
      const { result } = setup();
      await openSeriesThenNavigate(result, undefined);
      expect(result.current.navigationOrigin).toBeNull();
    });
  });

  describe('returning and the dirty-form guard', () => {
    const armOrigin = async (result) => {
      authRoutes = buildRoutes(
        reservationRoute('res-1', jsonResponse(200, RES_1)),
        reservationRoute('series-1', jsonResponse(200, SERIES_ITEM)),
      );
      await act(async () => { await result.current.openModal(SERIES_ITEM); });
      await act(async () => {
        await result.current.navigateToEvent('res-1', { origin: ORIGIN_CONTEXT });
      });
    };

    it('NAV-9: returnToOrigin navigates back to the originating event and clears the origin', async () => {
      const { result } = setup();
      await armOrigin(result);
      mockFetch.mockClear();

      await act(async () => { await result.current.returnToOrigin(); });

      expect(reservationCalls('series-1').length).toBeGreaterThan(0);
      expect(result.current.currentItem._id).toBe('series-1');
      expect(result.current.navigationOrigin).toBeNull();
    });

    it('NAV-10: a dirty form routes the return through the discard guard, then navigates on discard', async () => {
      const { result } = setup();
      await armOrigin(result);
      act(() => { result.current.updateData({ eventTitle: 'Edited' }); });
      mockFetch.mockClear();

      await act(async () => { await result.current.returnToOrigin(); });

      // Guard shown, no navigation yet
      expect(result.current.getReviewModalProps().showDiscardDialog).toBe(true);
      expect(reservationCalls('series-1')).toHaveLength(0);
      expect(result.current.currentItem._id).toBe('res-1');

      // Discarding performs the navigation
      await act(async () => { await result.current.getReviewModalProps().onDiscardDialogDiscard(); });
      expect(result.current.currentItem._id).toBe('series-1');
      expect(result.current.getReviewModalProps().showDiscardDialog).toBe(false);
      expect(result.current.navigationOrigin).toBeNull();
    });

    it('NAV-11: keep-editing cancels the pending navigation and stays put', async () => {
      const { result } = setup();
      await armOrigin(result);
      act(() => { result.current.updateData({ eventTitle: 'Edited' }); });
      mockFetch.mockClear();

      await act(async () => { await result.current.returnToOrigin(); });
      act(() => { result.current.getReviewModalProps().onDiscardDialogCancel(); });

      expect(result.current.getReviewModalProps().showDiscardDialog).toBe(false);
      expect(result.current.currentItem._id).toBe('res-1');
      expect(result.current.hasChanges).toBe(true);
      expect(reservationCalls('series-1')).toHaveLength(0);
    });

    it('NAV-12: requestModalNavigation guards a dirty conflict-driven navigation', async () => {
      authRoutes = buildRoutes(
        reservationRoute('series-1', jsonResponse(200, SERIES_ITEM)),
        reservationRoute('res-1', jsonResponse(200, RES_1)),
      );
      const { result } = setup();
      await act(async () => { await result.current.openModal(SERIES_ITEM); });
      act(() => { result.current.updateData({ eventTitle: 'Edited' }); });
      mockFetch.mockClear();

      await act(async () => {
        await result.current.requestModalNavigation('res-1', { origin: ORIGIN_CONTEXT });
      });
      expect(result.current.getReviewModalProps().showDiscardDialog).toBe(true);
      expect(reservationCalls('res-1')).toHaveLength(0);

      await act(async () => { await result.current.getReviewModalProps().onDiscardDialogDiscard(); });
      expect(result.current.currentItem._id).toBe('res-1');
      expect(result.current.navigationOrigin).toEqual(
        expect.objectContaining({ title: 'Torah Class', occurrenceDate: '2026-09-09' })
      );
    });

    it('NAV-13: a clean form navigates immediately through requestModalNavigation', async () => {
      authRoutes = buildRoutes(
        reservationRoute('series-1', jsonResponse(200, SERIES_ITEM)),
        reservationRoute('res-1', jsonResponse(200, RES_1)),
      );
      const { result } = setup();
      await act(async () => { await result.current.openModal(SERIES_ITEM); });

      await act(async () => {
        await result.current.requestModalNavigation('res-1', { origin: ORIGIN_CONTEXT });
      });

      expect(result.current.getReviewModalProps().showDiscardDialog).toBe(false);
      expect(result.current.currentItem._id).toBe('res-1');
    });
  });
});
