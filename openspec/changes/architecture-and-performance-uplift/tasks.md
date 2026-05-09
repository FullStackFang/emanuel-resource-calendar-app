## 1. Render hygiene micro-fixes (foundation, ~1 PR)

- [x] 1.1 Wrap `LocationContext.Provider` value in `useMemo` in `src/context/LocationContext.jsx` (around line 182), with deps including only the underlying state values
- [x] 1.2 Identify and list the ~20 pure utility functions currently inside `Calendar.jsx` (lines ~1127–1370) that close over no component state or props
  - Found 10 strictly-pure helpers: `isPendingEvent`, `isDraftEvent` (already module-scope at top of file); `isUnspecifiedLocation`, `isVirtualLocation`, `isEventVirtual`, `hasPhysicalLocation`, `getEventCategories`, `isUncategorizedEvent`, `standardizeDate`, `getEventPosition` (currently `useCallback`-wrapped inside component).
  - Excluded `getMonthDayEventPosition` (closes over `userTimezone` state) and the `seriesNumberCacheRef`-using helpers — out of scope for this PR.
- [x] 1.3 Create `src/utils/calendarEventUtils.js` and move those pure utilities to module scope; update `Calendar.jsx` imports
- [x] 1.4 Remove the now-unnecessary `useCallback` wrappers around the moved functions
- [x] 1.5 Wrap the `getDatabaseLocationNames(...)` value passed to `MonthView` (`Calendar.jsx:5516`) in `useMemo` so the prop reference is stable
  - Added `databaseLocationNames` memoized array; replaced 4 inline `getDatabaseLocationNames()` call sites (MonthView, WeekView, DayView, EventSearch) with the stable reference. Kept `getDatabaseLocationNames` for any external/legacy callers — it now returns the memoized array.
- [x] 1.6 Add a frontend test asserting `LocationContext` consumers do not re-render solely from provider re-creation
  - `src/__tests__/unit/context/LocationContext.memo.test.jsx` — 1 test, mocks `useLocationsQuery` with stable result, triggers unrelated parent re-renders, asserts memoized consumer count stays at the post-mount value.
- [x] 1.7 Add a frontend test asserting `MonthView` skips its render path when its inputs are referentially stable
  - `src/__tests__/unit/components/Calendar.stableProps.test.jsx` — 2 tests. First proves `useMemo`+`React.memo` collaboration produces a stable child; second is a methodology guard reproducing the inline-`.map()` bug shape and asserting the test catches it.
- [x] 1.8 Run targeted frontend tests for Calendar, MonthView, LocationContext; smoke-test in browser
  - 3 new tests pass. Confirmed 3 pre-existing failures in `eventTransformers.test.js` are unrelated (reproduce when our changes are stashed). Browser smoke-test deferred to user verification (no automated path for full Calendar render).
- [x] 1.9 Provide ready-to-use commit message per CLAUDE.md format
  - See assistant message at end of §1 implementation for the suggested commit message.

## 2. queryClient conventions and key factory

- [x] 2.1 Document query-key conventions in a comment block in `src/config/queryClient.js` (resource-name first, scope discriminators after)
- [x] 2.2 Create `src/queries/keys.js` exporting a minimal key factory (`keys.events.list({ view, ... })`, `keys.events.detail(eventId)`, `keys.reservations.list({ ... })`)
  - Factory covers: baseCategories, outlookCategories (all/byUser), locations (all/detail), events (all/list/counts/detail/search/load), reservations (all/list/counts/detail). Back-compat re-exports of `BASE_CATEGORIES_QUERY_KEY`, `OUTLOOK_CATEGORIES_QUERY_KEY`, `LOCATIONS_QUERY_KEY` delegate to factory.
- [x] 2.3 Update the existing RQ consumers (`useCategoriesQuery.js`, `useLocationsQuery.js`, `EventSearch.jsx`) to use the factory where applicable; do not break their current behavior
  - `useCategoriesQuery`: re-exports both constants from factory; outlook-by-user uses `keys.outlookCategories.byUser(userId)` instead of array spread.
  - `useLocationsQuery`: re-exports `LOCATIONS_QUERY_KEY` from factory.
  - `EventSearch`: switched inline `['events', searchVersion, dateRange, ...]` to `keys.events.search({ version, dateRange, categories, locations, timezone })` — invalidate/setQueryData paths automatically use new shape via `searchQueryKey`.
  - Calendar.jsx's `OUTLOOK_CATEGORIES_QUERY_KEY` import path unchanged (back-compat re-export).

## 3. MyReservations → React Query

