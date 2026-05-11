// src/__tests__/unit/components/ReservationRequests.allTabSearch.test.jsx
//
// Locks the rewrite that turned the Approval Queue's "All Requests" tab from
// an auto-fetch-1000-records experience into a search-driven one.
//
// RRAS-1: switching to All Requests with no filters does not fire a list query
// RRAS-2: typing into the search box (300ms debounce) fires exactly one fetch
//         with ?search= against the all-requests endpoint
// RRAS-3: All Requests with no filters renders the "Search N requests" prompt,
//         not the legacy "No requests" empty state

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { makeControllableAuthFetch } from '../../__helpers__/mockAuthFetch';
import { withQueryClient } from '../../__helpers__/queryClientWrapper';

// ─── Static mocks (mirrors ReservationRequests.firstPaint.test.jsx) ──────────

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
    isOpen: false,
    editableData: null,
    hasChanges: false,
    closeModal: vi.fn(),
    openModal: vi.fn(),
    navigateToEvent: vi.fn(),
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

// The 'all' tab uses a page-sized fetch (limit=20). The 'needs_attention' tab
// is the bounded 1000-record fetch. We use this distinction to assert which
// tab caused a call.
function findAllListIdx(authFetch) {
  return findIdx(authFetch, (url) => url.includes('/events/list?') && url.includes('view=approval-queue') && url.includes('limit=20'));
}

function findNeedsListIdx(authFetch) {
  return findIdx(authFetch, (url) => url.includes('/events/list?') && url.includes('view=approval-queue') && url.includes('limit=1000'));
}

