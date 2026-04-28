// src/__tests__/unit/components/MyReservations.race.test.jsx
//
// Tests for the AbortController + initialLoadAttemptedRef race fixes in
// loadMyReservations. Mirrors src/__tests__/unit/components/ReservationRequests.race.test.jsx
// (commit 38c9748) and the Calendar.jsx initialLoadAttemptedRef gate (commit ee73aff).
//
// The bug: a silent refresh (SSE / polling / bus) arriving during the initial
// non-silent mount load could either abort the live UI fetch or — once the
// load resolved with [] transiently — overwrite populated state with []. The
// fix layers three guards in MyReservations.jsx:
//   1. AbortController + currentRequestIsSilentRef so silent refreshes no-op
//      while a non-silent load is in flight.
//   2. initialLoadAttemptedRef so SSE/bus events delivered before the mount
//      effect's first dispatch are inert.
//   3. Stale-while-revalidate write rule: silent + 0 events never writes.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { makeControllableAuthFetch, makeEvents } from '../../__helpers__/mockAuthFetch';

// ─── Static mocks ────────────────────────────────────────────────────────────

vi.mock('../../../config/config', () => ({
  default: {
    API_BASE_URL: 'http://localhost:3001/api',
    CALENDAR_CONFIG: { DEFAULT_MODE: 'sandbox', SANDBOX_CALENDAR: 'test@test.com', PRODUCTION_CALENDAR: 'prod@test.com' },
  },
}));

vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: 'test-token', user: { name: 'Test User', email: 'test@test.com' } }),
}));

vi.mock('../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess: vi.fn(), showWarning: vi.fn(), showError: vi.fn() }),
}));

vi.mock('../../../context/LocationContext', () => ({
  useRooms: () => ({
    rooms: [],
    getLocationName: (id) => id,
    getRoomName: (id) => id,
    getRoomDetails: () => null,
    loading: false,
  }),
  useLocations: () => ({ locations: [], rooms: [], getLocationName: (id) => id }),
}));

vi.mock('../../../context/SSEContext', () => ({
  useSSE: () => ({ isConnected: true }),
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    canSubmitReservation: true,
    canEditEvents: false,        // Requester-only role keeps the surface tight
    canApproveReservations: false,
    canDeleteEvents: false,
    permissionsLoading: false,
    role: 'requester',
  }),
}));

// Prevent real polling — callbacks never fire in tests
vi.mock('../../../hooks/usePolling', () => ({
  usePolling: vi.fn(),
}));

// Capture the bus handler so tests can simulate a bus-delivered silent refresh.
let capturedBusHandler = null;
vi.mock('../../../hooks/useDataRefreshBus', () => ({
  useDataRefreshBus: (_viewName, handler) => { capturedBusHandler = handler; },
  dispatchRefresh: vi.fn(),
}));

// No-op the heavy review experience modal/handlers tree.
vi.mock('../../../components/shared/EventReviewExperience', () => ({
  default: () => null,
}));

vi.mock('../../../components/shared/LoadingSpinner', () => ({
  default: () => <div data-testid="loading-spinner" />,
}));

vi.mock('../../../components/shared/FreshnessIndicator', () => ({
  default: () => null,
}));

vi.mock('../../../components/DatePickerInput', () => ({
  default: ({ value, onChange, placeholder }) => (
    <input data-testid="date-picker-input" value={value || ''} onChange={onChange || vi.fn()} placeholder={placeholder} readOnly />
  ),
}));

// transformEventsToFlatStructure: pass-through
vi.mock('../../../utils/eventTransformers', () => ({
  transformEventsToFlatStructure: (events) => events,
  transformEventToFlatStructure: (event) => event,
}));

// useEventReviewExperience: minimal stub. reviewModal.isOpen must be false so
// silentRefresh isn't blocked by the modal guard.
vi.mock('../../../hooks/useEventReviewExperience', () => ({
  useEventReviewExperience: () => ({
    reviewModal: {
      isOpen: false,
      currentItem: null,
      isDraft: false,
      isEditRequestMode: false,
      editableData: null,
    },
    handleOpenReviewModal: vi.fn(),
    handleCloseModal: vi.fn(),
    handleSave: vi.fn(),
    handlePublish: vi.fn(),
    handleReject: vi.fn(),
    handleDelete: vi.fn(),
    handleRestore: vi.fn(),
    savingEvent: false,
    publishingEvent: false,
    rejectingEvent: false,
    deletingEvent: false,
    restoringEvent: false,
    confirmDeleteId: null,
    confirmRestoreId: null,
    setConfirmDeleteId: vi.fn(),
    setConfirmRestoreId: vi.fn(),
  }),
}));

