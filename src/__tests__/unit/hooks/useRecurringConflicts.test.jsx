// useRecurringConflicts — fetch machinery extracted from the retired
// RecurringConflictSummary component (scheduling-assistant-series-mode).
// RCH-1..5 migrate the fetch-stability locks (RCS-1/2/3/5 plus the
// incomplete-inputs guard) verbatim onto the hook: signature-keyed effect
// instead of callback identity, calendarOwner scoping, readOnly single-shot
// vs 1200ms form-mode debounce, abort of superseded requests.
// RCH-6..10 cover the hook's new occurrence model: the merged chip list
// (server expansion ∪ exclusion dates), the pending flag, and the
// last-known-blockers session memory that lets a skipped date warn before
// restore.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));

import { useRecurringConflicts } from '../../../hooks/useRecurringConflicts';

const RECURRENCE = {
  pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
  range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-05-26' },
  exclusions: [],
  additions: [],
};

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

const HARD_C1 = {
  id: 'c1',
  eventTitle: 'Existing Meeting',
  startDateTime: '2026-03-17T14:00:00',
  endDateTime: '2026-03-17T15:00:00',
  roomNames: ['Chapel'],
  status: 'published',
  requestedBy: 'Alice Levine',
};

const RESPONSE = {
  totalOccurrences: 12,
  conflictingOccurrences: 2,
  cleanOccurrences: 10,
  conflicts: [
    {
      occurrenceDate: '2026-03-17',
      occurrenceStart: '2026-03-17T14:00:00',
      occurrenceEnd: '2026-03-17T15:00:00',
      hardConflicts: [HARD_C1],
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
        requestedBy: null,
      }],
      softConflicts: [],
    },
  ],
  allOccurrences: allOccurrencesFor(OCC_DATES),
};

const mockConflictFetch = (payload = RESPONSE) => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => payload }));
  return globalThis.fetch;
};

// Fresh object/array references with identical content — the parent behavior
// that made a callback-identity effect refetch forever.
const freshInputs = (overrides = {}) => ({
  recurrence: { ...RECURRENCE, pattern: { ...RECURRENCE.pattern }, range: { ...RECURRENCE.range } },
  roomIds: ['room-1'],
  startDateTime: '2026-03-10T14:00:00',
  endDateTime: '2026-03-10T15:00:00',
  apiToken: 'tok',
  categories: ['Meeting'],
  calendarOwner: 'templeeventssandbox@emanuelnyc.org',
  readOnly: true,
  pendingSkippedDates: [],
  ...overrides,
});

const renderConflicts = (initialInputs) =>
  renderHook((inputs) => useRecurringConflicts(inputs), { initialProps: initialInputs });

