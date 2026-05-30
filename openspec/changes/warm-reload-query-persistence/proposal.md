## Why

The first-paint flash bugs are fixed (see `fix-first-paint-blank-flash` and the
`deriveListLoadingState` helper) and the Calendar cold-zero false-empty is fixed
(`shouldVerifyZeroResult` in `calendarLoadDecision.js`). What remains is purely a
*smoothness* gap: on a hard reload the React Query cache is in-memory only, so it
starts empty and every list view shows a loading spinner before its first fetch
resolves — even though the user almost always reloads onto data they just saw.

Persisting the query cache to `sessionStorage` makes reloads **warm**: the last
resolved list renders instantly, then revalidates in the background
(stale-while-revalidate). This is the list-view analogue of the Calendar's
verify-retry — both refuse to show "nothing" when we have good reason to believe
data exists. It is the last item in the loading-experience standardization.

This change is intentionally deferred until the in-progress `eventTransformers`
`calendarData`-removal refactor (and the rsched WIP) is committed, so a new
dependency + app-bootstrap change does not tangle with unrelated working-tree
edits.

## What Changes

- Add dependency `@tanstack/react-query-persist-client` (+ `createSyncStoragePersister`, already part of `@tanstack/query-sync-storage-persister`).
- In `src/config/queryClient.js`: set a finite `gcTime` (e.g. 24h) on the default options so persisted entries are restorable, and export a `sessionStorage`-backed persister with a `buster` keyed to the app build/version (invalidates stale shapes on deploy) and a `maxAge` (e.g. 24h).
- In `src/App.jsx`: replace `QueryClientProvider` with `PersistQueryClientProvider`, passing `persistOptions` with a `dehydrateOptions.shouldDehydrateQuery` filter that **excludes the Approval Queue** (`view: 'approval-queue'` list + counts keys) so a returning approver never sees an already-actioned request from the previous session. My Reservations (`view: 'my-events'`) and Admin Events (`view: 'admin-browse'`) ARE persisted.
- No change to the components migrated in `fix-first-paint-blank-flash` — they already derive from `deriveListLoadingState`; warm hydration simply means `data` is non-empty on first render and `isFirstLoad` is briefly `false` with a background `isSilentRefreshing` revalidation, which the existing empty-state predicate already handles correctly.
- The Calendar is out of scope: its event list is not a TanStack query (imperative `allEvents` + `loadEventsUnified`). Its reload safety is already provided by `shouldVerifyZeroResult`.

## Capabilities

### Modified Capabilities

- `frontend-loading-states`: extend with a warm-reload (stale-while-revalidate) rule — persisted list queries hydrate from `sessionStorage` on reload and revalidate in the background; the empty-state predicate is unchanged (it already suppresses on `isSilentRefreshing`). The persistence allow-list is explicit: queues whose staleness is user-visible-and-actionable (Approval Queue) are excluded.

## Impact

- **Dependencies**: `+ @tanstack/react-query-persist-client` (and the sync-storage persister package). One bundle addition (~small).
- **Frontend code**: `src/config/queryClient.js`, `src/App.jsx`. No component changes.
- **Storage**: uses `sessionStorage` (clears on tab/browser close) — bounds staleness to a single browsing session and avoids cross-user leakage on shared machines better than `localStorage`.
- **Correctness guards**: Approval Queue excluded from persistence; `buster` on app version; `maxAge` cap; `gcTime` finite.
- **Tests**: a unit test asserting the dehydrate filter excludes `approval-queue` keys and includes `my-events`/`admin-browse`; a hydration smoke test (render with a pre-seeded sessionStorage cache → list paints immediately, then a background refetch fires).
- **Out of scope**: Calendar event persistence, the `<DataBoundary>` visual component (judged not worth the render-refactor risk), `localStorage`/cross-session persistence, and any offline/PWA behavior.

## Prerequisite

Commit the current working-tree WIP (`eventTransformers` `calendarData` removal, rsched/`RecurrenceTabContent` edits) first, so this dependency + bootstrap change lands as an isolated, revertable commit.
