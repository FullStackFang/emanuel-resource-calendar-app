// src/__tests__/unit/components/mobile/MobileRequests.firstPaint.test.jsx
//
// Locks the first-paint blank-flash convention for the mobile Requests tab,
// mirroring MyReservations.firstPaint / ReservationRequests.firstPaint /
// EventManagement.firstPaint.
//
// The bug class: binding `loading` to TanStack v5's `isLoading` (= isPending &&
// isFetching) leaves it FALSE during the `pending && idle` tick between
// `enabled` flipping true and the request starting. During that tick `data` is
// undefined, so an empty-state predicate that only checks `length === 0` paints
// "No requests yet" before the skeleton. MobileRequests binds `loading` to
// `deriveListLoadingState(...).isFirstLoad` (= isPending), which covers it.
//
// See CLAUDE.md "React Query loading primitives (TanStack v5)".

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { makeControllableAuthFetch } from '../../../__helpers__/mockAuthFetch';
import { withQueryClient } from '../../../__helpers__/queryClientWrapper';

vi.mock('../../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));

vi.mock('../../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), log: vi.fn() },
}));

let currentApiToken = null;
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: currentApiToken }),
}));

vi.mock('../../../../context/SSEContext', () => ({
  useSSE: () => ({ isConnected: true }),
}));

// Identity transform — these tests supply already-flat documents.
vi.mock('../../../../utils/eventTransformers', () => ({
  transformEventsToFlatStructure: (events) => events,
  transformEventToFlatStructure: (event) => event,
}));

// The detail sheet pulls in MSAL and the floor-plan fetch; neither is under
// test here and the sheet renders nothing while no event is selected.
vi.mock('../../../../components/mobile/MobileEventDetail', () => ({
  default: () => null,
}));

let currentAuthFetch = vi.fn();
vi.mock('../../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => currentAuthFetch,
}));

// ─── URL routing helpers ─────────────────────────────────────────────────────

function findIdx(authFetch, predicate) {
  return authFetch.mock.calls.findIndex(([url]) => predicate(url));
}

const findListIdx = (authFetch) => findIdx(authFetch, (url) =>
  url.includes('/events/list?') && url.includes('view=my-events') && !url.includes('/counts'));

const findCountsIdx = (authFetch) => findIdx(authFetch, (url) =>
  url.includes('/events/list/counts') && url.includes('view=my-events'));

const COUNTS = { all: 0, pending: 0, published: 0, rejected: 0, draft: 0, deleted: 0 };

function makeRequests(count) {
  return Array.from({ length: count }, (_, i) => ({
    _id: `req-${i}`,
    id: `req-${i}`,
    eventId: `req-${i}`,
    status: 'pending',
    eventTitle: `Request ${i}`,
    startDate: '2026-08-04',
    startDateTime: '2026-08-04T14:00:00Z',
    categories: [],
  }));
}

import MobileRequests from '../../../../components/mobile/MobileRequests';

describe('MobileRequests — first-paint blank-flash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentApiToken = null;
  });

  // MRQ-FP-1: the smoking-gun tick. Token arrives, the query enables but has
  // not started fetching. The skeleton must already own the screen.
  it('MRQ-FP-1: cold token arrival shows the skeleton, never the empty state', async () => {
    const { authFetch } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;
    currentApiToken = null;

    const { rerender } = render(<MobileRequests />, { wrapper: withQueryClient() });
    await act(async () => { await Promise.resolve(); });

    currentApiToken = 'fresh-token';
    rerender(<MobileRequests />);

    await waitFor(() => {
      expect(screen.queryByTestId('mobile-requests-skeleton')).toBeInTheDocument();
    });
    expect(screen.queryByText('No requests yet')).not.toBeInTheDocument();
  });

  // MRQ-FP-2: counts resolving first must NOT clear the skeleton. The counts
  // query feeds isSilentRefreshing only; the first-load gate is the LIST
  // query's isPending. Guards against the two being swapped.
  it('MRQ-FP-2: skeleton persists while the list query is still pending', async () => {
    const { authFetch, resolveCallWith } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;
    currentApiToken = 'token';

    render(<MobileRequests />, { wrapper: withQueryClient() });

    await waitFor(() => {
      expect(findListIdx(authFetch)).toBeGreaterThanOrEqual(0);
      expect(findCountsIdx(authFetch)).toBeGreaterThanOrEqual(0);
    });

    await act(async () => {
      resolveCallWith(findCountsIdx(authFetch), COUNTS);
    });

    expect(screen.queryByTestId('mobile-requests-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('No requests yet')).not.toBeInTheDocument();
  });

  // MRQ-FP-3: the post-resolve half of the predicate. A genuinely empty result
  // must reach the empty state, or the fix would be a permanent spinner.
  it('MRQ-FP-3: empty state appears once the list resolves with zero requests', async () => {
    const { authFetch, resolveCall, resolveCallWith } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;
    currentApiToken = 'token';

    render(<MobileRequests />, { wrapper: withQueryClient() });

    await waitFor(() => {
      expect(findListIdx(authFetch)).toBeGreaterThanOrEqual(0);
      expect(findCountsIdx(authFetch)).toBeGreaterThanOrEqual(0);
    });

    await act(async () => {
      resolveCallWith(findCountsIdx(authFetch), COUNTS);
      resolveCall(findListIdx(authFetch), []);
    });

    await waitFor(() => {
      expect(screen.getByText('No requests yet')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('mobile-requests-skeleton')).not.toBeInTheDocument();
  });

  // MRQ-FP-4: non-empty resolve renders cards and retires the skeleton.
  it('MRQ-FP-4: cards render when the list resolves with data', async () => {
    const { authFetch, resolveCall, resolveCallWith } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;
    currentApiToken = 'token';

    render(<MobileRequests />, { wrapper: withQueryClient() });

    await waitFor(() => {
      expect(findListIdx(authFetch)).toBeGreaterThanOrEqual(0);
      expect(findCountsIdx(authFetch)).toBeGreaterThanOrEqual(0);
    });

    await act(async () => {
      resolveCallWith(findCountsIdx(authFetch), { ...COUNTS, all: 2, pending: 2 });
      resolveCall(findListIdx(authFetch), makeRequests(2));
    });

    await waitFor(() => {
      expect(screen.getByText('Request 0')).toBeInTheDocument();
    });
    expect(screen.getByText('Request 1')).toBeInTheDocument();
    expect(screen.queryByText('No requests yet')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mobile-requests-skeleton')).not.toBeInTheDocument();
  });
});
