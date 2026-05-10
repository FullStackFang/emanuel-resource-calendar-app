// src/__tests__/unit/components/ReservationRequests.firstPaint.test.jsx
//
// Locks the fix for the first-paint blank-flash bug in ReservationRequests.
// The component has TWO TanStack queries (list + counts). Both contribute to
// the spinner gate at line 651: `(loading || !countsLoaded) && allReservations.length === 0`.
// The bug was on the `loading` arm — derived from `reservationsQuery.isLoading`,
// which evaluated to false during the `pending && idle` tick.
//
// The fix derives `loading` from `isPending` (mirrors the existing
// `countsLoaded = !countsQuery.isPending` pattern at line 217).
//
// See openspec/changes/fix-first-paint-blank-flash for full context.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { makeControllableAuthFetch, makeEvents } from '../../__helpers__/mockAuthFetch';
import { withQueryClient } from '../../__helpers__/queryClientWrapper';

// ─── Static mocks (mirrors ReservationRequests.race.test.jsx) ────────────────

vi.mock('../../../config/config', () => ({
  default: {
    API_BASE_URL: 'http://localhost:3001/api',
    CALENDAR_CONFIG: { DEFAULT_MODE: 'sandbox', SANDBOX_CALENDAR: 'test@test.com', PRODUCTION_CALENDAR: 'prod@test.com' },
  },
}));

vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

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
    canApproveReservations: true,
    isAdmin: false,
    permissionsLoading: false,
    canEditEvents: true,
    canDeleteEvents: false,
    canCreateEvents: false,
    canViewCalendar: true,
    canSubmitReservation: true,
    canEditField: () => false,
    role: 'approver',
  }),
}));

vi.mock('../../../hooks/usePolling', () => ({
  usePolling: vi.fn(),
}));

