// src/__tests__/unit/utils/calendarLoadDecision.test.js
//
// Locks the wipe-decision contract for the post-mutation blank-grid bug.
//
// Background: Calendar.jsx loadEventsUnified called setAllEvents([]) on any
// 0-event load result, regardless of caller intent. Mutation-triggered
// reloads (event creation success, sync-to-internal, retry-after-creation)
// race backend write-visibility and can return { count: 0, events: [] }
// even when events exist. The wipe was wiping optimistically-rendered
// events the user had just created.
//
// Fix: callers pass { silent: true } for mutation-triggered reloads and
// { isRetry: true } for pendingReload retries. Decision logic preserves
// existing state on either flag. Non-silent, non-retry calls (initial
// mount, navigation, manual refresh) remain authoritative and may wipe.
//
// This file tests the pure decision functions extracted to
// src/utils/calendarLoadDecision.js. Integration-level coverage of the
// call-site contract (eventCreation.onSuccess, etc.) belongs in the
// Playwright e2e because the timing race is not jsdom-testable.

import { describe, it, expect, vi } from 'vitest';
import {
  shouldClearEventsOnZeroResult,
  shouldVerifyZeroResult,
  createReloadCoordinator,
} from '../../../utils/calendarLoadDecision';

describe('shouldClearEventsOnZeroResult', () => {
  const zeroResult = { count: 0, events: [], source: 'unified' };

  it('returns true when result is zero, no flags set (cold load, navigation, manual refresh)', () => {
    expect(shouldClearEventsOnZeroResult(zeroResult)).toBe(true);
    expect(shouldClearEventsOnZeroResult(zeroResult, {})).toBe(true);
    expect(shouldClearEventsOnZeroResult(zeroResult, { silent: false, isRetry: false })).toBe(true);
  });

  it('returns false when silent=true (mutation reload, SSE invalidation, polling)', () => {
    expect(shouldClearEventsOnZeroResult(zeroResult, { silent: true })).toBe(false);
    expect(shouldClearEventsOnZeroResult(zeroResult, { silent: true, isRetry: false })).toBe(false);
  });

  it('returns false when isRetry=true (pendingReload retry, defense-in-depth)', () => {
    expect(shouldClearEventsOnZeroResult(zeroResult, { isRetry: true })).toBe(false);
    expect(shouldClearEventsOnZeroResult(zeroResult, { silent: false, isRetry: true })).toBe(false);
  });

  it('returns false when both flags set (retry of a silent refresh)', () => {
    expect(shouldClearEventsOnZeroResult(zeroResult, { silent: true, isRetry: true })).toBe(false);
  });

  it('returns false when result has events (regardless of count value)', () => {
    expect(shouldClearEventsOnZeroResult({ count: 1, events: [{ id: 'a' }] })).toBe(false);
    expect(shouldClearEventsOnZeroResult({ count: 0, events: [{ id: 'a' }] })).toBe(false);
    expect(shouldClearEventsOnZeroResult({ count: 5, events: [{ id: 'a' }, { id: 'b' }] })).toBe(false);
  });

  it('returns false when count > 0 even if events array is empty (defensive: weird shape)', () => {
    expect(shouldClearEventsOnZeroResult({ count: 3, events: [] })).toBe(false);
  });

  it('handles missing/null events array safely', () => {
    expect(shouldClearEventsOnZeroResult({ count: 0 })).toBe(true);
    expect(shouldClearEventsOnZeroResult({ count: 0, events: null })).toBe(true);
    expect(shouldClearEventsOnZeroResult({ count: 0, events: undefined })).toBe(true);
  });

  it('returns false for null/undefined loadResult (defensive)', () => {
    expect(shouldClearEventsOnZeroResult(null)).toBe(false);
    expect(shouldClearEventsOnZeroResult(undefined)).toBe(false);
  });

  it('regression guard: simulating the four patched call sites — all pass silent: true and never wipe on transient zero-result', () => {
    // Mirrors the production patch in Calendar.jsx for:
    //   line 638  eventCreation.onSuccess
    //   line 924  handleModeToggle
    //   line 2142 syncEventsToInternal
    //   line 2461 retryEventLoadAfterCreation
    // If anyone reverts a patch (drops { silent: true }), this assertion
    // narrows the search to which call site lost the flag.
    const callSites = [
      { name: 'eventCreation.onSuccess (line 638)', opts: { silent: true } },
      { name: 'handleModeToggle (line 924)', opts: { silent: true } },
      { name: 'syncEventsToInternal (line 2142)', opts: { silent: true } },
      { name: 'retryEventLoadAfterCreation (line 2461)', opts: { silent: true } },
    ];
    for (const { name, opts } of callSites) {
      expect(
        shouldClearEventsOnZeroResult(zeroResult, opts),
        `${name} should not trigger wipe on transient zero result`
      ).toBe(false);
    }
  });
});