describe('useRecurringConflicts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ─── Fetch machinery (migrated locks) ──────────────────────────────────

  it('RCH-1: fetches exactly once in readOnly mode across re-renders with fresh references', async () => {
    const fetchSpy = mockConflictFetch();
    const { result, rerender } = renderConflicts(freshInputs());

    await waitFor(() => expect(result.current.data).not.toBeNull());

    rerender(freshInputs());
    rerender(freshInputs());
    rerender(freshInputs());

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });

  it('RCH-2: a changed request signature (different room) triggers a refetch', async () => {
    const fetchSpy = mockConflictFetch();
    const { result, rerender } = renderConflicts(freshInputs());
    await waitFor(() => expect(result.current.data).not.toBeNull());

    rerender(freshInputs({ roomIds: ['room-2'] }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });

  it('RCH-3: includes calendarOwner and the recurrence in the request body', async () => {
    const fetchSpy = mockConflictFetch();
    const { result } = renderConflicts(freshInputs());

    await waitFor(() => expect(result.current.data).not.toBeNull());
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.calendarOwner).toBe('templeeventssandbox@emanuelnyc.org');
    expect(body.roomIds).toEqual(['room-1']);
    expect(body.recurrence.pattern.type).toBe('weekly');
  });

  it('RCH-4: form-mode debounce (1200ms) is not reset by reference-fresh re-renders', async () => {
    vi.useFakeTimers();
    const fetchSpy = mockConflictFetch();
    const { rerender } = renderConflicts(freshInputs({ readOnly: false }));

    act(() => { vi.advanceTimersByTime(600); });
    rerender(freshInputs({ readOnly: false }));
    act(() => { vi.advanceTimersByTime(700); });

    // 1300ms after mount: exactly the single debounced fetch has fired
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('RCH-5: incomplete inputs (no rooms) yield null data and no request', async () => {
    const fetchSpy = mockConflictFetch();
    const { result } = renderConflicts(freshInputs({ roomIds: [] }));

    // Give any wrongly-scheduled fetch a chance to fire
    await act(async () => { await Promise.resolve(); });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.occurrences).toEqual([]);
  });

  it('RCH-6: a server error surfaces as error, and retry refetches', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
      .mockResolvedValue({ ok: true, json: async () => RESPONSE });

    const { result } = renderConflicts(freshInputs());
    await waitFor(() => expect(result.current.error).toBe('boom'));

    act(() => { result.current.retry(); });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.error).toBeNull();
  });

  it('RCH-7: a superseded request is aborted when the signature changes', async () => {
    const signals = [];
    globalThis.fetch = vi.fn(async (url, opts) => {
      signals.push(opts.signal);
      return { ok: true, json: async () => RESPONSE };
    });
    const { result, rerender } = renderConflicts(freshInputs());
    await waitFor(() => expect(result.current.data).not.toBeNull());

    rerender(freshInputs({ roomIds: ['room-2'] }));
    await waitFor(() => expect(signals.length).toBe(2));

    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  // ─── Occurrence model ──────────────────────────────────────────────────

  it('RCH-8: occurrences merge server expansion with exclusion dates, date-ordered, skipped wins', async () => {
    // Server expands without 2026-03-31 (saved exclusion) — the hook must
    // re-insert it as skipped. 2026-04-07 is a session-pending skip that the
    // server still expanded (pre-refetch window): skipped state wins.
    const serverDates = OCC_DATES.filter(d => d !== '2026-03-31');
    mockConflictFetch({ ...RESPONSE, allOccurrences: allOccurrencesFor(serverDates) });

    const { result } = renderConflicts(freshInputs({
      recurrence: { ...RECURRENCE, exclusions: ['2026-03-31', '2026-04-07'] },
      pendingSkippedDates: ['2026-04-07'],
    }));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    const occ = result.current.occurrences;
    expect(occ.map(o => o.date)).toEqual(OCC_DATES);
    expect(occ.find(o => o.date === '2026-03-31')).toEqual(
      expect.objectContaining({ state: 'skipped', pending: false })
    );
    expect(occ.find(o => o.date === '2026-04-07')).toEqual(
      expect.objectContaining({ state: 'skipped', pending: true })
    );
    expect(occ.find(o => o.date === '2026-03-17').state).toBe('conflicted');
    expect(occ.find(o => o.date === '2026-03-10').state).toBe('clear');
  });

  it('RCH-9: conflictedDates and skipRefused derive from the response', async () => {
    mockConflictFetch();
    const { result } = renderConflicts(freshInputs());
    await waitFor(() => expect(result.current.data).not.toBeNull());

    expect(result.current.conflictedDates).toEqual(['2026-03-17', '2026-03-24']);
    expect(result.current.skipRefused).toBe(false);
    expect(result.current.totalOccurrences).toBe(12);
    expect(result.current.conflictingOccurrences).toBe(2);
  });

  it('RCH-9b: a single-occurrence series refuses skip', async () => {
    mockConflictFetch({
      totalOccurrences: 1, conflictingOccurrences: 1, cleanOccurrences: 0,
      conflicts: [RESPONSE.conflicts[0]],
      allOccurrences: allOccurrencesFor(['2026-03-17']),
    });
    const { result } = renderConflicts(freshInputs());
    await waitFor(() => expect(result.current.data).not.toBeNull());

    expect(result.current.skipRefused).toBe(true);
  });

  it('RCH-10: lastKnownBlockers retains a skipped date\'s blockers across the exclusion refetch', async () => {
    // First response: 2026-03-17 conflicts. Then the date is skipped
    // (exclusion added) and the refetch no longer mentions it. The session
    // memory must still name its blockers so the skipped verdict can warn.
    const secondResponse = {
      totalOccurrences: 11,
      conflictingOccurrences: 1,
      cleanOccurrences: 10,
      conflicts: [RESPONSE.conflicts[1]],
      allOccurrences: allOccurrencesFor(OCC_DATES.filter(d => d !== '2026-03-17')),
    };
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => RESPONSE })
      .mockResolvedValue({ ok: true, json: async () => secondResponse });

    const { result, rerender } = renderConflicts(freshInputs());
    await waitFor(() => expect(result.current.data).not.toBeNull());

    rerender(freshInputs({
      recurrence: { ...RECURRENCE, exclusions: ['2026-03-17'] },
      pendingSkippedDates: ['2026-03-17'],
    }));
    await waitFor(() => expect(result.current.data?.totalOccurrences).toBe(11));

    expect(result.current.lastKnownBlockers['2026-03-17']).toEqual([
      expect.objectContaining({ id: 'c1', eventTitle: 'Existing Meeting' }),
    ]);
    // The skipped chip is back in the merged model
    expect(result.current.occurrences.find(o => o.date === '2026-03-17')).toEqual(
      expect.objectContaining({ state: 'skipped', pending: true })
    );
  });
});
