// src/__tests__/unit/components/mobile/MobileRequests.test.jsx
//
// The requester's mobile Requests tab: status filtering, series-child
// exclusion, and the two distinct empty states.
//
// First-paint loading behaviour is covered separately in
// MobileRequests.firstPaint.test.jsx.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent, within } from '@testing-library/react';
import { makeControllableAuthFetch } from '../../../__helpers__/mockAuthFetch';
import { withQueryClient } from '../../../__helpers__/queryClientWrapper';

vi.mock('../../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));

vi.mock('../../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), log: vi.fn() },
}));

vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: 'token' }),
}));

vi.mock('../../../../context/SSEContext', () => ({
  useSSE: () => ({ isConnected: true }),
}));

vi.mock('../../../../utils/eventTransformers', () => ({
  transformEventsToFlatStructure: (events) => events,
  transformEventToFlatStructure: (event) => event,
}));

let lastDetailProps = null;
vi.mock('../../../../components/mobile/MobileEventDetail', () => ({
  default: (props) => {
    lastDetailProps = props;
    return props.event ? <div data-testid="detail-sheet">{props.event.eventTitle}</div> : null;
  },
}));

let currentAuthFetch = vi.fn();
vi.mock('../../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => currentAuthFetch,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findIdx(authFetch, predicate) {
  return authFetch.mock.calls.findIndex(([url]) => predicate(url));
}

const findListIdx = (authFetch) => findIdx(authFetch, (url) =>
  url.includes('/events/list?') && url.includes('view=my-events') && !url.includes('/counts'));

const findCountsIdx = (authFetch) => findIdx(authFetch, (url) =>
  url.includes('/events/list/counts') && url.includes('view=my-events'));

function makeRequest(overrides) {
  return {
    _id: overrides.eventId,
    id: overrides.eventId,
    eventType: 'singleInstance',
    startDate: '2026-08-04',
    startDateTime: '2026-08-04T14:00:00Z',
    categories: [],
    ...overrides,
  };
}

// One of each status, plus an exception child that must never surface.
const FIXTURES = [
  makeRequest({ eventId: 'e-pending', status: 'pending', eventTitle: 'Pending Request' }),
  makeRequest({ eventId: 'e-published', status: 'published', eventTitle: 'Published Request' }),
  makeRequest({ eventId: 'e-rejected', status: 'rejected', eventTitle: 'Rejected Request' }),
  makeRequest({ eventId: 'e-draft', status: 'draft', eventTitle: 'Draft Request' }),
  makeRequest({ eventId: 'e-deleted', status: 'deleted', eventTitle: 'Deleted Request' }),
  makeRequest({ eventId: 'e-exception', status: 'pending', eventType: 'exception', eventTitle: 'Exception Child' }),
  makeRequest({ eventId: 'e-addition', status: 'pending', eventType: 'addition', eventTitle: 'Addition Child' }),
];

const COUNTS = { all: 4, pending: 1, published: 1, rejected: 1, draft: 1, deleted: 1 };

/** Renders and resolves both queries with the given payloads. */
async function renderResolved({ events = FIXTURES, counts = COUNTS } = {}) {
  const { authFetch, resolveCall, resolveCallWith } = makeControllableAuthFetch();
  currentAuthFetch = authFetch;

  const result = render(<MobileRequests />, { wrapper: withQueryClient() });

  await waitFor(() => {
    expect(findListIdx(authFetch)).toBeGreaterThanOrEqual(0);
    expect(findCountsIdx(authFetch)).toBeGreaterThanOrEqual(0);
  });

  await act(async () => {
    resolveCallWith(findCountsIdx(authFetch), counts);
    resolveCall(findListIdx(authFetch), events);
  });

  await waitFor(() => {
    expect(screen.queryByTestId('mobile-requests-skeleton')).not.toBeInTheDocument();
  });

  return { ...result, authFetch };
}

/**
 * The status cell for a filter label. The count leads the accessible name
 * ("7 All"), so match the label anywhere rather than anchoring to the start.
 */
function statusTab(label) {
  return screen.getByRole('tab', { name: new RegExp(label) });
}

import MobileRequests from '../../../../components/mobile/MobileRequests';