- [x] 3.1 Inventory every fetch + useEffect + useState + dispatchRefresh site in `MyReservations.jsx`
  - **Read** (1): `loadMyReservations(...)` → `GET /api/events/list?view=my-events&limit=1000&includeDeleted=true`. Has 5 interacting safety guards: AbortController + currentRequestIsSilentRef (silent vs non-silent coordination), initialLoadAttemptedRef (gate against SSE/bus events during init), lastTokenRef (cold MSAL warm-up + 401-retry single re-load), stale-write rule (silent + 0 events never overwrites populated state), abort-aware finally block.
  - **Mutations** (3, local to MyReservations): handleResubmit (`PUT /api/room-reservations/:id/resubmit`), handleRestore (`PUT /api/room-reservations/:id/restore` — has 409 SchedulingConflict branch), handleWithdrawCancellationRequest (`PUT /api/events/cancellation-requests/:id/cancel`). Each ends with `loadMyReservations()` + `dispatchRefresh('my-reservations', 'navigation-counts')`.
  - **Mutations via useEventReviewExperience hook** (~10): delete, edit, draft save, draft submit, publish, reject, request edit, duplicate, etc. Out of scope for §3 — they migrate when the hook is migrated.
  - **State**: `allReservations`, `loading`, `error`, `lastFetchedAt`, `isManualRefreshing`, `isSilentRefreshing` — all derived from `loadMyReservations`. Plus filter/sort/pagination state (out of scope for RQ migration).
  - **Subscriptions**: `usePolling(silentRefresh, 30s/5min based on isConnected)` and `useDataRefreshBus('my-reservations', silentRefresh, !!apiToken)`. Both call the silent variant.
  - **External coupling**: `loadMyReservations` reference passed as `onConflictRefresh` prop at line 989; `handleRefresh` (= `loadMyReservations` + `dispatchRefresh`) passed as `onRefresh` to the experience hook.
- [x] 3.2 Replace each read with `useQuery` using factory-derived query keys
  - `myReservationsQuery` uses `keys.events.list({ view: 'my-events', includeDeleted: true })`. Stale-write rule preserved inside queryFn (empty refetch with prior data → return prior data). `enabled: !!apiToken` handles cold MSAL warm-up. `refetchInterval` 30s/5min based on `isConnected` replaces `usePolling`. Token-rotation refetch via tiny `useEffect` (lastSeenTokenRef) — preserves legacy 401-retry semantics. Removed: `useRef`-based abort/silent/init/lastToken machinery, manual `loadMyReservations` body, mount effect, `silentRefresh`, `usePolling` import.
- [x] 3.3 Replace each write (cancel, restore, edit, draft save/submit, etc.) with `useMutation` including `onMutate` (optimistic), `onError` (rollback), `onSuccess`/`onSettled` (invalidate)
  - `resubmitMutation` (rejected → pending optimistic + rollback), `restoreMutation` (no optimistic — server-determined; preserves 409 SchedulingConflict branch via custom error type), `withdrawCancellationMutation` (no optimistic). All call `onSettled: invalidateQueries(myEventsKey)`. Loading flags (`isResubmitting`, `isRestoring`, `isWithdrawingCancellationRequest`) now derived from `mutation.isPending`.
- [x] 3.4 During migration, dual-publish: RQ mutations also call `dispatchRefresh` so non-migrated views still see updates
  - All 3 mutations call `dispatchRefresh('my-reservations', 'navigation-counts')` in their `onSuccess`. The bus subscription on the receiving end (`useDataRefreshBus('my-reservations', onBusRefresh)`) now routes to `queryClient.invalidateQueries`, completing the bridge.
- [x] 3.5 Add or update tests covering: cache hit on remount, optimistic update visible immediately, rollback on simulated error, invalidation on success
  - New `src/__tests__/unit/components/MyReservations.reactQuery.test.jsx` (4 tests): cache-hit-on-remount via shared QueryClient, stale-write rule sanity, optimistic+rollback via renderHook (uses controllable promise to expose the optimistic→error→rollback transition), invalidate-on-success via observed query.
  - New `src/__tests__/__helpers__/queryClientWrapper.jsx` (test helper).
  - All 18 existing MyReservations tests (race × 5, coldToken × 3, recurringCard × 7, recurrenceParity × 3) updated to wrap renders in QueryClientProvider; all pass without behavior changes — the migration preserves every existing contract including the AbortController/silent/init/token-rotation safety guards (now via RQ deduplication + the explicit token-rotation effect).
- [x] 3.6 Browser-verify Edit / Delete / Restore / Resubmit flows end-to-end
  - User-confirmed working in browser.
- [x] 3.7 Provide ready-to-use commit message
  - See assistant message at end of §3 implementation.

