// src/__tests__/unit/components/ConflictReport.test.jsx
//
// Presentation and drill-in for the room conflict report.
//
// The load-bearing cases are the ones where the view could lie: a degraded or
// truncated scan must never read as a complete one, and a failed request must
// never read as a clean calendar.
//
// Test IDs: CRV-1 to CRV-14

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor, within } from '@testing-library/react';
import { withQueryClient } from '../../__helpers__/queryClientWrapper';

vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));

vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: 'token', user: { name: 'Test Approver', email: 'a@test.com' } }),
}));

const showError = vi.fn();
vi.mock('../../../context/NotificationContext', () => ({
  useNotification: () => ({ showSuccess: vi.fn(), showWarning: vi.fn(), showError }),
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

vi.mock('../../../components/shared/LoadingSpinner', () => ({
  default: () => <div data-testid="loading-spinner" />,
}));

// A probe for the shared review experience: records what the report passes it
// so CRV-11..14 can assert the contract without rendering the real modal tree.
const experienceProbe = { props: null };
vi.mock('../../../components/shared/EventReviewExperience', () => ({
  default: (props) => {
    experienceProbe.props = props;
    return props.experience?.isOpen ? <div data-testid="review-experience" /> : null;
  },
}));

const navigateToEvent = vi.fn();
const closeModal = vi.fn();
let experienceIsOpen = false;
vi.mock('../../../hooks/useEventReviewExperience', () => ({
  useEventReviewExperience: (opts) => {
    // Capture the caller's onRefresh so CRV-14 can fire it.
    experienceProbe.hookOptions = opts;
    return {
      get isOpen() { return experienceIsOpen; },
      currentItem: null,
      editableData: null,
      navigateToEvent,
      closeModal,
    };
  },
}));

let currentAuthFetch = vi.fn();
vi.mock('../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => currentAuthFetch,
}));

import ConflictReport from '../../../components/ConflictReport';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function side(overrides = {}) {
  return {
    key: 'a:-',
    id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    title: 'Alpha',
    status: 'published',
    startDateTime: '2026-09-01T10:00:00',
    endDateTime: '2026-09-01T12:00:00',
    effectiveStart: '2026-09-01T10:00:00',
    effectiveEnd: '2026-09-01T12:00:00',
    requesterName: 'Ann Requester',
    isOccurrence: false,
    occurrenceDate: null,
    ...overrides,
  };
}

function conflict(overrides = {}) {
  return {
    key: 'r1|2026-09-01|a|b',
    date: '2026-09-01',
    roomId: 'r1',
    roomName: 'Sanctuary',
    overlapStart: '2026-09-01T11:00:00',
    overlapEnd: '2026-09-01T12:00:00',
    sides: [
      side(),
      side({ key: 'b:-', id: 'bbbbbbbbbbbbbbbbbbbbbbbb', title: 'Beta', requesterName: 'Ben Requester' }),
    ],
    ...overrides,
  };
}

function report(overrides = {}) {
  const conflicts = overrides.conflicts || [];
  const groups = [];
  for (const c of conflicts) {
    let dg = groups[groups.length - 1];
    if (!dg || dg.date !== c.date) { dg = { date: c.date, rooms: [] }; groups.push(dg); }
    let rg = dg.rooms[dg.rooms.length - 1];
    if (!rg || rg.roomId !== c.roomId) { rg = { roomId: c.roomId, roomName: c.roomName, conflicts: [] }; dg.rooms.push(rg); }
    rg.conflicts.push(c);
  }
  return {
    window: { startDate: '2026-08-05', endDate: '2026-11-03', days: 90 },
    calendarOwner: null,
    generatedAt: '2026-08-05T12:00:00.000Z',
    conflictCount: conflicts.length,
    groups,
    degraded: [],
    truncated: false,
    ...overrides,
    conflicts,
  };
}

/** Mount and settle with the given response body (or rejection). */
async function renderWith(body, { ok = true } = {}) {
  currentAuthFetch = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  });
  const result = render(<ConflictReport />, { wrapper: withQueryClient() });
  await waitFor(() => expect(currentAuthFetch).toHaveBeenCalled());
  await act(async () => {});
  return result;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ConflictReport — presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    experienceIsOpen = false;
    experienceProbe.props = null;
  });

  it('CRV-1: conflicts render grouped by date and then by room', async () => {
    await renderWith(
      report({
        conflicts: [
          conflict({ key: 'k1', date: '2026-09-01', roomId: 'r2', roomName: 'Chapel' }),
          conflict({ key: 'k2', date: '2026-09-01', roomId: 'r1', roomName: 'Sanctuary' }),
          conflict({ key: 'k3', date: '2026-09-05', roomId: 'r1', roomName: 'Sanctuary' }),
        ],
      })
    );

    const dateGroups = await screen.findAllByTestId('conflict-date-group');
    expect(dateGroups).toHaveLength(2);
    expect(dateGroups[0]).toHaveTextContent('2026-09-01');
    expect(dateGroups[1]).toHaveTextContent('2026-09-05');

    const roomsInFirstDate = within(dateGroups[0]).getAllByTestId('conflict-room-group');
    expect(roomsInFirstDate).toHaveLength(2);
    expect(roomsInFirstDate[0]).toHaveTextContent('Chapel');
    expect(roomsInFirstDate[1]).toHaveTextContent('Sanctuary');
  });

  it('CRV-2: each conflict leads with the contested interval, with each side\'s own times alongside', async () => {
    await renderWith({ ...report({ conflicts: [conflict()] }) });

    const row = await screen.findByTestId('conflict-row');
    // The contested interval is what makes the row defensible: with buffers in
    // play the two visible spans can look perfectly fine to an approver.
    expect(within(row).getByTestId('contested-interval')).toHaveTextContent('11:00');
    expect(within(row).getByTestId('contested-interval')).toHaveTextContent('12:00');

    const sides = within(row).getAllByTestId('conflict-side');
    expect(sides).toHaveLength(2);
    expect(sides[0]).toHaveTextContent('Alpha');
    expect(sides[0]).toHaveTextContent('10:00');
    expect(sides[1]).toHaveTextContent('Beta');
  });

  it('CRV-3: a side with no requester is labelled synced from Outlook, not left blank', async () => {
    await renderWith(
      report({
        conflicts: [
          conflict({
            sides: [side(), side({ key: 'b:-', id: 'b', title: 'Beta', requesterName: null })],
          }),
        ],
      })
    );

    const sides = await screen.findAllByTestId('conflict-side');
    expect(sides[0]).toHaveTextContent('Ann Requester');
    expect(sides[1]).toHaveTextContent(/synced from outlook/i);
  });

  it('CRV-4: a recurring side is identified as an occurrence of its series', async () => {
    await renderWith(
      report({
        conflicts: [
          conflict({
            sides: [
              side(),
              side({ key: 'b:2026-09-01', id: 'b', title: 'Weekly Class', isOccurrence: true, occurrenceDate: '2026-09-01' }),
            ],
          }),
        ],
      })
    );

    const sides = await screen.findAllByTestId('conflict-side');
    expect(sides[1]).toHaveTextContent(/occurrence/i);
    expect(within(sides[0]).queryByText(/occurrence/i)).not.toBeInTheDocument();
  });

  it('CRV-5: a clean calendar reads as success and offers a refresh', async () => {
    await renderWith(report({ conflicts: [] }));

    const empty = await screen.findByTestId('conflict-report-empty');
    expect(empty).toHaveTextContent(/no room conflicts/i);
    expect(within(empty).getByRole('button', { name: /re-run scan/i })).toBeInTheDocument();
  });

  it('CRV-6: a degraded response banners incompleteness above the list', async () => {
    await renderWith(
      report({
        conflicts: [conflict()],
        degraded: [{ stage: 'seriesMasters', message: 'read failed' }],
      })
    );

    const banner = await screen.findByTestId('conflict-report-degraded');
    expect(banner).toHaveTextContent(/incomplete/i);
    expect(banner).toHaveTextContent('seriesMasters');
  });

  it('CRV-7: a degraded response with NO conflicts still banners rather than reading as clean', async () => {
    // The worst outcome this whole view can produce: an approver leaves
    // believing the calendar is clean when the scan simply could not read it.
    await renderWith(
      report({ conflicts: [], degraded: [{ stage: 'events', message: 'read failed' }] })
    );

    expect(await screen.findByTestId('conflict-report-degraded')).toBeInTheDocument();
    const empty = screen.queryByTestId('conflict-report-empty');
    if (empty) expect(empty).not.toHaveTextContent(/no room conflicts were found/i);
  });

  it('CRV-8: a truncated response banners truncation', async () => {
    await renderWith(report({ conflicts: [conflict()], truncated: true }));

    const banner = await screen.findByTestId('conflict-report-truncated');
    expect(banner).toHaveTextContent(/not all/i);
  });

  it('CRV-9: a failed request renders an error with retry and never an empty state', async () => {
    currentAuthFetch = vi.fn().mockRejectedValue(new Error('network down'));
    render(<ConflictReport />, { wrapper: withQueryClient() });

    const error = await screen.findByTestId('conflict-report-error');
    expect(error).toBeInTheDocument();
    expect(screen.queryByTestId('conflict-report-empty')).not.toBeInTheDocument();
    expect(within(error).getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('CRV-10: the header shows the window control and the generated-at stamp', async () => {
    await renderWith(report({ conflicts: [] }));

    const windowSelect = await screen.findByTestId('conflict-report-window');
    expect(windowSelect).toHaveValue('90');
    expect(screen.getByTestId('conflict-report-generated-at')).toBeInTheDocument();
  });

  it('CRV-11: changing the window re-scans with the new value', async () => {
    const authFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => report({ conflicts: [] }),
    });
    currentAuthFetch = authFetch;

    render(<ConflictReport />, { wrapper: withQueryClient() });
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    await act(async () => {});

    const select = screen.getByTestId('conflict-report-window');
    await act(async () => {
      select.value = '365';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await waitFor(() => {
      expect(authFetch.mock.calls.some(([url]) => url.includes('days=365'))).toBe(true);
    });
  });
});

describe('ConflictReport — drill-in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    experienceIsOpen = false;
    experienceProbe.props = null;
  });

  it('CRV-12: selecting a side opens it through the shared review experience', async () => {
    await renderWith(report({ conflicts: [conflict()] }));

    const sides = await screen.findAllByTestId('conflict-side');
    await act(async () => {
      within(sides[1]).getByRole('button', { name: /open/i }).click();
    });

    // Resolution goes through navigateToEvent, which already carries the
    // /room-reservations -> /events 404 fallback. That fallback is MANDATORY
    // here: Outlook-synced sides carry no roomReservationData at all.
    expect(navigateToEvent).toHaveBeenCalledWith('bbbbbbbbbbbbbbbbbbbbbbbb');
  });

  it('CRV-13: a side with no reservation data is opened the same way', async () => {
    await renderWith(
      report({
        conflicts: [
          conflict({
            sides: [side(), side({ key: 'b:-', id: 'outlookid00000000000000x', title: 'Beta', requesterName: null })],
          }),
        ],
      })
    );

    const sides = await screen.findAllByTestId('conflict-side');
    await act(async () => {
      within(sides[1]).getByRole('button', { name: /open/i }).click();
    });

    expect(navigateToEvent).toHaveBeenCalledWith('outlookid00000000000000x');
  });

  it('CRV-14: the report stays mounted beneath the modal', async () => {
    experienceIsOpen = true;
    await renderWith(report({ conflicts: [conflict()] }));

    expect(await screen.findByTestId('review-experience')).toBeInTheDocument();
    // The list is still in the tree — not unmounted and re-created on close,
    // which is what preserves scroll position.
    expect(screen.getByTestId('conflict-row')).toBeInTheDocument();
  });

  it('CRV-15: the report passes raw permissions and caller props, deriving no gates itself', async () => {
    await renderWith(report({ conflicts: [conflict()] }));

    // Per the EventReviewExperience contract, derived flags like
    // effectiveCanDelete are the component's job, not the caller's.
    expect(experienceProbe.props).toBeTruthy();
    expect(experienceProbe.props.effectiveCanDelete).toBeUndefined();
    expect(experienceProbe.props.effectiveReadOnly).toBeUndefined();
    expect(experienceProbe.props.experience).toBeTruthy();
  });

  it('CRV-16: a change reported by the modal refetches the report', async () => {
    const authFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => report({ conflicts: [conflict()] }),
    });
    currentAuthFetch = authFetch;

    render(<ConflictReport />, { wrapper: withQueryClient() });
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    await act(async () => {});

    const callsBefore = authFetch.mock.calls.length;

    // The hook's onRefresh is what the modal fires after a save or delete.
    await act(async () => {
      experienceProbe.hookOptions.onRefresh?.();
    });

    await waitFor(() => {
      expect(authFetch.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});
