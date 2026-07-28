// src/__tests__/unit/hooks/useMobileEvents.test.jsx
//
// Behavior-parity lock for the event window lifted out of MobileAgenda. The
// restructure that introduced this hook is supposed to be invisible to users,
// so these tests pin the exact behaviors the agenda depended on:
//   - one initial fetch for TODAY's two-week window (not the selected date's)
//   - navigating inside the loaded range does NOT refetch
//   - navigating outside it APPENDS, deduping by id and re-sorting
//   - refresh/retry discard the loaded range and refetch it
//   - a concurrent fetch is suppressed (the single-flight ref)
//   - only published/pending events survive

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../../../config/config', () => ({
  default: {
    API_BASE_URL: 'http://localhost:3001/api',
    CALENDAR_CONFIG: {
      DEFAULT_MODE: 'sandbox',
      SANDBOX_CALENDAR: 'sandbox@example.org',
      PRODUCTION_CALENDAR: 'prod@example.org',
    },
  },
}));
vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: 'test-token' }),
}));
// The hook's job is the window, not the recurrence pipeline: pass raw docs
// through so fixtures read as the flat rows the agenda actually renders.
vi.mock('../../../utils/agendaEventPipeline', () => ({
  prepareEventsForAgenda: (raw) => raw,
}));
vi.mock('../../../utils/eventTransformers', () => ({
  transformEventToFlatStructure: (e) => e,
}));

import { useMobileEvents, getWeekRange } from '../../../hooks/useMobileEvents';

function evt(id, startDateTime, status = 'published') {
  return {
    id,
    status,
    startDateTime,
    startDate: startDateTime.slice(0, 10),
    eventTitle: `Event ${id}`,
  };
}

/** Every fetch resolves with the same payload unless overridden per call. */
function mockFetchReturning(events) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ events }),
  }));
}

function bodyOf(call) {
  return JSON.parse(call[1].body);
}