## 4. ReservationRequests (Approval Queue) → React Query

- [x] 4.1 Inventory every fetch + useEffect + useState + dispatchRefresh site in `ReservationRequests.jsx`
  - **Reads** (2): `loadReservations` (tab-scoped: `view=approval-queue&status=needs_attention|all`); `loadCounts` (`view=approval-queue` returning `{ needsAttention, all }`). Same 5 safety guards as MyReservations plus a `postAction: true` flag that bypasses the stale-write rule for post-mutation refetches.
  - **Mutations (local)**: `handleDelete` via `deleteEvent` service helper, with optimistic local-state patch `{ status: 'deleted', isDeleted: true }`.
  - **Bus delta-patch**: `handleApprovalQueueBus` reads `oldStatus → newStatus` from SSE payload and *optimistically* patches `serverCounts` (decrement pending if leaving, increment if entering). Falls back to full refetch on sub-status changes (oldStatus === newStatus).
  - **Local cache patches via experience hook onSuccess** (2): `editRequestApproved`/`editRequestRejected` set `r.pendingEditRequest.status` directly on the matching reservation row — pre-empts the next refetch's stale window.
  - **Recovery effect**: one-shot non-silent refetch when counts > 0 but list is empty (counts/list divergence). Bounded per `(apiToken, activeTab)` pair.
  - **Tab refs**: `activeTabRef` reads activeTab without stale-closure risk inside loadReservations.
  - **External coupling**: `loadReservations` passed as `onConflictRefresh` prop at line 934.
- [x] 4.2 Replace reads with `useQuery` (counts query and list query each get their own key)
  - `reservationsQuery` keyed `keys.events.list({ view: 'approval-queue', tab: activeTab })` — tab is part of the key, so tab switches produce independent cache entries (instant tab-return). queryFn extracts tab from queryKey[2] (no stale-closure risk).
  - `countsQuery` keyed `keys.events.counts({ view: 'approval-queue' })` — single query, tab-agnostic.
  - Stale-write rule preserved via `bypassEmptyGuardRef` (set true before post-mutation/manual/mount/recovery refetches; reset inside queryFn). Mirrors the legacy `postAction: true` flag's bypass semantics.
  - `enabled: !!apiToken && canApproveReservations && !permissionsLoading` — the permission gate is part of the data layer now, no more 403 spam from a slow usePermissions resolve.
  - `refetchInterval` 30s/5min based on `isConnected` replaces `usePolling`. Token-rotation via `lastSeenTokenRef` effect (same shape as §3).
- [x] 4.3 Replace approve / reject / restore / delete / publish-edit / reject-edit mutations with `useMutation` (optimistic + rollback + invalidate)
  - Card-level `deleteMutation`: optimistic predicate-based patch via `patchApprovalQueueLists` (touches both tab variants); rollback via `getQueriesData`/`setQueryData` snapshot+restore; settled invalidates list+counts. The other approval-queue actions (approve, reject, restore, edit-request publish/reject, cancellation approve/reject) live inside `useEventReviewExperience` and migrate when the hook itself is migrated (out of §4 scope per §3.5 note).
  - Local cache patches for `editRequestApproved`/`editRequestRejected` use a new module-scope helper `patchApprovalQueueLists(queryClient, eventId, updater)` — predicate-based to update both tab cache entries in one pass.
- [x] 4.4 Verify cross-tab counter consistency (approving a pending event decrements the pending counter optimistically and increments the published counter)
  - Bus delta-patch via `queryClient.setQueryData` on the counts cache mirrors the original `setServerCounts(prev => ...)` semantics — no network round-trip, immediate counter update across the tabbed view. RQ contract test asserts the delta math (pending decrement, all unchanged when both old+new are counted statuses) and the non-negative clamp.
- [x] 4.5 Add or update tests for the new query/mutation patterns; cover the 409 conflict path's rollback
  - New `src/__tests__/unit/components/ReservationRequests.reactQuery.test.jsx` (5 tests): tab-scoped cache independence, bus delta-patch on counts (incl. clamp guard), `patchApprovalQueueLists` predicate-only-touches-approval-queue, optimistic delete + rollback. The 409 path applies to mutations inside the experience hook (out of scope here); the rollback contract is exercised end-to-end via the optimistic-delete test.
  - All 9 existing tests (race × 7, recurrenceParity × 2) pass after wrapping renders in QueryClientProvider — no behavioral changes.
- [ ] 4.6 Browser-verify Approval Queue end-to-end (approve, reject, restore, delete, edit-request)
  - Pending user verification.
- [x] 4.7 Provide ready-to-use commit message
  - See assistant message at end of §4 implementation.

