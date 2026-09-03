// MyAssignments.firstPaint.test.jsx
//
// Locks the standard list-view loading contract on the derived assignments
// view (task 4.2): `loading` binds to deriveListLoadingState().isFirstLoad
// (isPending, NOT TanStack's isLoading), the empty state renders only after a
// genuine resolve, and it carries the refresh affordance.
//
// Test IDs: MAFP-1 to MAFP-4

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor, within } from '@testing-library/react';
import { makeControllableAuthFetch } from '../../__helpers__/mockAuthFetch';
import { withQueryClient } from '../../__helpers__/queryClientWrapper';

vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));

let currentApiToken = 'token';
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: currentApiToken, user: { name: 'Tagged User', email: 'tagged@x.org' } }),
}));

vi.mock('../../../components/shared/LoadingSpinner', () => ({
  default: ({ variant }) => <div data-testid="loading-spinner" data-variant={variant} />,
}));

let currentAuthFetch = vi.fn();
vi.mock('../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => currentAuthFetch,
}));

import MyAssignments from '../../../components/MyAssignments';

const ASSIGNMENTS = [
  {
    dayId: 'd1', sheetId: 's1', sheetName: '2026 High Holy Days',
    date: '2026-09-11', dayTitle: 'Erev Rosh Hashanah',
    rowLabel: 'Ushers', columnName: 'Erev Service',
    callTime: '16:00', begins: '16:30', ends: '19:00',
    location: '5th Ave Sanctuary', note: 'North door',
  },
  {
    dayId: 'd2', sheetId: 's1', sheetName: '2026 High Holy Days',
    date: '2026-09-20', dayTitle: 'Kol Nidre',
    rowLabel: 'Corner Greeters', columnName: 'Evening Service',
    callTime: null, begins: '18:00', ends: '21:00',
    location: null, note: null,
  },
];

describe('MyAssignments — first paint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentApiToken = 'token';
  });

  // The pending && idle tick: the query is disabled while the token resolves,
  // so isLoading is FALSE while isPending is true. A gate bound to isLoading
  // would flash 'No upcoming assignments' at someone who has ten.
  it('MAFP-1: spinner holds (no empty flash) while the token is still resolving', () => {
    currentApiToken = null;
    const { authFetch } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;

    render(<MyAssignments />, { wrapper: withQueryClient() });

    expect(authFetch).not.toHaveBeenCalled();
    expect(screen.getByTestId('my-assignments-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('my-assignments-empty')).not.toBeInTheDocument();
    // One loading veil across every tab: the Calendar's overlay variant.
    expect(screen.getByTestId('loading-spinner')).toHaveAttribute('data-variant', 'overlay');
  });

  it('MAFP-2: spinner holds while the fetch is in flight', async () => {
    const controllable = makeControllableAuthFetch();
    currentAuthFetch = controllable.authFetch;

    render(<MyAssignments />, { wrapper: withQueryClient() });

    await waitFor(() => expect(controllable.authFetch).toHaveBeenCalled());
    expect(screen.getByTestId('my-assignments-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('my-assignments-empty')).not.toBeInTheDocument();
  });

  it('MAFP-3: a genuine empty resolve shows the empty state with the refresh affordance', async () => {
    const controllable = makeControllableAuthFetch();
    currentAuthFetch = controllable.authFetch;

    render(<MyAssignments />, { wrapper: withQueryClient() });
    await waitFor(() => expect(controllable.authFetch).toHaveBeenCalled());

    await act(async () => {
      controllable.resolveCallWith(0, []);
    });

    const empty = await screen.findByTestId('my-assignments-empty');
    expect(empty).toHaveTextContent(/no upcoming assignments/i);
    expect(within(empty).getByRole('button')).toBeInTheDocument();
  });

  it('MAFP-4: assignments render grouped by day, naming the workbook and the effective call time', async () => {
    const controllable = makeControllableAuthFetch();
    currentAuthFetch = controllable.authFetch;

    render(<MyAssignments />, { wrapper: withQueryClient() });
    await waitFor(() => expect(controllable.authFetch).toHaveBeenCalled());

    await act(async () => {
      controllable.resolveCallWith(0, ASSIGNMENTS);
    });

    const day1 = await screen.findByTestId('assignment-day-2026-09-11');
    expect(day1).toHaveTextContent('Erev Rosh Hashanah');
    expect(day1).toHaveTextContent('2026 High Holy Days');
    expect(within(day1).getByTestId('assignment-calltime')).toHaveTextContent('Call 16:00');
    expect(day1).toHaveTextContent('North door');

    expect(screen.getByTestId('assignment-day-2026-09-20')).toHaveTextContent('Corner Greeters');
    expect(screen.queryByTestId('my-assignments-empty')).not.toBeInTheDocument();
  });
});