function findCountsIdx(authFetch) {
  return findIdx(authFetch, (url) => url.includes('/counts') && url.includes('view=approval-queue'));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

import ReservationRequests from '../../../components/ReservationRequests';

describe('ReservationRequests — All Requests tab is search-only', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    currentApiToken = 'token';
  });

  // RRAS-1: With no filters, switching to All Requests does NOT fetch a list.
  // The legacy behavior auto-fired /events/list?view=approval-queue&limit=1000,
  // which on a 2,230-record DB was both wasteful and silently truncated.
  it('RRAS-1: switching to All Requests with no filters does not fire a list query', async () => {
    const { authFetch, resolveCall, resolveCallWith } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;

    render(<ReservationRequests />, { wrapper: withQueryClient() });

    // Resolve initial queries (counts + needs_attention list + calendar settings).
    await waitFor(() => {
      expect(findCountsIdx(authFetch)).toBeGreaterThanOrEqual(0);
      expect(findNeedsListIdx(authFetch)).toBeGreaterThanOrEqual(0);
    });

    // Resolve them with simple empty responses so the UI quiesces.
    await act(async () => {
      const countsIdx = findCountsIdx(authFetch);
      const needsIdx = findNeedsListIdx(authFetch);
      resolveCallWith(countsIdx, { needsAttention: 0, all: 2230, pending: 0, published: 0, rejected: 0 });
      resolveCall(needsIdx, []);
      // Calendar settings fetch (best-effort; may not always fire in test env).
      const remaining = authFetch.mock.calls.length;
      for (let i = 0; i < remaining; i++) {
        try { resolveCallWith(i, { availableCalendars: [], defaultCalendar: 'test@test.com' }); } catch { /* already resolved */ }
      }
    });

    // Snapshot the call count before clicking All Requests.
    const callsBefore = authFetch.mock.calls.length;

    // Click the All Requests tab.
    const allTabButton = await screen.findByRole('button', { name: /all requests/i });
    await act(async () => { fireEvent.click(allTabButton); });

    // Allow a generous beat for any deferred fetch to fire.
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // No new fetch matching the all-tab pattern should have fired. The counts
    // query is already cached for this view, so it shouldn't refetch either.
    const allFetchAfter = findAllListIdx(authFetch);
    expect(allFetchAfter).toBe(-1);
    // Net new calls cap: zero net new beyond what was there before clicking.
    expect(authFetch.mock.calls.length).toBe(callsBefore);
  });

  // RRAS-3: The empty state on All Requests with no filters is the new
  // "Search N requests" prompt, not the legacy "No requests" copy.
  it('RRAS-3: All Requests with no filters renders the Search prompt empty state', async () => {
    const { authFetch, resolveCall, resolveCallWith } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;

    render(<ReservationRequests />, { wrapper: withQueryClient() });

    await waitFor(() => {
      expect(findCountsIdx(authFetch)).toBeGreaterThanOrEqual(0);
      expect(findNeedsListIdx(authFetch)).toBeGreaterThanOrEqual(0);
    });
    await act(async () => {
      const countsIdx = findCountsIdx(authFetch);
      const needsIdx = findNeedsListIdx(authFetch);
      resolveCallWith(countsIdx, { needsAttention: 0, all: 2230, pending: 0, published: 0, rejected: 0 });
      resolveCall(needsIdx, []);
      const remaining = authFetch.mock.calls.length;
      for (let i = 0; i < remaining; i++) {
        try { resolveCallWith(i, { availableCalendars: [], defaultCalendar: 'test@test.com' }); } catch { /* already resolved */ }
      }
    });

    const allTabButton = await screen.findByRole('button', { name: /all requests/i });
    await act(async () => { fireEvent.click(allTabButton); });

    await waitFor(() => {
      // The new empty state shows the count and the search prompt.
      expect(screen.getByText(/Search 2230 requests/i)).toBeInTheDocument();
    });
    // And the legacy "No requests" copy should not appear here.
    expect(screen.queryByText(/^No requests$/)).not.toBeInTheDocument();
  });

  // RRAS-2: Typing into the search box on the All Requests tab fires exactly
  // one fetch, after the 300ms debounce, to /events/list with ?search= and
  // limit=20 (page-size). Earlier keystrokes are debounced away.
  it('RRAS-2: typing a search term debounces and fires one fetch with ?search=', async () => {
    const { authFetch, resolveCall, resolveCallWith } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;

    render(<ReservationRequests />, { wrapper: withQueryClient() });

    await waitFor(() => {
      expect(findCountsIdx(authFetch)).toBeGreaterThanOrEqual(0);
      expect(findNeedsListIdx(authFetch)).toBeGreaterThanOrEqual(0);
    });
    await act(async () => {
      const countsIdx = findCountsIdx(authFetch);
      const needsIdx = findNeedsListIdx(authFetch);
      resolveCallWith(countsIdx, { needsAttention: 0, all: 2230, pending: 0, published: 0, rejected: 0 });
      resolveCall(needsIdx, []);
      const remaining = authFetch.mock.calls.length;
      for (let i = 0; i < remaining; i++) {
        try { resolveCallWith(i, { availableCalendars: [], defaultCalendar: 'test@test.com' }); } catch { /* already resolved */ }
      }
    });

    // Switch to All Requests.
    const allTabButton = await screen.findByRole('button', { name: /all requests/i });
    await act(async () => { fireEvent.click(allTabButton); });

    // Find the search input and type three characters in quick succession.
    const searchInput = screen.getByPlaceholderText(/Search by title/i);
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'w' } });
      fireEvent.change(searchInput, { target: { value: 'we' } });
      fireEvent.change(searchInput, { target: { value: 'wedding' } });
    });

    // Mid-debounce: no fetch yet.
    expect(findAllListIdx(authFetch)).toBe(-1);

    // After the 300ms debounce window, exactly one fetch fires.
    await act(async () => { await new Promise(r => setTimeout(r, 400)); });

    const allRequestsCalls = authFetch.mock.calls.filter(
      ([url]) => url.includes('/events/list?') && url.includes('view=approval-queue') && url.includes('limit=20')
    );
    expect(allRequestsCalls).toHaveLength(1);
    // And it carries the final search term, not the intermediate ones.
    expect(allRequestsCalls[0][0]).toContain('search=wedding');
    expect(allRequestsCalls[0][0]).not.toContain('search=w&');
  });
});