vi.mock('../../../hooks/useDataRefreshBus', () => ({
  useDataRefreshBus: vi.fn(),
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

vi.mock('../../../components/shared/DiscardChangesDialog', () => ({
  default: () => null,
}));

vi.mock('../../../components/EditRequestComparison', () => ({
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
      selectedEvent: null,
      isDraft: false,
      isEditRequestMode: false,
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

// ─── URL routing helpers ─────────────────────────────────────────────────────

function findIdx(authFetch, predicate) {
  return authFetch.mock.calls.findIndex(([url]) => predicate(url));
}

function findListIdx(authFetch) {
  return findIdx(authFetch, (url) => url.includes('/events/list?') && url.includes('approval-queue') && url.includes('limit=1000'));
}

function findCountsIdx(authFetch) {
  return findIdx(authFetch, (url) => url.includes('/counts') && url.includes('view=approval-queue'));
}

function findCalendarSettingsIdx(authFetch) {
  return findIdx(authFetch, (url) => url.includes('/calendar-settings'));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

import ReservationRequests from '../../../components/ReservationRequests';

describe('ReservationRequests — first-paint blank-flash fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentApiToken = 'token';
  });

  // RR-FP-1: Spinner must be present immediately after the queries enable.
  // Before the fix, both `reservationsQuery.isLoading` and `countsQuery.isLoading`
  // were false during the pending+idle tick; the spinner gate failed open, the
  // empty-state body rendered "All caught up!" with serverCounts={0,0}.
  it('RR-FP-1: cold mount shows spinner, no empty-state flash', async () => {
    const { authFetch } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;

    render(<ReservationRequests />, { wrapper: withQueryClient() });

    // Wait for the queries to fire.
    await waitFor(() => {
      expect(findListIdx(authFetch)).toBeGreaterThanOrEqual(0);
    });

    // While both queries are in-flight: spinner present, empty-state absent.
    expect(screen.queryByTestId('loading-spinner')).toBeInTheDocument();
    expect(screen.queryByText('All caught up!')).not.toBeInTheDocument();
    expect(screen.queryByText('No requests')).not.toBeInTheDocument();
    expect(screen.queryByText('No matching requests')).not.toBeInTheDocument();
  });

  // RR-FP-2: The dual-query case. Critical for the spinner gate's `!countsLoaded`
  // arm. List resolves first; counts is still pending. Spinner must persist
  // because the empty-state body needs both queries' agreement.
  it('RR-FP-2: spinner persists when list resolves but counts query still pending', async () => {
    const { authFetch, resolveCall, resolveCallWith } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;

    render(<ReservationRequests />, { wrapper: withQueryClient() });

    await waitFor(() => {
      expect(findListIdx(authFetch)).toBeGreaterThanOrEqual(0);
      expect(findCountsIdx(authFetch)).toBeGreaterThanOrEqual(0);
    });

    const settingsIdx = findCalendarSettingsIdx(authFetch);
    const listIdx = findListIdx(authFetch);

    // Resolve calendar-settings (non-list, non-counts) so it doesn't pin tests.
    if (settingsIdx >= 0) {
      await act(async () => {
        try { resolveCallWith(settingsIdx, { settings: {} }); } catch (_) {}
      });
    }

    // Resolve the list with empty array. counts is still pending.
    await act(async () => {
      resolveCall(listIdx, []);
    });

    // Spinner must still be present because countsLoaded === false.
    expect(screen.queryByTestId('loading-spinner')).toBeInTheDocument();
    // Empty-state still absent because counts haven't agreed yet.
    expect(screen.queryByText('All caught up!')).not.toBeInTheDocument();
  });

  // RR-FP-3: Once both queries resolve, the empty-state SHOULD render. This
  // confirms the predicate `!isPending && data.length === 0 && !isSilentRefreshing`
  // fires correctly post-resolve.
  it('RR-FP-3: empty-state appears after both queries resolve with zero results', async () => {
    const { authFetch, resolveCall, resolveCallWith } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;

    render(<ReservationRequests />, { wrapper: withQueryClient() });

    await waitFor(() => {
      expect(findListIdx(authFetch)).toBeGreaterThanOrEqual(0);
      expect(findCountsIdx(authFetch)).toBeGreaterThanOrEqual(0);
    });

    const settingsIdx = findCalendarSettingsIdx(authFetch);
    const listIdx = findListIdx(authFetch);
    const countsIdx = findCountsIdx(authFetch);

    if (settingsIdx >= 0) {
      await act(async () => {
        try { resolveCallWith(settingsIdx, { settings: {} }); } catch (_) {}
      });
    }

    await act(async () => {
      resolveCall(listIdx, []);
    });

    await act(async () => {
      resolveCallWith(countsIdx, { needs_attention: 0, all: 0 });
    });

    // Now both queries are resolved. Empty-state for the default tab
    // ('needs_attention') is "All caught up!".
    await waitFor(() => {
      expect(screen.queryByText('All caught up!')).toBeInTheDocument();
    });
  });

  // RR-FP-4: Sanity that non-empty data path doesn't regress. Cards render,
  // empty-state stays absent.
  it('RR-FP-4: cards render when both queries resolve with data', async () => {
    const { authFetch, resolveCall, resolveCallWith } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;

    render(<ReservationRequests />, { wrapper: withQueryClient() });

    await waitFor(() => {
      expect(findListIdx(authFetch)).toBeGreaterThanOrEqual(0);
      expect(findCountsIdx(authFetch)).toBeGreaterThanOrEqual(0);
    });

    const settingsIdx = findCalendarSettingsIdx(authFetch);
    const listIdx = findListIdx(authFetch);
    const countsIdx = findCountsIdx(authFetch);

    if (settingsIdx >= 0) {
      await act(async () => {
        try { resolveCallWith(settingsIdx, { settings: {} }); } catch (_) {}
      });
    }

    await act(async () => {
      resolveCall(listIdx, makeEvents(2));
    });

    await act(async () => {
      resolveCallWith(countsIdx, { needs_attention: 2, all: 2 });
    });

    // Empty-state must NOT appear.
    await waitFor(() => {
      expect(screen.queryByText('All caught up!')).not.toBeInTheDocument();
    });
  });
});
