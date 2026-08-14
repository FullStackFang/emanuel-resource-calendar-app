// src/__tests__/unit/components/UserAdmin.firstPaint.test.jsx
//
// Mirrors MyReservations.firstPaint / ReservationRequests.firstPaint /
// EventManagement.firstPaint for the user roster.
//
// The bug class: TanStack v5's `isLoading` is `isPending && isFetching`, so it
// is FALSE during the `pending && idle` tick between `enabled` flipping true
// and the request actually starting. A component gating its spinner on
// `isLoading` renders its empty state for one tick first. UserAdmin binds
// `loading` to deriveListLoadingState(...).isFirstLoad, which tracks
// `isPending` and covers both windows.
//
// The other half of this file is the defect the roster rewrite exists to fix:
// a failed fetch used to render "No users yet — create your first user" to an
// administrator whose directory had just failed to load.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { withQueryClient, createTestQueryClient } from '../../__helpers__/queryClientWrapper';

vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));

vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({ accounts: [{ username: 'caller@test.com' }] }),
}));

vi.mock('../../../hooks/useDepartments', () => ({ default: () => ({ departments: [] }) }));
vi.mock('../../../hooks/useRoleTypes', () => ({ default: () => ({ roleTypes: [] }) }));

vi.mock('../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess: vi.fn(), showWarning: vi.fn(), showError: vi.fn() }),
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ role: 'admin' }),
}));

// Stable testid so spinner presence/absence is assertable.
vi.mock('../../../components/shared/LoadingSpinner', () => ({
  default: () => <div data-testid="loading-spinner" />,
}));

import UserAdmin from '../../../components/UserAdmin';

const USERS = [
  { _id: 'a1', email: 'adam@test.com', displayName: 'Adam Admin', effectiveRole: 'admin', role: 'admin' },
  { _id: 'v1', email: 'vera@test.com', displayName: 'Vera Viewer', effectiveRole: 'viewer', role: 'viewer' },
];