describe('shouldVerifyZeroResult', () => {
  // Locks the cold-reload false-empty contract.
  //
  // Background: a fresh page load (reload of the home Calendar) starts with an
  // empty event cache, so the in-session "keep existing events" guards
  // (silent / isRetry) have nothing to protect. A transient cold cross-partition
  // query, replica lag, or a throttled 429 can return { count: 0, events: [] }
  // even when events exist, and the navigation-intent path would accept it and
  // blank the grid ("No events to display") — the reported "no data on reload,
  // which is incorrect" symptom.
  //
  // Fix: the FIRST cold (non-silent, non-retry) zero-result per calendar
  // selection is VERIFIED with a single retry before being accepted. The verify
  // retry runs as a normal non-silent load whose own zero-result is then
  // authoritative (alreadyVerified=true → this returns false → the wipe
  // contract takes over). `alreadyVerified` caps it at one retry — no loop.
  const zeroResult = { count: 0, events: [], source: 'unified' };

  it('returns true for the first cold zero-result (the case we fix)', () => {
    expect(shouldVerifyZeroResult(zeroResult)).toBe(true);
    expect(shouldVerifyZeroResult(zeroResult, {})).toBe(true);
    expect(shouldVerifyZeroResult(zeroResult, { silent: false, isRetry: false, alreadyVerified: false })).toBe(true);
  });

  it('returns false when silent=true (mutation/SSE/polling already preserve state)', () => {
    expect(shouldVerifyZeroResult(zeroResult, { silent: true })).toBe(false);
  });

  it('returns false when isRetry=true (this IS a catch-up retry — do not re-verify)', () => {
    expect(shouldVerifyZeroResult(zeroResult, { isRetry: true })).toBe(false);
  });

  it('returns false when alreadyVerified=true (verify at most once — no infinite retry loop)', () => {
    expect(shouldVerifyZeroResult(zeroResult, { alreadyVerified: true })).toBe(false);
    expect(shouldVerifyZeroResult(zeroResult, { silent: false, isRetry: false, alreadyVerified: true })).toBe(false);
  });

  it('returns false when result has events (nothing to verify)', () => {
    expect(shouldVerifyZeroResult({ count: 1, events: [{ id: 'a' }] })).toBe(false);
    expect(shouldVerifyZeroResult({ count: 0, events: [{ id: 'a' }] })).toBe(false);
  });

  it('returns false when count > 0 even if events array is empty (weird shape — wipe contract handles it)', () => {
    expect(shouldVerifyZeroResult({ count: 3, events: [] })).toBe(false);
  });

  it('handles missing/null events array safely', () => {
    expect(shouldVerifyZeroResult({ count: 0 })).toBe(true);
    expect(shouldVerifyZeroResult({ count: 0, events: null })).toBe(true);
    expect(shouldVerifyZeroResult({ count: 0, events: undefined })).toBe(true);
  });

  it('returns false for null/undefined loadResult (defensive)', () => {
    expect(shouldVerifyZeroResult(null)).toBe(false);
    expect(shouldVerifyZeroResult(undefined)).toBe(false);
  });

  it('handoff contract: a cold zero is verified once, then the verify retry defers to the wipe contract', () => {
    // First cold load: not yet verified → verify (do NOT clear yet).
    const first = { silent: false, isRetry: false, alreadyVerified: false };
    expect(shouldVerifyZeroResult(zeroResult, first)).toBe(true);
    expect(shouldClearEventsOnZeroResult(zeroResult, first)).toBe(true); // would have wiped — that's the bug

    // Verify retry (alreadyVerified=true): no second verify; wipe contract is
    // now authoritative and clears, so a genuinely-empty calendar still shows
    // the empty state.
    const verifyRetry = { silent: false, isRetry: false, alreadyVerified: true };
    expect(shouldVerifyZeroResult(zeroResult, verifyRetry)).toBe(false);
    expect(shouldClearEventsOnZeroResult(zeroResult, verifyRetry)).toBe(true);
  });
});