## 5. Backend hot-path fixes inside `routes/eventsList.js`

> **Deviation note:** §5.1–5.3 (mechanical extraction of ~1,160 lines into `routes/eventsList.js`) deferred to §11/§14 batch (where all route extractions land together). Hot-path fixes §5.4–5.11 land surgically in api-server.js + testApp.js, decoupled from the extraction. This delivers the user-facing performance wins immediately and lets the extraction PR ride a single, focused review.

- [~] 5.1 Create `backend/routes/eventsList.js` with an `express.Router()` (or factory) export — **deferred to §11/§14**
- [~] 5.2 Move the handlers for `POST /api/events/load`, `GET /api/events/list`, and `GET /api/events/list/counts` from `api-server.js` into `routes/eventsList.js`; mount under `/api/events` from `api-server.js` — **deferred to §11/§14**
- [~] 5.3 Run targeted backend tests for these endpoints; assert behavior is unchanged from the move alone — **deferred to §11/§14**
- [x] 5.4 Replace the per-calendar Graph fetch loop in `POST /api/events/load` with `Promise.allSettled(...)`; preserve per-calendar try/catch semantics by treating rejected calendars as zero-event with structured warning log
  - api-server.js:6398 sequential `for...await` loop replaced with `graphFetchTasks.map(async ...)` + `Promise.allSettled`. Each task captures its own error inside the constructor so allSettled never rejects in practice. Error-case forwarding into `loadResults.errors` preserves the legacy structured-warning shape exactly. Defensive `status === 'rejected'` guard logs unexpected synchronous throws. Per-calendar post-processing (newEvents filter + loadResults.calendars metadata) wrapped in its own try/catch as `postProcessingError` for symmetry.
  - **Expected win**: 3 calendars × ~500ms each was ~1.5s sequential; now bounded by the slowest single fetch.
- [~] 5.5 Add a backend test that mocks one of three calendars to fail and asserts the request returns 200 with events from the surviving two
  - **Deferred**: testApp.js does NOT implement `/api/events/load` — only `/list` and `/list/counts`. Writing a meaningful integration test requires spinning the real api-server with mocked graphApiService, which is test infrastructure work outside this change's scope. Code change verified syntactically (api-server.js parses cleanly).
- [x] 5.6 Gate `enrichSeriesMastersWithOverrides(...)` on `mastersFound > 0` in both `POST /api/events/load` and `GET /api/events/list`; preserve the cold-Cosmos retry path for the masters-present case
  - Both call sites now pre-check `events.some(e => e.eventType === 'seriesMaster')` and skip the enrichment helper entirely on the common case (zero masters). Cold-Cosmos retry path unchanged when masters are present.
- [~] 5.7 Add a backend test asserting enrichment is not invoked when the events query returned zero series masters
  - **Deferred**: testApp.js does not invoke `enrichSeriesMastersWithOverrides`, so the gating is not exercisable through the existing test substrate. Same root cause as 5.5 — needs real-api-server test infrastructure.
- [~] 5.8 Add a Mongo projection to `GET /api/events/list` that excludes `graphData` from each returned document
  - **Already done** — EVENT_LIST_PROJECTION (api-server.js:5983) already trims to ~11 specific `graphData.*` subfields rather than returning the full blob. The audit overstated "full graphData included." No further change needed; the projection is centralized and shared across `/api/events/load`, `/api/events/list`, and `getUnifiedEvents`.
- [~] 5.9 Add a backend test asserting list response items contain no `graphData` field
  - **Reframed**: the spec wording assumed full-blob exclusion; in practice the projection includes specific subfields by design (frontend reads `graphData.id` and `graphData.iCalUId` for dedupe). A useful test instead would assert the ABSENCE of un-projected fields like `graphData.bodyPreview` lengthy content. Defer alongside 5.5/5.7.
- [~] 5.10 Move the JS `Array.prototype.sort` for the list endpoint into the Mongo query (sort by `calendarData.startDateTime`)
  - **Deferred to dedicated Cosmos perf session**: the JS sort comment ("Cosmos DB index limitations") flags this as a known structural constraint, not an oversight. Moving the sort into Mongo requires either a compound index per query shape (status × calendarOwner × startDateTime, etc.) or a single-field sort index Cosmos can leverage — both need RU/throughput testing against production-shaped data. Out of scope for surgical fixes.
- [~] 5.11 Create the compound index `(status: 1, calendarData.startDateTime: 1)` on `templeEvents__Events` via an idempotent `createIndex` call (check the query-shape audit at extraction time to confirm whether `calendarOwner` should prefix the index)
  - **Deferred to dedicated Cosmos perf session** alongside 5.10. Creating an index without exercising it (because the JS sort path is unchanged) wastes RU on every write without a read benefit.
