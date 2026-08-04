// RecurringConflictSummary — per-occurrence conflict panel for recurring
// events. These tests lock the fetch-stability hardening (signature-keyed
// effect instead of callback identity) and the calendarOwner request scoping
// that the recurring-publish-conflict-blocking change requires before the
// component's first live mount.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));

import RecurringConflictSummary from '../../../components/RecurringConflictSummary';

const RECURRENCE = {
  pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
  range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-05-26' },
  exclusions: [],
  additions: [],
};

const CONFLICT_RESPONSE = {
  totalOccurrences: 12,
  conflictingOccurrences: 2,
  cleanOccurrences: 10,
  conflicts: [
    {
      occurrenceDate: '2026-03-17',
      occurrenceStart: '2026-03-17T14:00:00',
      occurrenceEnd: '2026-03-17T15:00:00',
      hardConflicts: [{
        id: 'c1',
        eventTitle: 'Existing Meeting',
        startDateTime: '2026-03-17T14:00:00',
        endDateTime: '2026-03-17T15:00:00',
        roomNames: ['Chapel'],
        status: 'published',
      }],
      softConflicts: [],
    },
    {
      occurrenceDate: '2026-03-24',
      occurrenceStart: '2026-03-24T14:00:00',
      occurrenceEnd: '2026-03-24T15:00:00',
      hardConflicts: [{
        id: 'c2',
        eventTitle: 'Other Meeting',
        startDateTime: '2026-03-24T14:00:00',
        endDateTime: '2026-03-24T15:00:00',
        roomNames: ['Chapel'],
        status: 'published',
      }],
      softConflicts: [],
    },
  ],
  allOccurrences: [],
};

const mockConflictFetch = (payload = CONFLICT_RESPONSE) => {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => payload }));
  return global.fetch;
};

// Fresh object/array references with identical content — the exact parent
// behavior that made the callback-identity effect refetch forever.
const freshProps = (overrides = {}) => ({
  recurrence: { ...RECURRENCE, pattern: { ...RECURRENCE.pattern }, range: { ...RECURRENCE.range } },
  roomIds: ['room-1'],
  startDateTime: '2026-03-10T14:00:00',
  endDateTime: '2026-03-10T15:00:00',
  apiToken: 'tok',
  categories: ['Meeting'],
  calendarOwner: 'templeeventssandbox@emanuelnyc.org',
  readOnly: true,
  ...overrides,
});

