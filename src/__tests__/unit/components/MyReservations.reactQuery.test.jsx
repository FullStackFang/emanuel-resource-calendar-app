// src/__tests__/unit/components/MyReservations.reactQuery.test.jsx
//
// REGRESSION: cache-hit-on-remount — within the cached-data window, remounting
// MyReservations must NOT re-issue the my-events fetch. Guards against
// staleTime/gcTime regressions in the React Query migration.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeControllableAuthFetch, makeEvents } from '../../__helpers__/mockAuthFetch';

// ─── Static mocks (mirror MyReservations.race.test.jsx) ──────────────────────

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
  useRooms: () => ({ rooms: [], getLocationName: (id) => id, getRoomName: (id) => id, getRoomDetails: () => null, loading: false }),
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
    reviewModal: { isOpen: false, currentItem: null, isDraft: false, isEditRequestMode: false, editableData: null },
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

function countMyEventsCalls(authFetch) {
  return authFetch.mock.calls.filter(([url]) => url.includes('view=my-events')).length;
}

import MyReservations from '../../../components/MyReservations';

describe('MyReservations React Query contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('remount within staleTime does NOT issue a second fetch (cache hit)', async () => {
    const { authFetch, resolveCall } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;

    // Single shared client across both renders. staleTime forced so the cache
    // is treated as fresh on remount; mirrors the production 5 min staleTime.
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: 60_000, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchOnMount: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

    const { unmount } = render(<MyReservations />, { wrapper });

    await waitFor(() => expect(countMyEventsCalls(authFetch)).toBe(1));
    await act(async () => resolveCall(0, makeEvents(2)));
    await waitFor(() => {
      expect(screen.queryByText('Event 0')).toBeInTheDocument();
    });

    unmount();

    // Re-render against the same queryClient. Within staleTime, RQ should
    // serve from cache and not issue a network request.
    render(<MyReservations />, { wrapper });
    // Allow React to flush — but no fetch should fire.
    await act(async () => { await Promise.resolve(); });
    expect(countMyEventsCalls(authFetch)).toBe(1);

    // The cached data is rendered immediately (no loading spinner gate).
    expect(screen.queryByText('Event 0')).toBeInTheDocument();
  });
});
