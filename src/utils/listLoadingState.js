// src/utils/listLoadingState.js
//
// The single, tested definition of the list-view loading primitives described
// in CLAUDE.md "React Query loading primitives (TanStack v5)". Every auto-firing
// list view (MyReservations, EventManagement, ReservationRequests) derives its
// loading / silent-refresh gating from this pure function so the "first-paint
// blank flash" bug class is defined once and cannot drift back in one component
// at a time.
//
// Why a pure function (not a hook): it reads only plain fields off the query
// result, so it is trivially unit-testable without rendering — same pattern as
// calendarLoadDecision.js.

/**
 * Derive the standardized loading primitives from a TanStack Query result.
 *
 * @param {object|null} query  The primary list `useQuery` result. We read
 *   `isPending` and `isFetching`.
 * @param {object}  [opts]
 * @param {object|null} [opts.countsQuery]  An optional secondary query (e.g. a
 *   counts/badge query). It contributes to `isSilentRefreshing` (a background
 *   counts refetch should dim, not blank) but NEVER to `isFirstLoad` — only the
 *   primary list query gates the first-load spinner.
 * @param {boolean} [opts.enabled=true]  Whether the primary query is enabled.
 *   Defaults true so `isFirstLoad` tracks `isPending` (the safe default: a
 *   disabled-but-imminent query — e.g. waiting for the auth token — keeps
 *   `isPending: true`, so the spinner shows instead of a premature empty state).
 *   Pass the query's real `enabled` flag only for views that INTENTIONALLY skip
 *   the fetch on some tabs/filters (e.g. ReservationRequests' all-tab), where a
 *   perpetual `isPending: true` would otherwise mean a perpetual spinner.
 *
 * @returns {{ isFirstLoad: boolean, isSilentRefreshing: boolean }}
 *   - `isFirstLoad`     — first-load gate. Bind this to your `loading` flag and
 *                         gate the spinner on it. Covers both the `pending && idle`
 *                         tick (after `enabled` flips true, before the fetch
 *                         starts) and the `pending && fetching` window. Do NOT
 *                         use TanStack `isLoading` (= isPending && isFetching);
 *                         it is false during the idle tick and flashes the empty
 *                         state.
 *   - `isSilentRefreshing` — a background refetch over already-resolved data
 *                         (polling, SSE invalidation, mutation invalidation).
 *                         Use it to suppress the empty state and dim the list.
 *
 * Empty-state predicate (compose in the component, since empty content varies):
 *   render <EmptyState/> iff `!isFirstLoad && !isSilentRefreshing && items.length === 0`.
 */
export function deriveListLoadingState(query, { countsQuery = null, enabled = true } = {}) {
  if (!query) {
    return { isFirstLoad: false, isSilentRefreshing: false };
  }

  const isFirstLoad = enabled && !!query.isPending;

  const isSilentRefreshing =
    (!!query.isFetching && !query.isPending) ||
    (!!countsQuery && !!countsQuery.isFetching && !countsQuery.isPending);

  return { isFirstLoad, isSilentRefreshing };
}
