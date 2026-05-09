// src/__tests__/unit/hooks/useServerEvents.test.js
//
// Unit tests for the pure helpers inside useServerEvents:
//   - computeReconnectBackoff: exponential backoff with 30s cap
//   - decideServerStartAction: state machine for serverStartId comparison
//
// The hook itself is exercised via manual smoke tests (two-user local repro)
// because testing the EventSource/timer lifecycle end-to-end requires a
// heavier harness than the behaviours tested here would justify.

import { describe, it, expect, vi } from 'vitest';
import {
  computeReconnectBackoff,
  decideServerStartAction,
  bridgeSseToReactQuery,
  bridgeSseRestartToReactQuery,
  MAX_BACKOFF_MS,
} from '../../../hooks/useServerEvents';
import { keys } from '../../../queries/keys';

describe('computeReconnectBackoff', () => {
  it('starts at 1000ms for the first attempt', () => {
    expect(computeReconnectBackoff(1)).toBe(1000);
  });

  it('doubles each attempt up to the cap', () => {
    expect(computeReconnectBackoff(1)).toBe(1000);
    expect(computeReconnectBackoff(2)).toBe(2000);
    expect(computeReconnectBackoff(3)).toBe(4000);
    expect(computeReconnectBackoff(4)).toBe(8000);
    expect(computeReconnectBackoff(5)).toBe(16000);
  });

  it('caps at MAX_BACKOFF_MS (30000) for large attempts', () => {
    expect(computeReconnectBackoff(6)).toBe(30000);
    expect(computeReconnectBackoff(10)).toBe(30000);
    expect(computeReconnectBackoff(100)).toBe(30000);
    expect(MAX_BACKOFF_MS).toBe(30000);
  });

  it('returns 1000ms again after attempt counter is reset to 1 (no permanent high backoff)', () => {
    // Simulate: client has attempted 5 times, next attempt succeeds, counter resets.
    // The next disconnect should not produce a 32000ms delay — it should start over at 1000ms.
    const beforeReset = computeReconnectBackoff(5);
    expect(beforeReset).toBe(16000);
    const afterReset = computeReconnectBackoff(1);
    expect(afterReset).toBe(1000);
  });

  it('never exceeds the cap regardless of input size (no disabled state)', () => {
    // Covers the spec requirement that the client never permanently disables SSE.
    // Even at attempt 100, backoff is bounded — the loop continues forever.
    const delays = [1, 10, 50, 100, 1000].map(a => computeReconnectBackoff(a));
    for (const d of delays) {
      expect(d).toBeLessThanOrEqual(MAX_BACKOFF_MS);
    }
  });

  it('handles edge cases (zero/negative/non-finite attempts)', () => {
    expect(computeReconnectBackoff(0)).toBe(1000);
    expect(computeReconnectBackoff(-1)).toBe(1000);
    expect(computeReconnectBackoff(NaN)).toBe(1000);
    expect(computeReconnectBackoff(Infinity)).toBe(1000);
  });

  it('respects a custom cap when provided', () => {
    expect(computeReconnectBackoff(100, 5000)).toBe(5000);
    expect(computeReconnectBackoff(2, 5000)).toBe(2000);
  });
});

describe('decideServerStartAction', () => {
  it('returns "baseline" on the first connect with a serverStartId', () => {
    expect(decideServerStartAction(null, 'A')).toBe('baseline');
  });

  it('returns "match" when incoming equals previous (normal reconnect)', () => {
    expect(decideServerStartAction('A', 'A')).toBe('match');
  });

  it('returns "restart" when incoming differs from previous', () => {
    expect(decideServerStartAction('A', 'B')).toBe('restart');
  });

  it('returns "absent" when the incoming serverStartId is missing', () => {
    // Backend predates Phase 2 (no serverStartId emission).
    expect(decideServerStartAction(null, null)).toBe('absent');
    expect(decideServerStartAction('A', null)).toBe('absent');
    expect(decideServerStartAction('A', undefined)).toBe('absent');
    expect(decideServerStartAction('A', '')).toBe('absent');
  });

  it('walks the full spec scenario correctly', () => {
    // First connect, serverStartId 'A' — baseline, no dispatch
    expect(decideServerStartAction(null, 'A')).toBe('baseline');
    // Second connect, same 'A' — no dispatch
    expect(decideServerStartAction('A', 'A')).toBe('match');
    // Third connect, 'B' — server restarted, dispatch
    expect(decideServerStartAction('A', 'B')).toBe('restart');
    // Fourth connect, field absent — no dispatch, baseline unchanged
    expect(decideServerStartAction('B', null)).toBe('absent');
  });
});

