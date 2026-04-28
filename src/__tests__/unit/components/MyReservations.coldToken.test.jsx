// src/__tests__/unit/components/MyReservations.coldToken.test.jsx
//
// Tests the cold-MSAL initial-load fix in MyReservations.jsx mount effect.
//
// The bug (companion to MR-RACE-1..5): the mount effect gated on apiToken
// without listing apiToken in deps. When MSAL was cold, apiToken was null at
// first mount; the effect ran once with the early-out and never re-fired
// because loadMyReservations identity is stable across token transitions
// (authFetch reads the token via the ref-based getApiToken). Result:
// initialLoadAttemptedRef stayed false forever and silent SSE/polling/bus
// refreshes also no-oped — the tab rendered blank intermittently on cold load.
//
// The fix mirrors ReservationRequests.jsx: a lastTokenRef + apiToken in deps,
// firing the load on cold-token-arrival AND on token refreshes (intentional —
// matches sister-component semantics).

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

// Mutable apiToken so tests can simulate cold MSAL: render with null, then
// flip to a real token and rerender to trigger the dep-array-driven effect.
let currentApiToken = null;
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: currentApiToken, user: { name: 'Test User', email: 'test@test.com' } }),
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
    canEditEvents: false,
    canApproveReservations: false,
    canDeleteEvents: false,
    permissionsLoading: false,
    role: 'requester',
  }),
}));

vi.mock('../../../hooks/usePolling', () => ({
  usePolling: vi.fn(),
}));

let capturedBusHandler = null;
vi.mock('../../../hooks/useDataRefreshBus', () => ({
  useDataRefreshBus: (_viewName, handler) => { capturedBusHandler = handler; },
  dispatchRefresh: vi.fn(),
}));

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

vi.mock('../../../utils/eventTransformers', () => ({
  transformEventsToFlatStructure: (events) => events,
  transformEventToFlatStructure: (event) => event,
}));

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

function findMyEventsCallIndex(authFetch, fromIndex = 0) {
  for (let i = fromIndex; i < authFetch.mock.calls.length; i++) {
    if (authFetch.mock.calls[i][0]?.includes?.('view=my-events')) return i;
  }
  return -1;
}

function countMyEventsCalls(authFetch) {
  return authFetch.mock.calls.filter(([url]) => url?.includes?.('view=my-events')).length;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

import MyReservations from '../../../components/MyReservations';

describe('MyReservations — cold-token initial load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedBusHandler = null;
    currentApiToken = null;
  });

  // MR-COLD-1: Render with apiToken=null (cold MSAL). No fetch should fire.
  // Then apiToken arrives via context update + rerender. Exactly one non-silent
  // fetch must fire and the list must populate. This is the exact regression
  // the user reported: "blank initially sometimes".
  it('MR-COLD-1: cold apiToken — no fetch on mount; load fires once token arrives', async () => {
    const { authFetch, resolveCall } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;
    currentApiToken = null;

    const { rerender } = render(<MyReservations />);

    // No my-events fetch should have been issued — apiToken is null.
    // Wait one microtask cycle to ensure the mount effect has flushed.
    await act(async () => { await Promise.resolve(); });
    expect(countMyEventsCalls(authFetch)).toBe(0);

    // Token arrives. Provider rerenders → useAuth returns new value → effect
    // re-runs (after fix) and dispatches the load.
    currentApiToken = 'fresh-token';
    rerender(<MyReservations />);

    await waitFor(() => {
      expect(countMyEventsCalls(authFetch)).toBe(1);
    });

    const idx = findMyEventsCallIndex(authFetch);
    const [, options] = authFetch.mock.calls[idx];
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal.aborted).toBe(false);

    // Resolve and confirm the list renders.
    await act(async () => {
      resolveCall(idx, makeEvents(2));
    });

    await waitFor(() => {
      expect(screen.queryByText('Event 0')).toBeInTheDocument();
      expect(screen.queryByText('Event 1')).toBeInTheDocument();
    });
  });

  // MR-COLD-2: Warm path — apiToken is already set on mount. The mount fetch
  // must still fire immediately (previous behavior preserved; the fix must
  // not regress the common case).
  it('MR-COLD-2: warm apiToken — mount fetch fires immediately', async () => {
    const { authFetch, resolveCall } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;
    currentApiToken = 'warm-token';

    render(<MyReservations />);

    await waitFor(() => {
      expect(countMyEventsCalls(authFetch)).toBe(1);
    });

    const idx = findMyEventsCallIndex(authFetch);
    await act(async () => {
      resolveCall(idx, makeEvents(1));
    });

    await waitFor(() => {
      expect(screen.queryByText('Event 0')).toBeInTheDocument();
    });
  });

  // MR-COLD-3: Token refresh after the cold-arrival load. A fresh token
  // (e.g., from the 401-retry path in useAuthenticatedFetch) must trigger
  // exactly one additional non-silent load. Matches ReservationRequests
  // semantics — the lastTokenRef guard fires only when the token *changes*.
  it('MR-COLD-3: token refresh triggers exactly one additional non-silent load', async () => {
    const { authFetch, resolveCall } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;
    currentApiToken = 'token-A';

    const { rerender } = render(<MyReservations />);

    await waitFor(() => {
      expect(countMyEventsCalls(authFetch)).toBe(1);
    });
    const firstIdx = findMyEventsCallIndex(authFetch);

    // Resolve initial load so the abort-controller ref clears (otherwise the
    // mid-flight guard could mask the second load).
    await act(async () => {
      resolveCall(firstIdx, makeEvents(1));
    });
    await waitFor(() => {
      expect(screen.queryByText('Event 0')).toBeInTheDocument();
    });

    // Same-token rerender: must NOT trigger another load (lastTokenRef guard).
    rerender(<MyReservations />);
    await act(async () => { await Promise.resolve(); });
    expect(countMyEventsCalls(authFetch)).toBe(1);

    // Token refreshes (e.g., 401 retry path). Must trigger one more load.
    currentApiToken = 'token-B';
    rerender(<MyReservations />);

    await waitFor(() => {
      expect(countMyEventsCalls(authFetch)).toBe(2);
    });

    const secondIdx = findMyEventsCallIndex(authFetch, firstIdx + 1);
    expect(secondIdx).toBeGreaterThan(firstIdx);

    await act(async () => {
      resolveCall(secondIdx, makeEvents(2));
    });

    await waitFor(() => {
      expect(screen.queryByText('Event 1')).toBeInTheDocument();
    });
  });
});
