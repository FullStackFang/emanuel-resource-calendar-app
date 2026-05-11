// src/utils/calendarLoadDecision.js
//
// Pure decision functions and the reload coordinator factory used by
// Calendar.jsx. The coordinator is the single chokepoint that callers go
// through — it owns the silent-vs-cold distinction by intent (mutation vs
// navigation) so individual call sites can't forget the flag.
//
// The bug class these guard against: post-mutation reloads that race
// backend write-visibility return { count: 0, events: [] } and
// inadvertently wipe optimistically-rendered events. Silent reloads
// (mutations, polling, SSE) must preserve state; non-silent reloads
// (initial mount, navigation) are authoritative and may clear.

/**
 * Creates a reload coordinator over a raw loadEvents primitive.
 *
 * Returns two named wrappers that together cover every legitimate caller:
 *
 * - mutationReload(force = true, calendarsData = null)
 *     Always passes { silent: true } to loadEvents. Use after any mutation
 *     (create, edit, delete, publish, reject), for sync-to-internal, mode
 *     toggle, manual refresh, and SSE/polling/bus invalidations. A 0-event
 *     response cannot wipe optimistic state on top of a partially-applied
 *     write.
 *
 * - navigationReload(force = false, calendarsData = null)
 *     Always passes { silent: false } to loadEvents. Use only for context
 *     changes that should authoritatively reflect the new scope: initial
 *     mount, date-range change, calendar switch. A 0-event response IS the
 *     truth for the new scope.
 *
 * The internal { isRetry: true } flag (used by the pendingReload retry
 * inside loadEventsUnified) is intentionally not exposed — that retry path
 * stays inside the load primitive itself.
 */
export function createReloadCoordinator(loadEvents) {
  return {
    mutationReload: (forceRefresh = true, calendarsData = null) =>
      loadEvents(forceRefresh, calendarsData, { silent: true }),
    navigationReload: (forceRefresh = false, calendarsData = null) =>
      loadEvents(forceRefresh, calendarsData, { silent: false }),
  };
}

export function shouldClearEventsOnZeroResult(loadResult, { silent = false, isRetry = false } = {}) {
  if (!loadResult) return false;
  const isZero = loadResult.count === 0 && (loadResult.events?.length ?? 0) === 0;
  if (!isZero) return false;
  if (silent) return false;
  if (isRetry) return false;
  return true;
}

export function shouldShowSyncDisabledNotice(loadResult, { hasObservedEvents = false } = {}) {
  if (hasObservedEvents) return false;
  if (!loadResult) return false;
  const warnings = loadResult.warnings || [];
  return warnings.some(w => w?.code === 'NO_EVENTS_SYNC_DISABLED');
}
