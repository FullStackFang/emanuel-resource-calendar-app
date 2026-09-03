// src/__tests__/unit/components/ConflictReport.firstPaint.test.jsx
//
// The report is a DEFECT LIST, which makes the first-paint blank-flash bug
// worse here than anywhere else it has been fixed: the empty state does not
// read "nothing here yet", it reads "no conflicts were found". Flashing that
// for one tick tells an approver the calendar is clean before the scan has
// even started.
//
// Locks the same contract as MyReservations.firstPaint /
// EventManagement.firstPaint: `loading` derives from `isPending` (not
// TanStack's `isLoading`, which is false during the `pending && idle` tick),
// and the empty state is gated on `!isPending && !isSilentRefreshing`.
//
// Test IDs: CRFP-1 to CRFP-4

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor, within } from '@testing-library/react';
import { makeControllableAuthFetch } from '../../__helpers__/mockAuthFetch';
import { withQueryClient } from '../../__helpers__/queryClientWrapper';

vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));

vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

let currentApiToken = 'token';
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: currentApiToken, user: { name: 'Test Approver', email: 'a@test.com' } }),
}));

vi.mock('../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess: vi.fn(), showWarning: vi.fn(), showError: vi.fn() }),
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    isAdmin: false,
    canApproveReservations: true,
    canEditEvents: true,
    canDeleteEvents: false,
    permissionsLoading: false,
    role: 'approver',
  }),
}));

vi.mock('../../../components/shared/EventReviewExperience', () => ({ default: () => null }));

vi.mock('../../../components/shared/LoadingSpinner', () => ({
  default: ({ variant }) => <div data-testid="loading-spinner" data-variant={variant} />,
}));

vi.mock('../../../hooks/useEventReviewExperience', () => ({
  useEventReviewExperience: () => ({
    isOpen: false,
    currentItem: null,
    editableData: null,
    navigateToEvent: vi.fn(),
    closeModal: vi.fn(),
  }),
}));

let currentAuthFetch = vi.fn();
vi.mock('../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => currentAuthFetch,
}));

import ConflictReport from '../../../components/ConflictReport';

const EMPTY_REPORT = {
  window: { startDate: '2026-08-05', endDate: '2026-11-03', days: 90 },
  calendarOwner: null,
  generatedAt: '2026-08-05T12:00:00.000Z',
  conflictCount: 0,
  conflicts: [],
  groups: [],
  degraded: [],
  truncated: false,
};

function findScanIdx(authFetch) {
  return authFetch.mock.calls.findIndex(([url]) => url.includes('/admin/reports/conflicts'));
}

/**
 * The report settles its calendar selection before scanning, so the calendar
 * list has to resolve or the scan never fires. Compose the controllable mock
 * with an immediate answer for that one endpoint: these tests are about the
 * SCAN's loading states, and leaving the list pending would make them assert a
 * spinner that is up for an unrelated reason.
 */
function withCalendars(controllable, calendars = ['TempleEvents@emanuelnyc.org']) {
  const authFetch = vi.fn((url, opts) => {
    if (String(url).includes('/calendar-display-config')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ allowedDisplayCalendars: calendars }) });
    }
    return controllable.authFetch(url, opts);
  });
  // Index helpers below read the wrapper's calls, but resolveCall* address the
  // inner queue, which only ever receives non-calendar calls. Expose both.
  return { authFetch, inner: controllable };
}

/** Resolve the pending scan on the inner queue (the calendar call never queues). */
function resolveScan(wrapped, body) {
  wrapped.inner.resolveCallWith(0, body);
}