// A fetch whose responses are resolved by the test, so the in-flight window
// can be inspected rather than raced past.
function makeControllableFetch() {
  const pending = [];
  const fn = vi.fn(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  return {
    fetch: fn,
    settle: (index, body) => pending[index].resolve({ ok: true, json: async () => body }),
    fail: (index) => pending[index].resolve({ ok: false, statusText: 'Service Unavailable' }),
    count: () => pending.length,
  };
}

const renderRoster = (token = 'tok') =>
  render(<UserAdmin apiToken={token} />, { wrapper: withQueryClient() });

describe('UserAdmin — first paint and state separation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // UAFP-1: the smoking gun. While the query is pending, the spinner is on
  // screen and NO empty state — of either kind — has rendered.
  it('UAFP-1: shows a spinner during the pending window, never an empty state', async () => {
    const ctl = makeControllableFetch();
    vi.stubGlobal('fetch', ctl.fetch);

    renderRoster();

    await waitFor(() => expect(screen.getByTestId('loading-spinner')).toBeInTheDocument());

    expect(screen.queryByText('No users yet')).not.toBeInTheDocument();
    expect(screen.queryByText('No accounts match these filters')).not.toBeInTheDocument();
    expect(screen.queryByText('Could not load the user directory')).not.toBeInTheDocument();

    await act(async () => { ctl.settle(0, USERS); });
    await waitFor(() => expect(screen.getByText('Adam Admin')).toBeInTheDocument());
    expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
  });

  // UAFP-2: the `pending && idle` window. While the token has not arrived the
  // query is disabled-but-imminent: status 'pending', fetchStatus 'idle'. That
  // is precisely where TanStack's `isLoading` (= isPending && isFetching) is
  // FALSE while `isPending` is true.
  //
  // The assertions are deliberately SYNCHRONOUS. Wrapping them in waitFor
  // would let the fetch start, at which point the two flags agree and the test
  // stops discriminating between them. Binding `loading` to query.isLoading
  // fails this test on the first assertion — the content area renders as a
  // bare page with no spinner and no explanation.
  it('UAFP-2: a not-yet-arrived token shows the spinner, not a bare page', async () => {
    const ctl = makeControllableFetch();
    vi.stubGlobal('fetch', ctl.fetch);

    const { rerender } = render(<UserAdmin apiToken={null} />, { wrapper: withQueryClient() });
    await act(async () => { await Promise.resolve(); });

    // No request has been made, yet the roster must already read as loading.
    expect(ctl.count()).toBe(0);
    expect(screen.queryByTestId('loading-spinner')).toBeInTheDocument();
    expect(screen.queryByText('No users yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Could not load the user directory')).not.toBeInTheDocument();

    // And it stays up across the token arriving, with no empty-state flash.
    rerender(<UserAdmin apiToken="fresh-token" />);
    expect(screen.queryByTestId('loading-spinner')).toBeInTheDocument();
    expect(screen.queryByText('No users yet')).not.toBeInTheDocument();
  });

  it('UAFP-3: an empty directory renders the empty state only after the fetch resolves', async () => {
    const ctl = makeControllableFetch();
    vi.stubGlobal('fetch', ctl.fetch);

    renderRoster();
    await waitFor(() => expect(ctl.count()).toBe(1));
    expect(screen.queryByText('No users yet')).not.toBeInTheDocument();

    await act(async () => { ctl.settle(0, []); });

    await waitFor(() => expect(screen.getByText('No users yet')).toBeInTheDocument());
    expect(screen.getByText('Add Your First User')).toBeInTheDocument();
    // The genuinely-empty state also offers a refresh, because a zero-row
    // success is the one case where "try again" is a reasonable next move.
    expect(screen.getByRole('button', { name: /Refresh Data/i })).toBeInTheDocument();
  });

  // UAFP-4: the defect this rewrite exists to close. A failed load must state
  // the failure and must NOT borrow the empty-directory message.
  it('UAFP-4: a failed load is reported as a failure, never as an empty directory', async () => {
    const ctl = makeControllableFetch();
    vi.stubGlobal('fetch', ctl.fetch);

    renderRoster();
    await waitFor(() => expect(ctl.count()).toBe(1));

    await act(async () => { ctl.fail(0); });

    await waitFor(() => expect(screen.getByText('Could not load the user directory')).toBeInTheDocument());

    expect(screen.queryByText('No users yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Create your first user to get started')).not.toBeInTheDocument();
    expect(screen.queryByText('No accounts match these filters')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument();
  });

  // UAFP-5: a background refetch dims the rows in place rather than replacing
  // them with a spinner. This is what stops a save from blanking the page —
  // the defect where every save re-triggered the full-page loading gate.
  it('UAFP-5: a silent refresh keeps the rows and chrome mounted, dimmed', async () => {
    const ctl = makeControllableFetch();
    vi.stubGlobal('fetch', ctl.fetch);

    const client = createTestQueryClient();
    render(<UserAdmin apiToken="tok" />, { wrapper: withQueryClient(client) });

    await waitFor(() => expect(ctl.count()).toBe(1));
    await act(async () => { ctl.settle(0, USERS); });
    await waitFor(() => expect(screen.getByText('Adam Admin')).toBeInTheDocument());
    expect(document.querySelector('.ua-roster').className).not.toContain('is-refreshing');

    // Invalidate — the same thing a save/create/delete mutation does — and
    // hold the resulting fetch in flight.
    act(() => { client.invalidateQueries({ queryKey: ['users', 'list'] }); });
    await waitFor(() => expect(ctl.count()).toBe(2));

    // Rows still on screen, dimmed. No spinner has taken the page.
    expect(screen.getByText('Adam Admin')).toBeInTheDocument();
    expect(screen.getByText('Vera Viewer')).toBeInTheDocument();
    expect(document.querySelector('.ua-roster').className).toContain('is-refreshing');
    expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();

    // Chrome stayed mounted throughout.
    expect(screen.getByRole('tab', { name: /Everyone/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Search users')).toBeInTheDocument();

    await act(async () => { ctl.settle(1, USERS); });
    await waitFor(() =>
      expect(document.querySelector('.ua-roster').className).not.toContain('is-refreshing')
    );
  });
});