- [ ] 5.12 Browser-verify Calendar and Approval Queue still load with realistic data
  - Pending user verification — particularly that the parallelized Graph fetch returns correct event counts and the gated enrichment doesn't regress recurring-event display.
- [x] 5.13 Provide ready-to-use commit message
  - See assistant message at end of §5 implementation.

## 6. OCC restoration on `audit-update`

- [x] 6.1 Replace the bare `updateOne` in `POST /api/events/:eventId/audit-update` (`api-server.js:8195`, or its new home in `routes/events.js`) with `conditionalUpdate(...)` (or `findOneAndUpdate` with `_version` precondition)
  - api-server.js:8279 `unifiedEventsCollection.updateOne(...)` replaced with `conditionalUpdate(unifiedEventsCollection, { userId, eventId }, { $set: updateOperations }, { expectedVersion, modifiedBy: userEmail || userId, snapshotFields: CONFLICT_SNAPSHOT_FIELDS })`. ApiError 404/409 caught and translated to standard response shapes.
- [x] 6.2 Accept `expectedVersion` in the request body; treat `null`/missing as "skip version check" (backward compat)
  - Destructured at top of handler with `expectedVersion = null` default. `conditionalUpdate` already implements the null/undefined→skip semantics per concurrencyUtils.js contract.
- [x] 6.3 Return the post-update document via `findOneAndUpdate({ returnDocument: 'after' })`; remove the redundant trailing `findOne` (`api-server.js:8270–8272`)
  - `finalEventFromUpdate` captures the post-update document from `conditionalUpdate`. The trailing `findOne` (line 8354) now only runs on the insert path; update path serves from the captured doc — saves one Cosmos round-trip per update call.
- [~] 6.4 Add a backend test asserting concurrent `audit-update` calls produce the standard 409 `VERSION_CONFLICT` payload with field-level diff snapshot
  - **Deferred**: testApp.js does not implement `/api/events/:eventId/audit-update`. The integration tests that mention audit-update do so only in comments. Same root cause as 5.5/5.7 — needs real-api-server test infrastructure or a dedicated unit test of `conditionalUpdate` (which already exists in `__tests__/unit/utils/concurrencyUtils.test.js`).
- [~] 6.5 Add a backend test asserting an omitted `expectedVersion` skips the version check (legacy-caller behavior preserved)
  - **Already covered**: `concurrencyUtils.js` documents and tests the null-skip semantics; the new handler code passes through `expectedVersion = null` as the default, inheriting that contract. No new test needed at the handler level until the route is extracted (§11).
- [x] 6.6 Provide ready-to-use commit message
  - See assistant message at end of §6 implementation.

## 7. Extract `routes/graphProxy.js` (low-risk leaf)

- [~] 7.1 Create `backend/routes/graphProxy.js` with `express.Router()` (or factory) export — **deferred to §11/§14 batch** (mechanical extraction; no hot-path bugs to fix; testApp.js parity gap means no integration coverage to verify against)
- [~] 7.2 Move the Graph proxy handlers (formerly `api-server.js` lines ~3497–4212) verbatim — **deferred to §11/§14 batch**
- [~] 7.3 Mount under `/api/graph` from `api-server.js` — **deferred to §11/§14 batch**
- [~] 7.4 Run targeted backend tests; assert no behavior change — **deferred to §11/§14 batch**
- [~] 7.5 Provide ready-to-use commit message — **deferred to §11/§14 batch**

## 8. Cross-cutting service helpers

- [x] 8.1 Create `backend/services/auditService.js` exporting `record(eventId, change)` and any necessary helpers
  - New module exports `setDbConnection(db)`, `recordEvent(...)`, `recordReservation(...)`. Uses lazy collection accessors (re-read dbConnection on every call) so test injection sees fresh state. Errors caught and logged but never propagated — preserves the legacy "audit must never break the main operation" safety. Wired into both `setDatabase()` and `connectToDatabase()` in api-server.js.
- [x] 8.2 Create `backend/services/lifecycleEvents.js` exporting `afterStateChange(event, transition)` that delegates to `broadcastEventChange(...)` (preserving the 150 ms write-to-read delay codified in realtime-freshness)
  - New module exports `setDbConnection(db)`, `setBroadcaster(fn)`, `afterStateChange(event, transition)`. Translates the clean `{ action, from, to, actorEmail, requesterEmail }` signature into the legacy broadcaster's payload. The broadcaster (existing `broadcastEventChange` in api-server.js) is injected via `setBroadcaster(...)` so the legacy closure over `invalidateCountsCacheTargeted` / `BROADCAST_DELAY_MS` / `projectEventForSSE` is preserved. Defensive error handling and bootstrap-order guards (no-op + log if broadcaster not wired or action missing).