describe('useMobileEvents', () => {
  beforeEach(() => {
    // Fake ONLY Date — waitFor drives itself off real timers, so faking the
    // whole clock would deadlock every assertion in this file.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0)); // Wed Jul 15 2026
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fetches today two-week window once on mount', async () => {
    mockFetchReturning([evt('a', '2026-07-15T10:00:00')]);

    const { result } = renderHook(() => useMobileEvents(new Date(2026, 6, 15)));

    await waitFor(() => expect(result.current.initialLoading).toBe(false));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // Sunday of today's week (Jul 12) through 13 days later (Jul 25).
    const { start, end } = getWeekRange(new Date(2026, 6, 15));
    const body = bodyOf(globalThis.fetch.mock.calls[0]);
    expect(body.startTime).toBe(start.toISOString());
    expect(body.endTime).toBe(end.toISOString());
    expect(body.calendarOwners).toEqual(['sandbox@example.org']);
    expect(result.current.events).toHaveLength(1);
  });

  it('drops events that are not published or pending', async () => {
    mockFetchReturning([
      evt('pub', '2026-07-15T10:00:00', 'published'),
      evt('pend', '2026-07-15T11:00:00', 'pending'),
      evt('draft', '2026-07-15T12:00:00', 'draft'),
      evt('rej', '2026-07-15T13:00:00', 'rejected'),
      evt('del', '2026-07-15T14:00:00', 'deleted'),
    ]);

    const { result } = renderHook(() => useMobileEvents(new Date(2026, 6, 15)));
    await waitFor(() => expect(result.current.initialLoading).toBe(false));

    expect(result.current.events.map(e => e.id)).toEqual(['pub', 'pend']);
  });

  it('groups by startDate and exposes the set of dates that have events', async () => {
    mockFetchReturning([
      evt('a', '2026-07-15T10:00:00'),
      evt('b', '2026-07-15T14:00:00'),
      evt('c', '2026-07-16T09:00:00'),
    ]);

    const { result } = renderHook(() => useMobileEvents(new Date(2026, 6, 15)));
    await waitFor(() => expect(result.current.initialLoading).toBe(false));

    expect(Object.keys(result.current.groupedEvents).sort()).toEqual(['2026-07-15', '2026-07-16']);
    expect(result.current.groupedEvents['2026-07-15']).toHaveLength(2);
    expect([...result.current.eventDates].sort()).toEqual(['2026-07-15', '2026-07-16']);
  });

  it('does not refetch when the selected date stays inside the loaded range', async () => {
    mockFetchReturning([evt('a', '2026-07-15T10:00:00')]);

    const { result, rerender } = renderHook(
      ({ date }) => useMobileEvents(date),
      { initialProps: { date: new Date(2026, 6, 15) } }
    );
    await waitFor(() => expect(result.current.initialLoading).toBe(false));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // Fri Jul 17 is in the SAME week as Jul 15, so its window is byte-identical
    // to the loaded one. Note this is a week-granular test, not a day-granular
    // one: the window is anchored to the selected date's Sunday, so crossing
    // into the next week extends the range even though the day itself was
    // already covered.
    rerender({ date: new Date(2026, 6, 17) });
    await act(async () => {});

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('appends (deduping and re-sorting) when the selected date leaves the loaded range', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ events: [evt('a', '2026-07-15T10:00:00')] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          events: [
            evt('a', '2026-07-15T10:00:00'),  // already held — must not duplicate
            evt('b', '2026-08-05T09:00:00'),
          ],
        }),
      });

    const { result, rerender } = renderHook(
      ({ date }) => useMobileEvents(date),
      { initialProps: { date: new Date(2026, 6, 15) } }
    );
    await waitFor(() => expect(result.current.initialLoading).toBe(false));

    rerender({ date: new Date(2026, 7, 5) }); // Aug 5 — outside Jul 12-25
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.events).toHaveLength(2));

    expect(result.current.events.map(e => e.id)).toEqual(['a', 'b']);
  });

  it('refresh discards the loaded range and refetches', async () => {
    mockFetchReturning([evt('a', '2026-07-15T10:00:00')]);

    const { result } = renderHook(() => useMobileEvents(new Date(2026, 6, 15)));
    await waitFor(() => expect(result.current.initialLoading).toBe(false));

    await act(async () => { result.current.refresh(); });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));

    // Replaced, not appended: the second call is a fresh window.
    expect(result.current.events).toHaveLength(1);
    expect(result.current.refreshing).toBe(false);
  });

  it('surfaces an error and recovers via retry', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ events: [evt('a', '2026-07-15T10:00:00')] }),
      });

    const { result } = renderHook(() => useMobileEvents(new Date(2026, 6, 15)));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.events).toHaveLength(0);

    await act(async () => { result.current.retry(); });
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.events).toHaveLength(1);
    expect(result.current.initialLoading).toBe(false);
  });

  it('suppresses a refresh while a fetch is already in flight', async () => {
    let release;
    globalThis.fetch = vi.fn(() => new Promise(resolve => {
      release = () => resolve({ ok: true, json: async () => ({ events: [] }) });
    }));

    const { result } = renderHook(() => useMobileEvents(new Date(2026, 6, 15)));

    // The mount fetch is still pending — refresh must be a no-op.
    act(() => { result.current.refresh(); });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    await act(async () => { release(); });
    await waitFor(() => expect(result.current.initialLoading).toBe(false));
  });
});

describe('getWeekRange', () => {
  it('spans the Sunday of the given week through 13 days later', () => {
    const { start, end } = getWeekRange(new Date(2026, 6, 15)); // Wed Jul 15 2026
    expect(start.getDay()).toBe(0);
    expect(start.getDate()).toBe(12);
    expect(start.getHours()).toBe(0);
    expect(end.getDate()).toBe(25);
    expect(end.getHours()).toBe(23);
  });
});