describe('MobileRequests — status filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastDetailProps = null;
  });

  // MRQ-1: the default "All" view shows every live status but not deleted —
  // matching the counts endpoint, where `all` = pending+published+rejected+draft.
  it('MRQ-1: All shows every live status and excludes deleted', async () => {
    await renderResolved();

    expect(screen.getByText('Pending Request')).toBeInTheDocument();
    expect(screen.getByText('Published Request')).toBeInTheDocument();
    expect(screen.getByText('Rejected Request')).toBeInTheDocument();
    expect(screen.getByText('Draft Request')).toBeInTheDocument();
    expect(screen.queryByText('Deleted Request')).not.toBeInTheDocument();
  });

  // MRQ-2: selecting a filter narrows to exactly that status and marks the
  // status cell selected.
  it.each([
    ['Pending', 'Pending Request'],
    ['Published', 'Published Request'],
    ['Rejected', 'Rejected Request'],
    ['Draft', 'Draft Request'],
  ])('MRQ-2: %s narrows the list to %s', async (label, expectedTitle) => {
    await renderResolved();

    fireEvent.click(statusTab(label));

    expect(screen.getByText(expectedTitle)).toBeInTheDocument();
    expect(statusTab(label)).toHaveAttribute('aria-selected', 'true');

    // Every other fixture title is gone.
    ['Pending Request', 'Published Request', 'Rejected Request', 'Draft Request']
      .filter(t => t !== expectedTitle)
      .forEach(t => expect(screen.queryByText(t)).not.toBeInTheDocument());
  });

  // MRQ-3: exception / addition documents are per-occurrence overrides, not
  // separate requests. One card per series, never one per override.
  it('MRQ-3: exception and addition children never render as cards', async () => {
    await renderResolved();

    expect(screen.queryByText('Exception Child')).not.toBeInTheDocument();
    expect(screen.queryByText('Addition Child')).not.toBeInTheDocument();

    // ...and they stay hidden under a status filter that would otherwise match.
    fireEvent.click(statusTab('Pending'));
    expect(screen.queryByText('Exception Child')).not.toBeInTheDocument();
    expect(screen.queryByText('Addition Child')).not.toBeInTheDocument();
    expect(screen.getByText('Pending Request')).toBeInTheDocument();
  });

  // MRQ-4: counts come from the counts endpoint, not from the local list
  // length (which is filtered and paginated differently).
  it('MRQ-4: status cells display counts from the counts endpoint', async () => {
    await renderResolved({ counts: { ...COUNTS, all: 42, pending: 7 } });

    expect(within(statusTab('All')).getByText('42')).toBeInTheDocument();
    expect(within(statusTab('Pending')).getByText('7')).toBeInTheDocument();
  });

  // MRQ-9: a status with no requests recedes but stays selectable. Hiding
  // zero-count filters would fix the row's width more aggressively and break
  // the spec requirement that all five statuses be selectable.
  it('MRQ-9: a zero-count status is marked empty but still rendered and usable', async () => {
    await renderResolved({
      events: [makeRequest({ eventId: 'e-published', status: 'published', eventTitle: 'Published Request' })],
      counts: { ...COUNTS, all: 1, pending: 0, published: 1, rejected: 0, draft: 0 },
    });

    expect(statusTab('Pending')).toHaveClass('empty');
    expect(statusTab('Published')).not.toHaveClass('empty');

    // Still selectable — it just resolves to a no-match note.
    fireEvent.click(statusTab('Pending'));
    expect(statusTab('Pending')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/no pending requests/i)).toBeInTheDocument();
  });

  // MRQ-10: before counts resolve, every cell holds its line box so the row
  // does not reflow under the user's thumb mid-tap.
  it('MRQ-10: renders all five statuses before counts resolve', async () => {
    const { authFetch, resolveCall } = makeControllableAuthFetch();
    currentAuthFetch = authFetch;

    render(<MobileRequests />, { wrapper: withQueryClient() });

    await waitFor(() => {
      expect(findListIdx(authFetch)).toBeGreaterThanOrEqual(0);
    });

    // Resolve only the list; counts stay in flight.
    await act(async () => {
      resolveCall(findListIdx(authFetch), []);
    });

    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(statusTab('Rejected')).toBeInTheDocument();
    // No count yet, so nothing is marked empty on missing data.
    expect(statusTab('Rejected')).not.toHaveClass('empty');
  });

  // MRQ-5: tapping a card opens the detail sheet for that request.
  it('MRQ-5: tapping a card opens the detail sheet', async () => {
    await renderResolved();

    fireEvent.click(screen.getByText('Pending Request'));

    await waitFor(() => {
      expect(screen.getByTestId('detail-sheet')).toBeInTheDocument();
    });
    expect(lastDetailProps.event.eventId).toBe('e-pending');
    // Reservation context is what distinguishes this entry point from the
    // agenda's read-only sheet.
    expect(lastDetailProps.showReservationContext).toBe(true);
  });
});

describe('MobileRequests — empty states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // MRQ-6: a genuinely empty account gets the recovery affordance required of
  // every list view (CLAUDE.md: "list-view empty states MUST render
  // EmptyStateRefreshButton").
  it('MRQ-6: resolved-empty renders the empty state with a refresh button', async () => {
    await renderResolved({ events: [], counts: { ...COUNTS, all: 0 } });

    expect(screen.getByText('No requests yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh data/i })).toBeInTheDocument();
  });

  // MRQ-7: the refresh button re-runs both queries.
  it('MRQ-7: the empty-state refresh button refetches list and counts', async () => {
    const { authFetch } = await renderResolved({ events: [], counts: { ...COUNTS, all: 0 } });
    const callsBefore = authFetch.mock.calls.length;

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /refresh data/i }));
    });

    await waitFor(() => {
      expect(authFetch.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  // MRQ-8: a filter matching nothing is not a failure — it gets a plain note,
  // not the "something went wrong, try refreshing" affordance.
  it('MRQ-8: a filter with no matches shows a note, not the refresh CTA', async () => {
    await renderResolved({
      events: [makeRequest({ eventId: 'e-pending', status: 'pending', eventTitle: 'Pending Request' })],
    });

    fireEvent.click(statusTab('Rejected'));

    expect(screen.getByText(/no rejected requests/i)).toBeInTheDocument();
    expect(screen.queryByText('No requests yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refresh data/i })).not.toBeInTheDocument();
  });
});