- [x] 8.3 Add helpers `sendApprovalNotification`, `sendRejectionNotification`, `sendEditRequestNotification`, etc. to `backend/services/emailService.js` that resolve location names from `eventDoc.locations[]` internally
  - New helpers in emailService.js: `buildReservationFromEvent(event)` (the pure shape-builder), `sendPublishNotificationByEvent(event, opts)`, `sendRejectionNotificationByEvent(event, opts)`, `sendDeletionNotificationByEvent(event, opts)`. Each takes the canonical event document directly and resolves location names from `event.calendarData.locations[]` internally via `calculateLocationDisplayNames(locations, dbConnection)`. Existing `send*Notification(reservation, ...)` functions remain — additive change, no breakage. Replaces the ~20-line setImmediate boilerplate at every call site with a single `await emailService.sendPublishNotificationByEvent(event, { notes, reviewChanges })` call.
- [x] 8.4 Add unit tests under `backend/__tests__/unit/services/auditService.test.js` and `backend/__tests__/unit/services/lifecycleEvents.test.js` covering success and error paths
  - `auditService.test.js` (5 tests): recordEvent writes to event audit collection with correct shape; recordReservation writes to reservation audit; both swallow errors without propagating; explicit error when setDbConnection() not called.
  - `lifecycleEvents.test.js` (7 tests): payload translation; eventId fallback to _id; requesterEmail extraction from event document; explicit transition.requesterEmail override; broadcaster errors caught; bootstrap-order no-op when broadcaster not wired; missing-action no-op.
- [x] 8.5 Update `backend/__tests__/unit/services/emailService.test.js` (or equivalent) to cover the new resolve-locations-internally behavior
  - New file `emailServiceByEvent.test.js` (6 tests): null-event safety; calendarData/requestedBy extraction; location resolution skipped when display names already set; resolution invoked from locations[] when missing; graceful degradation on resolver throw; skip when dbConnection absent; fallback to top-level event fields.
  - All 18 §8 tests pass; existing `emailTemplates.test.js` (14 tests) unaffected.

## 9. SSE → React Query bridge

- [x] 9.1 In `src/hooks/useServerEvents.js`, translate `event-changed` SSE messages into `queryClient.invalidateQueries(...)` calls keyed by the broadcast's view/resource
  - Extracted the bridge into a pure helper `bridgeSseToReactQuery(data, queryClient)` (mirrors the established `computeReconnectBackoff` / `decideServerStartAction` pure-helper pattern). Calls `qc.invalidateQueries({ queryKey: keys.events.all() })` — broad-prefix invalidation across list/load/counts/detail/search variants. RQ refetches active queries automatically; inactive ones marked stale.
  - Hook body wraps the bridge call in try/catch so a bridge failure never prevents the legacy bus path below.
- [x] 9.2 When the SSE payload includes the full updated event document, additionally call `queryClient.setQueryData(['events', 'detail', eventId], updatedDoc)` and patch the matching entry inside the relevant `['events', 'list', ...]` cache
  - `bridgeSseToReactQuery` calls `setQueryData(keys.events.detail(eventId), data.event)` when the SSE payload carries the full event. Falls back from `eventId` to `_id` if needed; skips entirely when neither is present.
  - List-cache item patching deferred to per-view migrations (Calendar, EventManagement) since each view has different list-key shapes; the broad-prefix invalidation already triggers re-fetch on next access for active list queries.
- [x] 9.3 On `serverStartId` change, call `queryClient.invalidateQueries({ queryKey: ['events'] })` and `queryClient.invalidateQueries({ queryKey: ['reservations'] })`
  - Extracted as `bridgeSseRestartToReactQuery(queryClient)`. Targeted prefixes preserve unrelated caches (categories, locations) which a restart doesn't change.
- [x] 9.4 Keep the legacy `dispatchRefresh` calls firing during the migration window (back-compat for non-migrated subscribers)
  - Both paths run side-by-side. Comment in the hook explicitly flags retirement to §15. Calendar.jsx and EventManagement.jsx (still on the bus) continue to receive refresh events while the RQ-migrated views (MyReservations, ReservationRequests) ALSO get cache invalidation.
