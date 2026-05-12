// src/__tests__/unit/components/EventManagement.firstPaint.test.jsx
//
// Locks the fix for the first-paint blank-flash bug in EventManagement.
// The component has TWO TanStack queries (list + counts), both enabled only
// when `apiToken` is present AND `isAdmin === true`. The pre-fix
// `loading = eventsQuery.isLoading` evaluated to false during the pending+idle
// tick when `enabled: true` flipped, allowing the "No events found" empty-state
// to render for a single tick before data arrived. Additionally, the
// empty-state predicate at line 670 only checked `!isSilentRefreshing` — it
// had no `!loading` guard at all, so it could fire even mid-load.
//
// The fix derives `loading` from `isPending` and gates the empty-state on
// `!loading && !isSilentRefreshing`, mirroring MyReservations.jsx and
// ReservationRequests.jsx.
//
// This test ALSO locks the "Refresh Data" recovery CTA inside the
// empty-state — defense-in-depth so a future regression would leave a
// user-actionable recovery path.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { makeControllableAuthFetch, makeEvents } from '../../__helpers__/mockAuthFetch';
import { withQueryClient } from '../../__helpers__/queryClientWrapper';

// ─── Static mocks ───────────────────────────────────────────────────────────

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
}));

vi.mock('../../../context/SSEContext', () => ({
  useSSE: () => ({ isConnected: true }),
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    isAdmin: true,
    canApproveReservations: true,
    canEditEvents: true,
    canDeleteEvents: true,
    canCreateEvents: true,
    canViewCalendar: true,
    canSubmitReservation: true,
    permissionsLoading: false,
    canEditField: () => true,
    role: 'admin',
  }),
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

vi.mock('../../../components/shared/RecurringScopeDialog', () => ({
  default: () => null,
}));

vi.mock('../../../components/shared/ConflictDialog', () => ({
  default: () => null,
}));

vi.mock('../../../components/DatePickerInput', () => ({
  default: ({ value, onChange }) => (
    <input data-testid="date-picker-input" value={value || ''} onChange={onChange || vi.fn()} readOnly />
  ),
}));

vi.mock('../../../hooks/useEventReviewExperience', () => ({
  useEventReviewExperience: () => ({
    isOpen: false,
    currentItem: null,
    editableData: null,
    openModal: vi.fn(),
    closeModal: vi.fn(),
    handleRequestEdit: vi.fn(),
    handleOwnerEdit: vi.fn(),
    navigateToEvent: vi.fn(),
    isDraft: false,
    isSavingOwnerEdit: false,
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
  return findIdx(authFetch, (url) =>
    url.includes('/events/list?') && url.includes('view=admin-browse') && !url.includes('/counts')
  );
}

function findCountsIdx(authFetch) {
  return findIdx(authFetch, (url) =>
    url.includes('/events/list/counts') && url.includes('view=admin-browse')
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

import EventManagement from '../../../components/EventManagement';

describe('EventManagement — first-paint blank-flash fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentApiToken = 'token';
  });

  // EM-FP-1: Spinner must be present immediately after the queries enable.
  // Before the fix, `loading = eventsQuery.isLoading` was false during the
  // pending+idle tick; the `{loading ? <spinner> : ...}` branch fell through
  // to the content branch, and the empty-state predicate at line 670 had no
  // `!loading` gate at all — so "No events found" rendered for one tick.
  it('EM-FP-1: cold mount shows spinner, no "No events found" flash', async () => {
    const { authFetch } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;

    render(<EventManagement />, { wrapper: withQueryClient() });

    // Wait for the queries to fire.
    await waitFor(() => {
      expect(findListIdx(authFetch)).toBeGreaterThanOrEqual(0);
    });

    // While the list query is in-flight: spinner present, empty-state absent.
    expect(screen.queryByTestId('loading-spinner')).toBeInTheDocument();
    expect(screen.queryByText('No events found')).not.toBeInTheDocument();
  });

  // EM-FP-2: Spinner persists while the list query is still pending even if
  // counts has resolved. The spinner gate is bound to the list query's
  // first-load state (loading = eventsQuery.isPending); counts is part of the
  // silent-refresh detector, not the first-load gate, so this test guards
  // against accidentally swapping the two.
  it('EM-FP-2: spinner persists while list query is still pending', async () => {
    const { authFetch, resolveCallWith } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;

    render(<EventManagement />, { wrapper: withQueryClient() });

    await waitFor(() => {
      expect(findListIdx(authFetch)).toBeGreaterThanOrEqual(0);
      expect(findCountsIdx(authFetch)).toBeGreaterThanOrEqual(0);
    });

    const countsIdx = findCountsIdx(authFetch);

    // Resolve counts first; list still pending.
    await act(async () => {
      resolveCallWith(countsIdx, { total: 0, published: 0, pending: 0, rejected: 0, deleted: 0, draft: 0 });
    });

    // Spinner must still be present because the list query is in-flight.
    expect(screen.queryByTestId('loading-spinner')).toBeInTheDocument();
    expect(screen.queryByText('No events found')).not.toBeInTheDocument();
  });

  // EM-FP-3: After both queries resolve with empty data, the empty-state body
  // SHOULD render. This confirms the predicate
  // `events.length === 0 && !loading && !isSilentRefreshing` fires correctly
  // post-resolve and proves the spinner-gate is no longer permanently stuck.
  it('EM-FP-3: empty-state appears after both queries resolve with zero events', async () => {
    const { authFetch, resolveCall, resolveCallWith } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;

    render(<EventManagement />, { wrapper: withQueryClient() });

    await waitFor(() => {
      expect(findListIdx(authFetch)).toBeGreaterThanOrEqual(0);
      expect(findCountsIdx(authFetch)).toBeGreaterThanOrEqual(0);
    });

    const listIdx = findListIdx(authFetch);
    const countsIdx = findCountsIdx(authFetch);

    await act(async () => {
      resolveCall(listIdx, []);
    });

    await act(async () => {
      resolveCallWith(countsIdx, { total: 0, published: 0, pending: 0, rejected: 0, deleted: 0, draft: 0 });
    });

    await waitFor(() => {
      expect(screen.queryByText('No events found')).toBeInTheDocument();
    });
  });

  // EM-FP-4: The empty-state renders a "Refresh Data" recovery CTA. Locks the
  // defense-in-depth requirement that every list empty state has a
  // user-actionable refresh affordance.
  it('EM-FP-4: empty-state renders a "Refresh Data" recovery CTA', async () => {
    const { authFetch, resolveCall, resolveCallWith } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;

    render(<EventManagement />, { wrapper: withQueryClient() });

    await waitFor(() => {
      expect(findListIdx(authFetch)).toBeGreaterThanOrEqual(0);
      expect(findCountsIdx(authFetch)).toBeGreaterThanOrEqual(0);
    });

    const listIdx = findListIdx(authFetch);
    const countsIdx = findCountsIdx(authFetch);

    await act(async () => {
      resolveCall(listIdx, []);
    });
    await act(async () => {
      resolveCallWith(countsIdx, { total: 0, published: 0, pending: 0, rejected: 0, deleted: 0, draft: 0 });
    });

    await waitFor(() => {
      expect(screen.queryByText('No events found')).toBeInTheDocument();
    });

    // The empty-state must include a refresh CTA the user can click.
    const refreshBtn = screen.getByRole('button', { name: /Refresh/i });
    expect(refreshBtn).toBeInTheDocument();
  });

  // EM-FP-5: Sanity that the non-empty data path doesn't regress.
  it('EM-FP-5: events render when both queries resolve with data', async () => {
    const { authFetch, resolveCall, resolveCallWith } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;

    render(<EventManagement />, { wrapper: withQueryClient() });

    await waitFor(() => {
      expect(findListIdx(authFetch)).toBeGreaterThanOrEqual(0);
      expect(findCountsIdx(authFetch)).toBeGreaterThanOrEqual(0);
    });

    const listIdx = findListIdx(authFetch);
    const countsIdx = findCountsIdx(authFetch);

    await act(async () => {
      resolveCall(listIdx, makeEvents(2));
    });
    await act(async () => {
      resolveCallWith(countsIdx, { total: 2, published: 0, pending: 2, rejected: 0, deleted: 0, draft: 0 });
    });

    await waitFor(() => {
      expect(screen.queryByText('No events found')).not.toBeInTheDocument();
    });
  });
});