let currentAuthFetch = vi.fn();

vi.mock('../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => currentAuthFetch,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findMyEventsCallIndex(authFetch) {
  return authFetch.mock.calls.findIndex(([url]) => url.includes('view=my-events'));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

import MyReservations from '../../../components/MyReservations';

describe('MyReservations — loadMyReservations race condition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedBusHandler = null;
  });

  // MR-RACE-1: The mount fetch is called with an AbortSignal. Establishes that
  // request coordination is wired in at all.
  it('MR-RACE-1: my-events fetch is called with an AbortSignal', async () => {
    const { authFetch, resolveCall } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;

    render(<MyReservations />);

    await waitFor(() => {
      expect(findMyEventsCallIndex(authFetch)).toBeGreaterThanOrEqual(0);
    });

    const idx = findMyEventsCallIndex(authFetch);
    const [, options] = authFetch.mock.calls[idx];
    expect(options).toBeDefined();
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal.aborted).toBe(false);

    // Drain pending calls so the test exits cleanly.
    authFetch.mock.calls.forEach((_, i) => { try { resolveCall(i, []); } catch (_) {} });
  });

  // MR-RACE-2: A bus-delivered silent refresh that arrives mid-flight must NOT
  // abort the in-flight non-silent initial load. Without the guard, the silent
  // path would call abortControllerRef.current.abort() and clobber the UI fetch,
  // leaving allReservations empty. This is the exact symptom the user reported.
  it('MR-RACE-2: silent refresh mid-flight does not abort the non-silent initial load', async () => {
    const { authFetch, resolveCall } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;

    render(<MyReservations />);

    await waitFor(() => {
      expect(findMyEventsCallIndex(authFetch)).toBeGreaterThanOrEqual(0);
    });

    const firstIdx = findMyEventsCallIndex(authFetch);
    const firstSignal = authFetch.mock.calls[firstIdx][1]?.signal;
    expect(firstSignal).toBeInstanceOf(AbortSignal);
    expect(firstSignal.aborted).toBe(false);

    expect(typeof capturedBusHandler).toBe('function');

    // Bus handler fires while initial load is still in flight.
    await act(async () => {
      capturedBusHandler({});
    });

    // Critical: initial load's signal must still NOT be aborted.
    expect(firstSignal.aborted).toBe(false);

    // And no second my-events fetch should have been issued (the silent path
    // early-returned because a non-silent load is in flight).
    const myEventsCalls = authFetch.mock.calls.filter(([url]) => url.includes('view=my-events'));
    expect(myEventsCalls.length).toBe(1);

    // Resolve the live load with 5 events — the list must populate.
    await act(async () => {
      resolveCall(firstIdx, makeEvents(5));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
      expect(screen.queryByText('Event 0')).toBeInTheDocument();
    });

    // Empty-state must not have rendered.
    expect(screen.queryByText('No reservations')).not.toBeInTheDocument();
  });

  // MR-RACE-3: An SSE/bus event delivered BEFORE the mount effect's first
  // dispatch must be inert. Mirrors the initialLoadAttemptedRef gate from
  // ee73aff (Calendar.jsx). We probe this by firing the bus handler the
  // moment it's registered (during the same render cycle as the mount effect).
  // After mount, the live mount fetch resolves and the list still populates.
  it('MR-RACE-3: bus event delivered during init is inert; mount load still populates the list', async () => {
    const { authFetch, resolveCall } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;

    render(<MyReservations />);

    // Fire the bus handler immediately. Whether the gate has flipped yet
    // depends on effect ordering, but the invariant is identical either way:
    // the silent path must not pre-empt or duplicate the mount fetch.
    await waitFor(() => {
      expect(typeof capturedBusHandler).toBe('function');
    });
    await act(async () => {
      capturedBusHandler({});
    });

    // Wait for the mount fetch to land.
    await waitFor(() => {
      expect(findMyEventsCallIndex(authFetch)).toBeGreaterThanOrEqual(0);
    });

    // There must be exactly ONE my-events fetch — the mount fetch. The bus
    // event either no-oped via initialLoadAttemptedRef (delivered too early)
    // or via the in-flight non-silent guard (delivered after mount fired but
    // before it resolved). Either way, no duplicate.
    const myEventsCalls = authFetch.mock.calls.filter(([url]) => url.includes('view=my-events'));
    expect(myEventsCalls.length).toBe(1);

    const firstIdx = findMyEventsCallIndex(authFetch);

    // Resolve with real data; list populates.
    await act(async () => {
      resolveCall(firstIdx, makeEvents(3));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
      expect(screen.queryByText('Event 0')).toBeInTheDocument();
    });
  });

  // MR-RACE-4: After the initial load completes, a silent refresh that comes
  // back with 0 events must NOT clear the populated list. The truth source for
  // "user has 0 reservations" is a non-silent load. Mirrors the stale-while-
  // revalidate write rule from ee73aff.
  it('MR-RACE-4: silent refresh returning 0 events does not blank a populated list', async () => {
    const { authFetch, resolveCall } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;

    render(<MyReservations />);

    await waitFor(() => {
      expect(findMyEventsCallIndex(authFetch)).toBeGreaterThanOrEqual(0);
    });

    const firstIdx = findMyEventsCallIndex(authFetch);

    // Resolve the initial load with 4 events.
    await act(async () => {
      resolveCall(firstIdx, makeEvents(4));
    });

    await waitFor(() => {
      expect(screen.queryByText('Event 0')).toBeInTheDocument();
      expect(screen.queryByText('Event 3')).toBeInTheDocument();
    });

    // Confirm the bus handler is registered — used as the silent-refresh entry.
    expect(typeof capturedBusHandler).toBe('function');

    // Now fire a silent refresh (bus). Its returned response will be empty.
    await act(async () => {
      capturedBusHandler({});
    });

    // The silent refresh should issue a NEW my-events fetch (initialLoadAttempted
    // is true, abort ref is null post-completion, so guard re-arms).
    await waitFor(() => {
      const myEventsCalls = authFetch.mock.calls.filter(([url]) => url.includes('view=my-events'));
      expect(myEventsCalls.length).toBeGreaterThanOrEqual(2);
    });

    const silentIdx = authFetch.mock.calls.findIndex(
      ([url], i) => url.includes('view=my-events') && i > firstIdx
    );
    expect(silentIdx).toBeGreaterThan(firstIdx);

    // Resolve the silent refresh with 0 events (the transient empty case).
    await act(async () => {
      resolveCall(silentIdx, []);
    });

    // CRITICAL invariant: events from the populated initial load must remain
    // visible. Without the stale-while-revalidate guard, setAllReservations([])
    // would have run and the list would be empty.
    expect(screen.queryByText('Event 0')).toBeInTheDocument();
    expect(screen.queryByText('Event 3')).toBeInTheDocument();
    expect(screen.queryByText('No reservations')).not.toBeInTheDocument();
  });

  // MR-RACE-5: Silent refresh with non-empty data DOES update the list (the
  // guard does not over-clamp — it only protects against transient zero-event
  // responses, not against legitimate refresh updates).
  it('MR-RACE-5: silent refresh with non-empty data updates the list', async () => {
    const { authFetch, resolveCall } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;

    render(<MyReservations />);

    await waitFor(() => {
      expect(findMyEventsCallIndex(authFetch)).toBeGreaterThanOrEqual(0);
    });

    const firstIdx = findMyEventsCallIndex(authFetch);

    // Initial load: 1 event.
    await act(async () => {
      resolveCall(firstIdx, makeEvents(1));
    });
    await waitFor(() => {
      expect(screen.queryByText('Event 0')).toBeInTheDocument();
    });

    // Silent refresh with 3 events.
    expect(typeof capturedBusHandler).toBe('function');
    await act(async () => {
      capturedBusHandler({});
    });

    await waitFor(() => {
      const myEventsCalls = authFetch.mock.calls.filter(([url]) => url.includes('view=my-events'));
      expect(myEventsCalls.length).toBeGreaterThanOrEqual(2);
    });

    const silentIdx = authFetch.mock.calls.findIndex(
      ([url], i) => url.includes('view=my-events') && i > firstIdx
    );
    await act(async () => {
      resolveCall(silentIdx, makeEvents(3));
    });

    await waitFor(() => {
      expect(screen.queryByText('Event 2')).toBeInTheDocument();
    });
  });
});