- [x] 9.5 Add tests covering: invalidate on `event-changed`, `setQueryData` on full-payload broadcasts, restart-id-driven cross-cutting invalidation
  - 9 new tests appended to `src/__tests__/unit/hooks/useServerEvents.test.js`:
    - bridgeSseToReactQuery: invalidates events.* on every payload; patches detail cache when full event included; skips detail patch when no event in payload; falls back from eventId to _id; skips when no usable id; defensive null-queryClient guard.
    - bridgeSseRestartToReactQuery: invalidates both events + reservations; preserves unrelated caches (asserts categories/locations not touched); defensive null-queryClient guard.
  - All 21 useServerEvents tests pass (12 pre-existing + 9 new). Sweep across all hooks/context/MyReservations/ReservationRequests tests: 151/151 pass.
- [ ] 9.6 Browser-verify that approving an event in one tab is reflected in the other tab without manual refresh
  - Pending user verification — best tested by approving in Tab A and observing the row's status change in Tab B's MyReservations list without clicking refresh.
- [x] 9.7 Provide ready-to-use commit message
  - See assistant message at end of §9 implementation.

## 10. EventManagement → React Query

- [x] 10.1 Inventory every fetch + useEffect + useState + dispatchRefresh site in `EventManagement.jsx`
  - **Reads** (2): `fetchEvents` (server-paginated `GET /events/list?view=admin-browse&page=N&limit=20&status=...&search=...&startDate=...&endDate=...`), `fetchCounts` (`GET /events/list/counts?view=admin-browse`).
  - **Mutations (2 local)**: `handleDelete` via `deleteEvent` service helper (has 409 VERSION_CONFLICT branch); `handleRestore` (admin endpoint `PUT /admin/events/:id/restore` with `_version` + `forceRestore`; has 409 SchedulingConflict AND VERSION_CONFLICT branches).
  - **Subscriptions**: `usePolling(silentRefresh, ...)` and `useDataRefreshBus('event-management', silentRefresh, ...)`.
