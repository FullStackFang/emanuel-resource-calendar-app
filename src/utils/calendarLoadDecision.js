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

/**
 * Decides whether a 0-event result should be VERIFIED with a single retry
 * before it is accepted as authoritative and allowed to clear the grid.
 *
 * The bug class this guards against: a fresh page load (reload of the home
 * Calendar) starts with an empty event cache, so the in-session "keep existing
 * events" guards (silent / isRetry, see shouldClearEventsOnZeroResult) have
 * nothing to protect — there is no prior state to fall back on. A transient
 * cold cross-partition query, replica lag, or a throttled 429 can return
 * { count: 0, events: [] } even when events exist, and the navigation-intent
 * path would accept that and blank the grid. This is the "no data on reload,
 * which is incorrect" symptom.
 *
 * Contract:
 * - Only fires for a real zero-result (count 0 AND no events).
 * - Skips silent and isRetry calls — those paths already preserve state, and
 *   the verify retry itself runs as an isRetry-free non-silent load (so its
 *   own zero-result is authoritative).
 * - `alreadyVerified` caps verification at ONE retry per calendar selection,
 *   so a genuinely-empty calendar still resolves to the empty state and there
 *   is no infinite retry loop. Callers reset their "verified" latch when the
 *   selected calendar changes (a new partition can be cold again).
 *
 * When this returns true the caller should keep the loading overlay up,
 * schedule one non-silent reload, and NOT clear events yet. When it returns
 * false the existing shouldClearEventsOnZeroResult contract decides.
 */
export function shouldVerifyZeroResult(loadResult, { silent = false, isRetry = false, alreadyVerified = false } = {}) {
  if (!loadResult) return false;
  const isZero = loadResult.count === 0 && (loadResult.events?.length ?? 0) === 0;
  if (!isZero) return false;
  if (silent || isRetry) return false;
  if (alreadyVerified) return false;
  return true;
}