describe('RecurringConflictSummary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('RCS-1: fetches exactly once in readOnly mode across parent re-renders with fresh references', async () => {
    const fetchSpy = mockConflictFetch();
    const { rerender } = render(<RecurringConflictSummary {...freshProps()} />);

    await screen.findByText(/of 12 occurrences have room conflicts/);

    // Re-render repeatedly with content-equal but reference-fresh props
    rerender(<RecurringConflictSummary {...freshProps()} />);
    rerender(<RecurringConflictSummary {...freshProps()} />);
    rerender(<RecurringConflictSummary {...freshProps()} />);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });

  it('RCS-2: a changed request signature (different room) does trigger a refetch', async () => {
    const fetchSpy = mockConflictFetch();
    const { rerender } = render(<RecurringConflictSummary {...freshProps()} />);
    await screen.findByText(/of 12 occurrences have room conflicts/);

    rerender(<RecurringConflictSummary {...freshProps({ roomIds: ['room-2'] })} />);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });

  it('RCS-3: includes calendarOwner in the request body', async () => {
    const fetchSpy = mockConflictFetch();
    render(<RecurringConflictSummary {...freshProps()} />);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.calendarOwner).toBe('templeeventssandbox@emanuelnyc.org');
    expect(body.roomIds).toEqual(['room-1']);
    expect(body.recurrence.pattern.type).toBe('weekly');
  });

  it('RCS-4: renders the warning header with conflict counts from the response', async () => {
    mockConflictFetch();
    render(<RecurringConflictSummary {...freshProps()} />);

    const header = await screen.findByText(/of 12 occurrences have room conflicts/);
    expect(header.querySelector('strong')).toHaveTextContent('2');
  });

  it('RCS-5: form-mode debounce is not reset by reference-fresh re-renders', async () => {
    vi.useFakeTimers();
    const fetchSpy = mockConflictFetch();
    const { rerender } = render(<RecurringConflictSummary {...freshProps({ readOnly: false })} />);

    // Half-way through the 1200ms debounce, re-render with fresh references.
    // The old callback-identity effect would restart the timer here.
    act(() => { vi.advanceTimersByTime(600); });
    rerender(<RecurringConflictSummary {...freshProps({ readOnly: false })} />);
    act(() => { vi.advanceTimersByTime(700); });

    // 1300ms after mount: the single debounced fetch must have fired
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // ─── Conflict-resolution workflow: strip, drawer, actions ──────────────
  // The panel is a resolution surface now, not an advisory banner. One square
  // per occurrence, a single inline drawer for per-date detail, and two ways
  // out of a conflict (open the blocker, skip the date).

  const OCC_DATES = [
    '2026-03-10', '2026-03-17', '2026-03-24', '2026-03-31',
    '2026-04-07', '2026-04-14', '2026-04-21', '2026-04-28',
    '2026-05-05', '2026-05-12', '2026-05-19', '2026-05-26',
  ];
  const allOccurrencesFor = (dates) => dates.map(d => ({
    occurrenceDate: d,
    startDateTime: `${d}T14:00:00`,
    endDateTime: `${d}T15:00:00`,
  }));

  const RESOLUTION_RESPONSE = {
    totalOccurrences: 12,
    conflictingOccurrences: 2,
    cleanOccurrences: 10,
    conflicts: [
      {
        occurrenceDate: '2026-03-17',
        occurrenceStart: '2026-03-17T14:00:00',
        occurrenceEnd: '2026-03-17T15:00:00',
        hardConflicts: [{
          id: 'c1',
          eventTitle: 'Existing Meeting',
          startDateTime: '2026-03-17T14:00:00',
          endDateTime: '2026-03-17T15:00:00',
          roomNames: ['Chapel'],
          status: 'published',
          requestedBy: 'Alice Levine',
        }],
        softConflicts: [],
      },
      {
        occurrenceDate: '2026-03-24',
        occurrenceStart: '2026-03-24T14:00:00',
        occurrenceEnd: '2026-03-24T15:00:00',
        hardConflicts: [
          {
            id: 'c2',
            eventTitle: 'Other Meeting',
            startDateTime: '2026-03-24T14:00:00',
            endDateTime: '2026-03-24T15:00:00',
            roomNames: ['Chapel'],
            status: 'published',
            requestedBy: 'Bob Marcus',
          },
          {
            id: 'c3',
            eventTitle: 'Outlook Sync Item',
            startDateTime: '2026-03-24T14:30:00',
            endDateTime: '2026-03-24T15:30:00',
            roomNames: ['Chapel'],
            status: 'published',
            requestedBy: null,
          },
        ],
        softConflicts: [],
      },
    ],
    allOccurrences: allOccurrencesFor(OCC_DATES),
  };

  const CLEAR_RESPONSE = {
    totalOccurrences: 12,
    conflictingOccurrences: 0,
    cleanOccurrences: 12,
    conflicts: [],
    allOccurrences: allOccurrencesFor(OCC_DATES),
  };

  const stripSquares = (container) =>
    Array.from(container.querySelectorAll('.rcs-strip-square'));

  describe('occurrence strip', () => {
    it('ST-1: renders one element per occurrence in series order', async () => {
      mockConflictFetch(RESOLUTION_RESPONSE);
      const { container } = render(<RecurringConflictSummary {...freshProps()} />);
      await screen.findByText(/of 12 occurrences have room conflicts/);

      const squares = stripSquares(container);
      expect(squares).toHaveLength(12);
      expect(squares.map(s => s.getAttribute('data-date'))).toEqual(OCC_DATES);
    });

    it('ST-2: conflicted, clear, and skipped states are distinguishable, and skips read as unsaved', async () => {
      mockConflictFetch(RESOLUTION_RESPONSE);
      render(
        <RecurringConflictSummary
          {...freshProps({ pendingSkippedDates: ['2026-03-31'] })}
        />
      );
      await screen.findByText(/of 12 occurrences have room conflicts/);

      expect(screen.getByTestId('rcs-square-2026-03-17').getAttribute('data-state')).toBe('conflicted');
      expect(screen.getByTestId('rcs-square-2026-03-10').getAttribute('data-state')).toBe('clear');
      expect(screen.getByTestId('rcs-square-2026-03-31').getAttribute('data-state')).toBe('skipped');
      expect(screen.getByText(/not saved/i)).toBeTruthy();
    });

    it('ST-3: the blocked verdict and counts render without expanding anything', async () => {
      mockConflictFetch(RESOLUTION_RESPONSE);
      render(<RecurringConflictSummary {...freshProps()} />);

      const header = await screen.findByText(/of 12 occurrences have room conflicts/);
      expect(header.querySelector('strong')).toHaveTextContent('2');
      expect(screen.getByText(/publishing is blocked/i)).toBeTruthy();
    });

    it('ST-4: a clear series renders the quiet state', async () => {
      mockConflictFetch(CLEAR_RESPONSE);
      render(<RecurringConflictSummary {...freshProps()} />);

      await screen.findByText(/All 12 occurrences are clear/);
      expect(screen.queryByText(/blocked/i)).toBeNull();
    });
  });

  describe('resolution drawer', () => {
    const renderResolved = async (extraProps = {}) => {
      mockConflictFetch(RESOLUTION_RESPONSE);
      const utils = render(<RecurringConflictSummary {...freshProps(extraProps)} />);
      await screen.findByText(/of 12 occurrences have room conflicts/);
      return utils;
    };

    it('DR-1: opens from a strip square with full per-event detail', async () => {
      await renderResolved();
      fireEvent.click(screen.getByTestId('rcs-square-2026-03-17'));

      const drawer = screen.getByTestId('rcs-drawer-2026-03-17');
      expect(drawer).toHaveTextContent('Existing Meeting');
      expect(drawer).toHaveTextContent('published');
      expect(drawer).toHaveTextContent('Chapel');
      expect(drawer).toHaveTextContent('Alice Levine');
    });

    it('DR-2: opens from a conflict list row', async () => {
      await renderResolved();
      fireEvent.click(screen.getByTestId('rcs-conflict-row-2026-03-24'));

      expect(screen.getByTestId('rcs-drawer-2026-03-24')).toBeTruthy();
    });

    it('DR-3: only one drawer is open at a time', async () => {
      await renderResolved();
      fireEvent.click(screen.getByTestId('rcs-square-2026-03-17'));
      expect(screen.getByTestId('rcs-drawer-2026-03-17')).toBeTruthy();

      fireEvent.click(screen.getByTestId('rcs-square-2026-03-24'));
      expect(screen.queryByTestId('rcs-drawer-2026-03-17')).toBeNull();
      expect(screen.getByTestId('rcs-drawer-2026-03-24')).toBeTruthy();
    });

    it('DR-4: clear occurrences are inert', async () => {
      await renderResolved();
      fireEvent.click(screen.getByTestId('rcs-square-2026-03-10'));

      expect(screen.queryByTestId('rcs-drawer-2026-03-10')).toBeNull();
    });

    it('DR-5: a date with two blocking events lists both, each with its own open action', async () => {
      const onOpenBlockingEvent = vi.fn();
      await renderResolved({ onOpenBlockingEvent });
      fireEvent.click(screen.getByTestId('rcs-square-2026-03-24'));

      const drawer = screen.getByTestId('rcs-drawer-2026-03-24');
      expect(drawer).toHaveTextContent('Other Meeting');
      expect(drawer).toHaveTextContent('Outlook Sync Item');
      expect(screen.getByTestId('rcs-open-c2')).toBeTruthy();
      expect(screen.getByTestId('rcs-open-c3')).toBeTruthy();
    });

    it('DR-6: a null requester is identified as synced from Outlook', async () => {
      await renderResolved();
      fireEvent.click(screen.getByTestId('rcs-square-2026-03-24'));

      const drawer = screen.getByTestId('rcs-drawer-2026-03-24');
      expect(drawer).toHaveTextContent('Bob Marcus');
      expect(drawer).toHaveTextContent(/synced from Outlook/i);
    });
  });

  describe('strip degradation (design D9)', () => {
    const longSeries = (count) => {
      const dates = [];
      const d = new Date('2026-01-06T12:00:00');
      for (let i = 0; i < count; i++) {
        dates.push(d.toISOString().split('T')[0]);
        d.setDate(d.getDate() + 7);
      }
      return dates;
    };

    it('DG-1: squares shrink one step above 60 occurrences', async () => {
      const dates = longSeries(61);
      mockConflictFetch({
        totalOccurrences: 61, conflictingOccurrences: 0, cleanOccurrences: 61,
        conflicts: [], allOccurrences: allOccurrencesFor(dates),
      });
      const { container } = render(<RecurringConflictSummary {...freshProps()} />);
      await screen.findByText(/All 61 occurrences are clear/);

      expect(container.querySelector('.rcs-strip').className).toContain('dense');
    });

    it('DG-2: above 150 occurrences the strip gives way to a compact summary, the list remains', async () => {
      const dates = longSeries(151);
      const conflictDate = dates[3];
      mockConflictFetch({
        totalOccurrences: 151, conflictingOccurrences: 1, cleanOccurrences: 150,
        conflicts: [{
          occurrenceDate: conflictDate,
          occurrenceStart: `${conflictDate}T14:00:00`,
          occurrenceEnd: `${conflictDate}T15:00:00`,
          hardConflicts: [{
            id: 'c9', eventTitle: 'Long Series Blocker',
            startDateTime: `${conflictDate}T14:00:00`, endDateTime: `${conflictDate}T15:00:00`,
            roomNames: ['Chapel'], status: 'published', requestedBy: 'Alice Levine',
          }],
          softConflicts: [],
        }],
        allOccurrences: allOccurrencesFor(dates),
      });
      const { container } = render(<RecurringConflictSummary {...freshProps()} />);
      await screen.findByText(/of 151 occurrences have room conflicts/);

      expect(container.querySelector('.rcs-strip')).toBeNull();
      expect(screen.getByTestId('rcs-compact-summary')).toBeTruthy();
      expect(screen.getByTestId(`rcs-conflict-row-${conflictDate}`)).toBeTruthy();
    });
  });

  describe('resolution actions', () => {
    const renderWithActions = async (extraProps = {}) => {
      mockConflictFetch(RESOLUTION_RESPONSE);
      const utils = render(<RecurringConflictSummary {...freshProps(extraProps)} />);
      await screen.findByText(/of 12 occurrences have room conflicts/);
      return utils;
    };

    it('AC-1: the open action passes the conflict record and the occurrence context', async () => {
      const onOpenBlockingEvent = vi.fn();
      await renderWithActions({ onOpenBlockingEvent });
      fireEvent.click(screen.getByTestId('rcs-square-2026-03-17'));
      fireEvent.click(screen.getByTestId('rcs-open-c1'));

      expect(onOpenBlockingEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1', eventTitle: 'Existing Meeting' }),
        { occurrenceDate: '2026-03-17', outstandingConflictCount: 2 }
      );
    });

    it('AC-2: skip calls the handler with the occurrence date', async () => {
      const onSkipOccurrence = vi.fn();
      await renderWithActions({ onSkipOccurrence });
      fireEvent.click(screen.getByTestId('rcs-square-2026-03-17'));
      fireEvent.click(screen.getByTestId('rcs-skip-2026-03-17'));

      expect(onSkipOccurrence).toHaveBeenCalledWith('2026-03-17');
    });

    it('AC-3: skip is absent without a handler (disabled fields); navigation remains', async () => {
      const onOpenBlockingEvent = vi.fn();
      await renderWithActions({ onOpenBlockingEvent, onSkipOccurrence: null });
      fireEvent.click(screen.getByTestId('rcs-square-2026-03-17'));

      expect(screen.queryByTestId('rcs-skip-2026-03-17')).toBeNull();
      expect(screen.getByTestId('rcs-open-c1')).toBeTruthy();
    });

    it('AC-5: a recurrence change (exclusion added) re-runs the conflict check with no explicit refetch', async () => {
      const fetchSpy = mockConflictFetch(RESOLUTION_RESPONSE);
      const { rerender } = render(<RecurringConflictSummary {...freshProps()} />);
      await screen.findByText(/of 12 occurrences have room conflicts/);

      // The skip handler only mutates form state; the changed recurrence prop
      // (part of the fetch signature) is the sole re-check trigger.
      rerender(
        <RecurringConflictSummary
          {...freshProps({ recurrence: { ...RECURRENCE, exclusions: ['2026-03-17'] } })}
        />
      );

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    });

    it('AC-4: the last remaining occurrence cannot be skipped and says why', async () => {
      const onSkipOccurrence = vi.fn();
      mockConflictFetch({
        totalOccurrences: 1, conflictingOccurrences: 1, cleanOccurrences: 0,
        conflicts: [RESOLUTION_RESPONSE.conflicts[0]],
        allOccurrences: allOccurrencesFor(['2026-03-17']),
      });
      render(<RecurringConflictSummary {...freshProps({ onSkipOccurrence })} />);
      await screen.findByText(/of 1 occurrence/);
      fireEvent.click(screen.getByTestId('rcs-square-2026-03-17'));

      expect(screen.queryByTestId('rcs-skip-2026-03-17')).toBeNull();
      expect(screen.getByText(/only remaining occurrence/i)).toBeTruthy();
      expect(onSkipOccurrence).not.toHaveBeenCalled();
    });
  });
});
