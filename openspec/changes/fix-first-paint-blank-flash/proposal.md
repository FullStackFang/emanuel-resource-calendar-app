## Why

On first paint, list-style views render a brief "blank slate" — `MyReservations` shows the empty-state ("No reservations") and the Calendar shows an empty grid — *before* the loading spinner appears and *before* data has been fetched. The flash lasts one render tick but is visually jarring and makes the app feel broken on every cold load. Root cause: components derive their `loading` flag from TanStack Query's `isLoading`, which is `false` during the `pending && idle` window between `enabled` flipping to `true` and the request actually starting. During that tick `data` is `undefined`, the empty-state branch fires, and the user sees "No reservations" before the spinner takes over. The Calendar has a parallel issue on its init-error path: `setInitializing(false)` runs without a corresponding `setLoading(true)`, so the overlay vanishes before `loadEvents` re-asserts it.

## What Changes

- Standardize on `query.isPending` (not `query.isLoading`) as the first-load gate in every list view that uses TanStack Query. `isPending` is `true` during both `pending && idle` and `pending && fetching`, so the gap closes.
- Update `src/components/MyReservations.jsx` (lines 193, 198) and `src/components/ReservationRequests.jsx` (lines 204, 211) to derive `loading` and `isSilentRefreshing` from `isPending` rather than `isLoading`. Two-line change per file.
- Harden `src/components/Calendar.jsx` init-error path (line ~2363) by adding `setLoading(true)` before `setInitializing(false)` inside the `catch` block, so the loading overlay stays visible until the consolidated effect's `loadEvents` runs and resolves it.
- Establish and document a project-wide loading-state convention covering: which RQ primitive to use as the first-load gate (`isPending`), how to derive "silent background refresh" (`isFetching && !isPending`), and the empty-state rule (only render when `!isPending && data.length === 0 && !isSilentRefreshing`). Add the convention to `CLAUDE.md` "Key Architectural Patterns" so future RQ adopters do not reintroduce the bug.
- Add focused unit tests for the first-paint window: (a) MyReservations cold-token mount asserts spinner present, no empty-state text, before fetch resolves; (b) ReservationRequests dual-query path asserts spinner persists when list resolves but counts are still pending; (c) Calendar init-error overlay assertion (Playwright-deferred if mock surface is too costly).
- No API or schema changes. No new dependencies. No new context providers.

## Capabilities

### New Capabilities

- `frontend-loading-states`: Defines how list views derive their first-load gate, silent-refresh indicator, and empty-state rendering rules from TanStack Query primitives. Codifies the `isPending` vs `isLoading` semantic and the empty-state trigger so empty placeholders never appear before at least one fetch has resolved. Includes the Calendar-style imperative `loading` state's error-path obligation (overlay must stay visible until data or an error UI is committed).

### Modified Capabilities

None. This change introduces a new capability in an area that did not previously have a spec. The in-flight `architecture-and-performance-uplift` change defines a sibling `frontend-render-hygiene` capability for memoization and component decomposition; `frontend-loading-states` is intentionally narrower and should be merged independently.

## Impact

- **Frontend code**: `src/components/MyReservations.jsx`, `src/components/ReservationRequests.jsx`, `src/components/Calendar.jsx`.
- **Documentation**: `CLAUDE.md` gains a "React Query Loading State Convention" entry under "Key Architectural Patterns".
- **Tests**: New test file `src/__tests__/unit/components/MyReservations.firstPaint.test.jsx`. New test file `src/__tests__/unit/components/ReservationRequests.firstPaint.test.jsx`. Calendar init-error coverage deferred to Playwright if the Calendar.jsx mock surface is too large for unit-level testing.
- **No backend changes**. No API, schema, or dependency changes.
- **No breaking changes** for callers — internal refactor of loading semantics only.
- **Compatible with `architecture-and-performance-uplift`**: When that change migrates `EventManagement` and `Calendar` to TanStack Query, those new query consumers must follow the convention established here. The CLAUDE.md entry is the durable artifact that prevents regression.
- **Out of scope**: Suspense-driven data loading, query streaming, optimistic mutation rollback patterns, the broader `useDataRefreshBus` retirement (owned by `architecture-and-performance-uplift`), and any visual restyle of the spinner or empty state.