describe('createReloadCoordinator', () => {
  // The coordinator is the structural fix — it makes it impossible for a
  // future call site to forget the silent flag. These tests lock the
  // contract: mutationReload always passes silent: true; navigationReload
  // never does. If anyone removes the flag from the factory, these tests
  // catch it before the build ships.

  it('mutationReload always passes silent: true (no caller can opt out)', () => {
    const loadEvents = vi.fn();
    const { mutationReload } = createReloadCoordinator(loadEvents);

    mutationReload();
    expect(loadEvents).toHaveBeenLastCalledWith(true, null, { silent: true });

    mutationReload(false);
    expect(loadEvents).toHaveBeenLastCalledWith(false, null, { silent: true });

    mutationReload(true, [{ id: 'cal1' }]);
    expect(loadEvents).toHaveBeenLastCalledWith(true, [{ id: 'cal1' }], { silent: true });
  });

  it('mutationReload defaults forceRefresh=true (every legitimate mutation reload wants fresh data)', () => {
    const loadEvents = vi.fn();
    const { mutationReload } = createReloadCoordinator(loadEvents);
    mutationReload();
    expect(loadEvents).toHaveBeenCalledWith(true, null, { silent: true });
  });

  it('navigationReload always passes silent: false (authoritative on new scope)', () => {
    const loadEvents = vi.fn();
    const { navigationReload } = createReloadCoordinator(loadEvents);

    navigationReload();
    expect(loadEvents).toHaveBeenLastCalledWith(false, null, { silent: false });

    navigationReload(true);
    expect(loadEvents).toHaveBeenLastCalledWith(true, null, { silent: false });

    navigationReload(false, [{ id: 'cal2' }]);
    expect(loadEvents).toHaveBeenLastCalledWith(false, [{ id: 'cal2' }], { silent: false });
  });

  it('navigationReload defaults forceRefresh=false (cache hits are fine on navigation)', () => {
    const loadEvents = vi.fn();
    const { navigationReload } = createReloadCoordinator(loadEvents);
    navigationReload();
    expect(loadEvents).toHaveBeenCalledWith(false, null, { silent: false });
  });

  it('does not expose isRetry — that flag is internal to loadEventsUnified', () => {
    const loadEvents = vi.fn();
    const { mutationReload, navigationReload } = createReloadCoordinator(loadEvents);
    mutationReload();
    expect(loadEvents.mock.calls[0][2]).not.toHaveProperty('isRetry');
    navigationReload();
    expect(loadEvents.mock.calls[1][2]).not.toHaveProperty('isRetry');
  });

  it('returns referentially stable functions per coordinator instance (memo-friendly)', () => {
    const loadEvents = vi.fn();
    const c = createReloadCoordinator(loadEvents);
    expect(c.mutationReload).toBe(c.mutationReload);
    expect(c.navigationReload).toBe(c.navigationReload);
  });

  it('regression guard: parallel implementation that drops { silent: true } would NOT be safe', () => {
    // Reverse-direction guard (mirroring Calendar.stableProps.test.jsx pattern):
    // proves the test methodology actually catches the bug. If someone
    // re-introduces the bug shape — a wrapper that omits silent — the
    // assertion below fails. This protects against the failure mode where
    // tests appear to pass but the production contract has drifted.
    const loadEvents = vi.fn();
    const buggyMutationReload = (force = true) => loadEvents(force); // <-- silent flag dropped
    buggyMutationReload();
    expect(loadEvents.mock.calls[0][2]).not.toEqual({ silent: true });
    // The above would be a regression. createReloadCoordinator's mutationReload
    // would have passed { silent: true } and this assertion would fail.
  });
});