describe('ConflictReport — first paint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentApiToken = 'token';
  });

  // THE case the shared helper exists for. While the query is disabled waiting
  // on the token it sits at `pending && idle` — the one state where TanStack's
  // `isLoading` (= isPending && isFetching) is FALSE while `isPending` is true.
  // A gate bound to `isLoading` falls straight through to the empty state and
  // tells the user "no room conflicts found" before anything has been scanned.
  //
  // Mutation-checked: replacing the gate with `query.isLoading` fails this test.
  it('CRFP-1: while the token is still resolving, the spinner holds and no clean-calendar message appears', () => {
    currentApiToken = null;
    const { authFetch } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;

    render(<ConflictReport />, { wrapper: withQueryClient() });

    expect(authFetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId('loading-spinner')).toBeInTheDocument();
    expect(screen.queryByTestId('conflict-report-empty')).not.toBeInTheDocument();
    // One loading veil across every tab: the Calendar's overlay variant.
    expect(screen.getByTestId('loading-spinner')).toHaveAttribute('data-variant', 'overlay');
  });

  it('CRFP-1b: no empty state appears at any point while the scan is in flight', async () => {
    const wrapped = withCalendars(makeControllableAuthFetch());
    currentAuthFetch = wrapped.authFetch;

    render(<ConflictReport />, { wrapper: withQueryClient() });

    await waitFor(() => {
      expect(findScanIdx(wrapped.authFetch)).toBeGreaterThanOrEqual(0);
    });

    expect(screen.queryByTestId('loading-spinner')).toBeInTheDocument();
    expect(screen.queryByTestId('conflict-report-empty')).not.toBeInTheDocument();
  });

  it('CRFP-2: the scan runs on open with the default 90-day window, no user action', async () => {
    const wrapped = withCalendars(makeControllableAuthFetch());
    currentAuthFetch = wrapped.authFetch;

    render(<ConflictReport />, { wrapper: withQueryClient() });

    await waitFor(() => {
      expect(findScanIdx(wrapped.authFetch)).toBeGreaterThanOrEqual(0);
    });
    expect(wrapped.authFetch.mock.calls[findScanIdx(wrapped.authFetch)][0]).toContain('days=90');
  });

  it('CRFP-3: once resolved with no conflicts, the empty state appears and reads as success', async () => {
    const wrapped = withCalendars(makeControllableAuthFetch());
    currentAuthFetch = wrapped.authFetch;

    render(<ConflictReport />, { wrapper: withQueryClient() });
    await waitFor(() => expect(findScanIdx(wrapped.authFetch)).toBeGreaterThanOrEqual(0));

    await act(async () => {
      resolveScan(wrapped, EMPTY_REPORT);
    });

    const empty = await screen.findByTestId('conflict-report-empty');
    expect(empty).toHaveTextContent(/no room conflicts/i);
    // A recovery affordance must exist inside any blank state that slips
    // through — list-view convention, defense in depth.
    expect(within(empty).getByRole('button', { name: /re-run scan/i })).toBeInTheDocument();
  });

  it('CRFP-4: a background re-scan keeps previous results and never blanks to the empty state', async () => {
    const wrapped = withCalendars(makeControllableAuthFetch());
    const authFetch = wrapped.authFetch;
    currentAuthFetch = authFetch;

    const withOne = {
      ...EMPTY_REPORT,
      conflictCount: 1,
      conflicts: [
        {
          key: 'r1|2026-09-01|a|b',
          date: '2026-09-01',
          roomId: 'r1',
          roomName: 'Sanctuary',
          overlapStart: '2026-09-01T11:00:00',
          overlapEnd: '2026-09-01T12:00:00',
          sides: [
            { key: 'a', id: 'a', title: 'Alpha', startDateTime: '2026-09-01T10:00:00', endDateTime: '2026-09-01T12:00:00', status: 'published', requesterName: 'Ann', isOccurrence: false },
            { key: 'b', id: 'b', title: 'Beta', startDateTime: '2026-09-01T11:00:00', endDateTime: '2026-09-01T13:00:00', status: 'published', requesterName: 'Ben', isOccurrence: false },
          ],
        },
      ],
      groups: [
        {
          date: '2026-09-01',
          rooms: [{ roomId: 'r1', roomName: 'Sanctuary', conflicts: [] }],
        },
      ],
    };
    withOne.groups[0].rooms[0].conflicts = [withOne.conflicts[0]];

    render(<ConflictReport />, { wrapper: withQueryClient() });
    await waitFor(() => expect(findScanIdx(authFetch)).toBeGreaterThanOrEqual(0));

    await act(async () => {
      resolveScan(wrapped, withOne);
    });
    expect(await screen.findByText('Alpha')).toBeInTheDocument();

    // Trigger a re-scan; the previous result must stay on screen.
    await act(async () => {
      screen.getByTestId('conflict-report-rerun').click();
    });

    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByTestId('conflict-report-empty')).not.toBeInTheDocument();
  });
});
