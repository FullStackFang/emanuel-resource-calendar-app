# Tasks

> Prerequisite: commit the current working-tree WIP first so this lands isolated.

## 1. Dependency
- [ ] `npm i @tanstack/react-query-persist-client @tanstack/query-sync-storage-persister`
- [ ] Confirm versions match the installed `@tanstack/react-query` major (v5).

## 2. Persister + client config (`src/config/queryClient.js`)
- [ ] Ensure `defaultOptions.queries.gcTime` is finite and >= persistence `maxAge` (e.g. 24h) so entries survive long enough to restore.
- [ ] Export `createSyncStoragePersister({ storage: window.sessionStorage })`.
- [ ] Define `buster` = app build/version string (invalidate persisted cache on deploy) and `maxAge` (e.g. 24h).
- [ ] Define `shouldDehydrateQuery(query)`: default success-only, AND exclude the Approval Queue — return `false` when the query key is the `approval-queue` list or counts key (reuse `keys.events.list({ view: 'approval-queue' })` / `keys.events.counts({ view: 'approval-queue' })` for an exact match). Include `my-events` and `admin-browse`.

## 3. Provider swap (`src/App.jsx`)
- [ ] Replace `<QueryClientProvider client={queryClient}>` with `<PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge, buster, dehydrateOptions: { shouldDehydrateQuery } }}>`.
- [ ] Verify nothing else relied on `QueryClientProvider` specifically (test helpers use their own wrapper and are unaffected).

## 4. Tests
- [ ] Unit: `shouldDehydrateQuery` excludes `approval-queue` list + counts keys; includes `my-events` and `admin-browse`; excludes error/pending queries.
- [ ] Hydration smoke: pre-seed `sessionStorage` with a dehydrated `my-events` cache, render `MyReservations`, assert cards paint on first commit (no spinner-only frame) and a background refetch (`isSilentRefreshing`) fires.

## 5. Verify
- [ ] Manual: load My Reservations, reload — list shows instantly, freshness indicator shows a background refresh, no empty/spinner flash.
- [ ] Manual: act on an Approval Queue item, reload — the actioned item is NOT shown from stale cache (queue excluded from persistence).
- [ ] Run the loading test suites: `listLoadingState`, `*.firstPaint.test.jsx` — still green.

## Notes
- Do NOT persist Calendar events (not a TanStack query; covered by `shouldVerifyZeroResult`).
- Do NOT add `<DataBoundary>` here — judged not worth the render-refactor risk; components already share `LoadingSpinner` + `EmptyStateRefreshButton`.