// ─── §9 SSE → React Query bridge ─────────────────────────────────────────

function makeMockQueryClient() {
  return {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  };
}

describe('bridgeSseToReactQuery (§9.1, §9.2)', () => {
  it('invalidates the events.* prefix on every event-changed payload', () => {
    const qc = makeMockQueryClient();
    const data = { action: 'updated', affectedViews: ['calendar'] };

    const result = bridgeSseToReactQuery(data, qc);

    expect(result.invalidated).toBe(true);
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: keys.events.all() });
  });

  it('patches the per-event detail cache when the SSE payload includes a full event', () => {
    const qc = makeMockQueryClient();
    const fullEvent = { eventId: 'evt-42', status: 'published', _version: 7 };
    const data = { action: 'published', event: fullEvent, affectedViews: ['calendar'] };

    const result = bridgeSseToReactQuery(data, qc);

    expect(result.detailPatched).toBe(true);
    expect(qc.setQueryData).toHaveBeenCalledWith(keys.events.detail('evt-42'), fullEvent);
  });

  it('skips the detail patch when SSE payload omits the event document', () => {
    const qc = makeMockQueryClient();
    const data = { action: 'updated', affectedViews: ['calendar'] }; // no `event`

    const result = bridgeSseToReactQuery(data, qc);

    expect(result.invalidated).toBe(true);
    expect(result.detailPatched).toBe(false);
    expect(qc.setQueryData).not.toHaveBeenCalled();
  });

  it('falls back to event._id when eventId is absent', () => {
    const qc = makeMockQueryClient();
    const fullEvent = { _id: 'mongo-objectid-zzz', status: 'rejected' };
    const data = { action: 'rejected', event: fullEvent };

    bridgeSseToReactQuery(data, qc);

    expect(qc.setQueryData).toHaveBeenCalledWith(keys.events.detail('mongo-objectid-zzz'), fullEvent);
  });

  it('skips the detail patch when the event document has no usable id', () => {
    const qc = makeMockQueryClient();
    const fullEvent = { status: 'published' }; // no eventId, no _id
    const data = { event: fullEvent };

    const result = bridgeSseToReactQuery(data, qc);

    expect(result.detailPatched).toBe(false);
    expect(qc.setQueryData).not.toHaveBeenCalled();
  });

  it('returns no-op result when queryClient is null (defensive bootstrap-order guard)', () => {
    const result = bridgeSseToReactQuery({ event: { eventId: 'x' } }, null);
    expect(result).toEqual({ invalidated: false, detailPatched: false });
  });
});

describe('bridgeSseRestartToReactQuery (§9.3)', () => {
  it('invalidates both events and reservations prefixes on server restart', () => {
    const qc = makeMockQueryClient();

    const result = bridgeSseRestartToReactQuery(qc);

    expect(result).toEqual({ eventsInvalidated: true, reservationsInvalidated: true });
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(2);
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: keys.events.all() });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: keys.reservations.all() });
  });

  it('does NOT invalidate non-event resources (categories, locations stay cached across restart)', () => {
    const qc = makeMockQueryClient();

    bridgeSseRestartToReactQuery(qc);

    // Verify no broader invalidation that would sweep unrelated resources.
    const invalidatedPrefixes = qc.invalidateQueries.mock.calls.map(c => c[0].queryKey);
    expect(invalidatedPrefixes).toContainEqual(keys.events.all());
    expect(invalidatedPrefixes).toContainEqual(keys.reservations.all());
    // No invalidation of categories or locations.
    expect(invalidatedPrefixes).not.toContainEqual(keys.baseCategories.all());
    expect(invalidatedPrefixes).not.toContainEqual(keys.locations.all());
  });

  it('returns no-op result when queryClient is null (defensive bootstrap-order guard)', () => {
    const result = bridgeSseRestartToReactQuery(null);
    expect(result).toEqual({ eventsInvalidated: false, reservationsInvalidated: false });
  });
});