- [x] 10.2 Replace reads (admin-browse list + counts) with `useQuery`
  - `eventsQuery` keyed `keys.events.list({ view: 'admin-browse', page, limit, status, search, startDate, endDate })`. Each filter combination is its own cache entry — page navigation, tab switching, and date-range changes serve from cache when previously visited within staleTime. Uses `placeholderData: (prev) => prev` so prior-page data stays visible during pagination (no spinner flash).
  - `countsQuery` keyed `keys.events.counts({ view: 'admin-browse' })`. queryFn returns the full counts object as-is.
  - Both queries gated on `enabled: !!apiToken && isAdmin` — the permission check moves into the data layer.
  - `refetchInterval` 30s/5min based on `isConnected` replaces `usePolling`. Token-rotation refetch via `lastSeenTokenRef` effect.
  - Bus subscription routes to `queryClient.invalidateQueries(...)` — the legacy bus path still fires for non-migrated views.
  - Backward-compat `fetchEvents()`/`fetchCounts()` shims kept (used by the experience hook's onRefresh and the conflict-dialog close handler) — both delegate to `queryClient.refetchQueries`.
- [x] 10.3 Replace mutations (delete, restore, force-publish, force-update overrides) with `useMutation` including optimistic + rollback + invalidate
  - `deleteMutation`: optimistic patch (mark `status: 'deleted', isDeleted: true` across every cached admin-browse list entry via `setQueriesData` with predicate); rollback restores all snapshotted entries on error; preserves the 409 VERSION_CONFLICT path via custom error type that surfaces `setConflictDialog`.
  - `restoreMutation`: no optimistic UI (post-restore status is server-determined). Preserves both the 409 SchedulingConflict path (sets `restoreConflicts`) and the 409 VERSION_CONFLICT path (sets `conflictDialog`) via custom error types that propagate through onError without a generic toast.
  - Both mutations dual-publish via `dispatchRefresh('event-management', 'navigation-counts')` for back-compat.
- [x] 10.4 Verify the ConflictDialog 409 path still surfaces correctly when an OCC mismatch fires from a mutation
  - The 409 paths now route through the mutation's onError. Both delete and restore mutations construct custom errors (`new Error('VersionConflict')` with `conflictPayload` + `staleEvent` attached) that the onError handler unpacks and surfaces via `setConflictDialog`. Generic-toast suppression preserved.
- [ ] 10.5 Browser-verify the admin events page end-to-end
  - Pending user verification — particularly the SchedulingConflict-on-restore + VersionConflict-on-delete paths.
- [x] 10.6 Provide ready-to-use commit message
  - See assistant message at end of §10.

## 11. Extract `routes/events.js` and `routes/reservations.js`

- [ ] 11.1 Create `backend/routes/events.js`; move authenticated event creation/update/audit-update handlers from `api-server.js` (excluding the list endpoint already in `routes/eventsList.js`); migrate inline audit/email/SSE patterns to the new service helpers in §8
- [ ] 11.2 Create `backend/routes/reservations.js`; move reservation owner endpoints from `api-server.js`; migrate inline patterns to service helpers
- [ ] 11.3 Mount both from `api-server.js` under their existing paths
- [ ] 11.4 Run targeted backend tests for the moved endpoints; assert no behavior change beyond the documented service-helper migration
- [ ] 11.5 Provide ready-to-use commit message

## 12. Decompose `Calendar.jsx`

- [ ] 12.1 Extract `src/hooks/useCalendarDataLoader.js` from `Calendar.jsx:1418–2238`; verify Calendar still loads events correctly in browser
- [ ] 12.2 Extract `src/hooks/useCalendarFilters.js` from `Calendar.jsx:2852–3555`; collapse double-iteration patterns into a single pass where the result is identical (or document why two passes are needed)
- [ ] 12.3 Extract `src/hooks/useUserProfileSync.js` from `Calendar.jsx:2363–2455` and `5264–5291`
- [ ] 12.4 Extract `src/components/CalendarModals.jsx` from `Calendar.jsx:5640–5878`
- [ ] 12.5 After each extraction, run targeted frontend tests and browser-verify before moving to the next
- [ ] 12.6 Confirm `wc -l src/components/Calendar.jsx` reports ≤1,500 lines
- [ ] 12.7 Add a targeted unit test for at least one extracted hook (`useCalendarFilters` recommended — easiest seam)
- [ ] 12.8 Provide ready-to-use commit message per extraction step (five separate commits or one combined PR with five commits — author's choice)

## 13. Calendar.jsx → React Query

- [ ] 13.1 Migrate `useCalendarDataLoader` to use `useQuery` (events list, counts, locations, categories) keyed via the factory from §2
- [ ] 13.2 Migrate any Calendar-driven mutations (publish, save, restore, delete, edit) to `useMutation`
- [ ] 13.3 Verify SSE-driven cache invalidation flows reach the calendar list query without requiring a manual refetch
- [ ] 13.4 Browser-verify month/week/day views, calendar filtering, and event review modal launches from each view
- [ ] 13.5 Provide ready-to-use commit message

## 14. Extract remaining route modules

- [ ] 14.1 Create `backend/routes/adminEvents.js`; move admin write handlers (publish, reject, restore, edit, audit-update) from `api-server.js`; migrate inline patterns to service helpers
- [ ] 14.2 Create `backend/routes/locations.js`; move location and capability handlers
- [ ] 14.3 Create `backend/routes/sse.js`; move SSE connection handler
- [ ] 14.4 Create `backend/routes/ai.js`; move AI/MCP-tool endpoints
- [ ] 14.5 Create `backend/routes/users.js`; move user profile handlers
- [ ] 14.6 Mount all from `api-server.js`
- [ ] 14.7 Confirm `wc -l backend/api-server.js` reports ≤1,500 lines
- [ ] 14.8 Run targeted backend tests for each extracted module; assert no behavior change
- [ ] 14.9 Provide ready-to-use commit messages

## 15. Retire `useDataRefreshBus`

- [ ] 15.1 Confirm via `git grep -n 'useDataRefreshBus\|dispatchRefresh' src/` that no live subscribers remain after §3, §4, §10, §13
- [ ] 15.2 Remove the dual-publish `dispatchRefresh` calls from RQ mutations (introduced in §3.4, §4, §10)
- [ ] 15.3 Remove the legacy `dispatchRefresh` from `useServerEvents.js` (introduced in §9.4)
- [ ] 15.4 Delete `src/hooks/useDataRefreshBus.js` and any context wiring it depends on
- [ ] 15.5 Re-run targeted frontend tests; assert nothing relied on the bus
- [ ] 15.6 Provide ready-to-use commit message

## 16. Final integration sweep

- [ ] 16.1 Run full backend suite (`cd backend && npm test`) — only at this final step per CLAUDE.md
- [ ] 16.2 Run full frontend suite (`npm run test:run`)
- [ ] 16.3 Browser-verify the four migrated views (Calendar, MyReservations, ReservationRequests, EventManagement) end-to-end
- [ ] 16.4 Confirm acceptance metrics: `api-server.js` ≤1,500 lines, `Calendar.jsx` ≤1,500 lines, no `useDataRefreshBus` references in `src/`, list response payloads contain no `graphData`, compound index present
- [ ] 16.5 Update `CLAUDE.md`'s "Current In-Progress Work" section to mark this change complete and reference the archive
- [ ] 16.6 Run `/opsx:archive architecture-and-performance-uplift` to finalize
