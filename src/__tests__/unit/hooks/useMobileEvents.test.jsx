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
//
// The infinite-scroll change added `ensureRange` and made coverage gap-only.
// The second describe block below pins that: what is already held is never
// re-requested, a jump re-anchors the loaded range instead of bridging the gap
// it skipped, and an extension failure stays out of the full-screen `error`.

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

describe('useMobileEvents range coverage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0)); // Wed Jul 15 2026
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Mounts with Jul 12 00:00 - Jul 25 23:59:59.999 already loaded. */
  async function mountLoaded() {
    mockFetchReturning([]);
    const hook = renderHook(() => useMobileEvents(new Date(2026, 6, 15)));
    await waitFor(() => expect(hook.result.current.initialLoading).toBe(false));
    globalThis.fetch.mockClear();
    return hook;
  }

  it('fetches only the days past the loaded end when extending forward', async () => {
    const { result } = await mountLoaded();

    let status;
    await act(async () => {
      status = await result.current.ensureRange(
        new Date(2026, 6, 12),
        new Date(2026, 7, 8, 23, 59, 59, 999)
      );
    });

    expect(status).toBe('covered');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const body = bodyOf(globalThis.fetch.mock.calls[0]);
    // Starts 1ms after the loaded end — Jul 26, not Jul 12.
    expect(body.startTime).toBe(new Date(2026, 6, 26).toISOString());
    expect(body.endTime).toBe(new Date(2026, 7, 8, 23, 59, 59, 999).toISOString());
  });

  it('fetches only the days before the loaded start when extending backward', async () => {
    const { result } = await mountLoaded();

    await act(async () => {
      await result.current.ensureRange(
        new Date(2026, 5, 28),
        new Date(2026, 6, 25, 23, 59, 59, 999)
      );
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const body = bodyOf(globalThis.fetch.mock.calls[0]);
    expect(body.startTime).toBe(new Date(2026, 5, 28).toISOString());
    // Ends 1ms before the loaded start.
    expect(body.endTime).toBe(new Date(2026, 6, 11, 23, 59, 59, 999).toISOString());
  });

  it('fetches both gaps in sequence when a target straddles the loaded range', async () => {
    const { result } = await mountLoaded();

    await act(async () => {
      await result.current.ensureRange(
        new Date(2026, 5, 28),
        new Date(2026, 7, 8, 23, 59, 59, 999)
      );
    });

    // The single-flight guard sits above coverRange precisely so the second
    // gap is not dropped.
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(bodyOf(globalThis.fetch.mock.calls[0]).startTime)
      .toBe(new Date(2026, 5, 28).toISOString());
    expect(bodyOf(globalThis.fetch.mock.calls[1]).startTime)
      .toBe(new Date(2026, 6, 26).toISOString());
  });

  it('reports covered without fetching when the range is already held', async () => {
    const { result } = await mountLoaded();

    let status;
    await act(async () => {
      status = await result.current.ensureRange(
        new Date(2026, 6, 14),
        new Date(2026, 6, 20, 23, 59, 59, 999)
      );
    });

    expect(status).toBe('covered');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('treats an exactly adjacent target as contiguous, not a jump', async () => {
    const { result } = await mountLoaded();

    // Jul 26 00:00 begins 1ms after the loaded end. No day is skipped, so this
    // must fetch the 14 new days rather than re-anchor and refetch all 28.
    await act(async () => {
      await result.current.ensureRange(
        new Date(2026, 6, 26),
        new Date(2026, 7, 8, 23, 59, 59, 999)
      );
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(bodyOf(globalThis.fetch.mock.calls[0]).startTime)
      .toBe(new Date(2026, 6, 26).toISOString());

    // The loaded range is now the union, so the original days are still held.
    await act(async () => {
      const status = await result.current.ensureRange(
        new Date(2026, 6, 12),
        new Date(2026, 6, 25, 23, 59, 59, 999)
      );
      expect(status).toBe('covered');
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('re-anchors the loaded range on a disjoint jump instead of bridging the gap', async () => {
    mockFetchReturning([]);
    const { result, rerender } = renderHook(
      ({ date }) => useMobileEvents(date),
      { initialProps: { date: new Date(2026, 6, 15) } }
    );
    await waitFor(() => expect(result.current.initialLoading).toBe(false));

    // Nov 4 2026 — months past Jul 12-25, so the intervening weeks are skipped.
    rerender({ date: new Date(2026, 10, 4) });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
    globalThis.fetch.mockClear();

    // Coming back must refetch. A min/max loaded range would have claimed to
    // span Jul through Nov and fetched nothing here.
    rerender({ date: new Date(2026, 6, 15) });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    const body = bodyOf(globalThis.fetch.mock.calls[0]);
    expect(body.startTime).toBe(new Date(2026, 6, 12).toISOString());
  });

  it('reports suppressed, not error, when a fetch is already in flight', async () => {
    let release;
    globalThis.fetch = vi.fn(() => new Promise(resolve => {
      release = () => resolve({ ok: true, json: async () => ({ events: [] }) });
    }));

    const { result } = renderHook(() => useMobileEvents(new Date(2026, 6, 15)));

    let status;
    await act(async () => {
      status = await result.current.ensureRange(
        new Date(2026, 6, 26),
        new Date(2026, 7, 8, 23, 59, 59, 999)
      );
    });

    expect(status).toBe('suppressed');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    await act(async () => { release(); });
    await waitFor(() => expect(result.current.initialLoading).toBe(false));
  });

  it('keeps an extension failure out of the full-screen error state', async () => {
    const { result } = await mountLoaded();
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500 });

    let status;
    await act(async () => {
      status = await result.current.ensureRange(
        new Date(2026, 6, 26),
        new Date(2026, 7, 8, 23, 59, 59, 999)
      );
    });

    expect(status).toBe('error');
    // The reader still has their list; only the extending end may show a retry.
    expect(result.current.error).toBeNull();
  });

  it('refreshes the whole grown range, not just the selected week', async () => {
    const { result } = await mountLoaded();

    await act(async () => {
      await result.current.ensureRange(
        new Date(2026, 6, 12),
        new Date(2026, 7, 8, 23, 59, 59, 999)
      );
    });
    globalThis.fetch.mockClear();

    await act(async () => { result.current.refresh(); });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));

    const body = bodyOf(globalThis.fetch.mock.calls[0]);
    expect(body.startTime).toBe(new Date(2026, 6, 12).toISOString());
    expect(body.endTime).toBe(new Date(2026, 7, 8, 23, 59, 59, 999).toISOString());
  });

  it('replaces events on refresh so stale days cannot survive', async () => {
    mockFetchReturning([evt('stale', '2026-07-15T10:00:00')]);
    const { result } = renderHook(() => useMobileEvents(new Date(2026, 6, 15)));
    await waitFor(() => expect(result.current.initialLoading).toBe(false));
    expect(result.current.events.map(e => e.id)).toEqual(['stale']);

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ events: [evt('fresh', '2026-07-16T10:00:00')] }),
    }));
    await act(async () => { result.current.refresh(); });
    await waitFor(() => expect(result.current.events.map(e => e.id)).toEqual(['fresh']));
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
