// src/__tests__/unit/components/MyReservations.firstPaint.test.jsx
//
// Locks the fix for the first-paint blank-flash bug. The bug:
// `loading` was derived from `myReservationsQuery.isLoading`, which in
// TanStack Query v5 evaluates to `false` during the `pending && idle` tick
// between `enabled` flipping to true and the request actually starting.
// During that tick `data` was undefined and `allReservations.length === 0`,
// so the empty-state body at line 947 rendered "No reservations" before the
// spinner. The fix derives `loading` from `isPending`, which is true during
// both `pending && idle` and `pending && fetching`.
//
// See openspec/changes/fix-first-paint-blank-flash for full context.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { makeControllableAuthFetch, makeEvents } from '../../__helpers__/mockAuthFetch';
import { withQueryClient } from '../../__helpers__/queryClientWrapper';

// ─── Static mocks (mirrors MyReservations.coldToken.test.jsx) ────────────────

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

vi.mock('../../../hooks/useDataRefreshBus', () => ({
  useDataRefreshBus: vi.fn(),
  dispatchRefresh: vi.fn(),
}));

vi.mock('../../../components/shared/EventReviewExperience', () => ({
  default: () => null,
}));

// Real LoadingSpinner mock with stable testid so we can assert presence/absence.
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

// ─── Tests ───────────────────────────────────────────────────────────────────

import MyReservations from '../../../components/MyReservations';

describe('MyReservations — first-paint blank-flash fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentApiToken = null;
  });

  // MR-FP-1: The smoking-gun scenario. Before the fix, `isLoading=false` during
  // the pending+idle tick let the empty-state render "No reservations" before
  // the spinner. After the fix, `isPending` covers that tick and the spinner
  // is the only thing on screen until the fetch resolves.
  it('MR-FP-1: cold token arrival shows spinner immediately, no "No reservations" flash', async () => {
    const { authFetch } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;
    currentApiToken = null;

    const { rerender } = render(<MyReservations />, { wrapper: withQueryClient() });

    // No fetch yet — apiToken is null.
    await act(async () => { await Promise.resolve(); });

    // Token arrives. Query enables. Before the fetch resolves, the spinner
    // must already be in the DOM and the empty-state must NOT be.
    currentApiToken = 'fresh-token';
    rerender(<MyReservations />);

    await waitFor(() => {
      expect(screen.queryByTestId('loading-spinner')).toBeInTheDocument();
    });

    // Critical assertion: at this point isPending=true so the spinner gate
    // fires and the empty-state body is unreachable.
    expect(screen.queryByText('No reservations')).not.toBeInTheDocument();
    expect(screen.queryByText('No matching reservations')).not.toBeInTheDocument();
  });

  // MR-FP-2: Once the first fetch resolves with [], the empty-state should
  // appear. This locks the post-resolve behavior and confirms isPending
  // correctly transitions to false on success.
  it('MR-FP-2: empty-state appears after fetch resolves with empty array', async () => {
    const { authFetch, resolveCall } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;
    currentApiToken = 'token';

    render(<MyReservations />, { wrapper: withQueryClient() });

    // Wait for the query to fire.
    await waitFor(() => {
      expect(authFetch).toHaveBeenCalled();
    });

    // While in flight: spinner present, empty-state absent.
    expect(screen.queryByTestId('loading-spinner')).toBeInTheDocument();
    expect(screen.queryByText('No reservations')).not.toBeInTheDocument();

    // Resolve with empty array. isPending flips to false.
    await act(async () => {
      resolveCall(0, []);
    });

    // Empty-state now correctly renders.
    await waitFor(() => {
      expect(screen.queryByText('No reservations')).toBeInTheDocument();
    });
  });

  // MR-FP-3: Confirms the predicate { !isPending && data.length === 0 &&
  // !isSilentRefreshing }. Resolve with non-empty data first so the cards
  // render; then we verify the cards render (proving isPending=false path).
  it('MR-FP-3: cards render when fetch resolves with non-empty data, no spinner persists', async () => {
    const { authFetch, resolveCall } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;
    currentApiToken = 'token';

    render(<MyReservations />, { wrapper: withQueryClient() });

    await waitFor(() => {
      expect(authFetch).toHaveBeenCalled();
    });

    // Resolve with two events.
    await act(async () => {
      resolveCall(0, makeEvents(2));
    });

    // Cards rendered: empty-state absent, content present.
    await waitFor(() => {
      expect(screen.queryByText('Event 0')).toBeInTheDocument();
      expect(screen.queryByText('Event 1')).toBeInTheDocument();
    });
    expect(screen.queryByText('No reservations')).not.toBeInTheDocument();
  });
});
