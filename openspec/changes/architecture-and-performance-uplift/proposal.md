## Why

The app is functionally complete but architecturally strained. `backend/api-server.js` is a 26,152-line monolith with 198+ routes; `src/components/Calendar.jsx` is 5,878 lines with 33 useState calls. The TanStack Query infrastructure is installed (with sessionStorage persistence) but used in only three files — most data flows through bespoke `fetch + useEffect + useState + custom event bus` chains that produce visible "spinner-and-reload" friction on every tab switch and every approve/reject/edit action. Concrete hot-path bugs (sequential Graph API loop in `POST /api/events/load`, OCC bypass in `audit-update`, redundant `findOne` after `updateOne`, unbounded client-side sort, and full `graphData` payloads on list responses) compound the perceived sluggishness. Together these block the seamless UX goal and tax every future feature with monolith-gravity. This change captures a coherent uplift — adopt what is already wired up, extract what is already seam-marked, and fix the specific hot-path defects already identified — without a speculative rewrite.

## What Changes

- **Migrate read/write data flows to TanStack Query** in `MyReservations`, `ReservationRequests`, `EventManagement`, and `Calendar` (≈13 fetch+useEffect pairs and ≈8 mutations). Replace ad-hoc loading state with cached queries and optimistic mutations. Stale-while-revalidate on tab switch.
- **Bridge SSE to the query cache.** Rewire `useServerEvents` / `useDataRefreshBus` so server events call `queryClient.invalidateQueries` (or `setQueryData` for targeted updates) instead of broadcasting to a custom bus that components manually subscribe to. **BREAKING** for any component still listening to the old bus events — they must migrate to React Query subscriptions.
- **Split `backend/api-server.js` into route modules** along the seam markers already present in the file: `routes/graphProxy.js`, `routes/events.js`, `routes/eventsList.js`, `routes/reservations.js`, `routes/adminEvents.js`, `routes/locations.js`, `routes/sse.js`, `routes/ai.js`, `routes/users.js`. `api-server.js` becomes a ~1K-line bootstrap. No handler logic changes during the move.
- **Fix hot-path defects** in event list/load endpoints:
  - `POST /api/events/load`: parallelize the per-calendar Graph fetch loop with `Promise.allSettled`.
  - `POST /api/events/load` and `GET /api/events/list`: skip `enrichSeriesMastersWithOverrides` when no series masters are present; add MongoDB compound index on `(status, calendarData.startDateTime)` and projection that excludes `graphData` from list responses.
  - `POST /api/events/:eventId/audit-update`: wrap the write in `conditionalUpdate()` to restore OCC; collapse the redundant `findOne` after `updateOne` into a single `findOneAndUpdate({returnDocument:'after'})`.
- **Centralize cross-cutting write concerns** behind small services so handlers stop duplicating them:
  - `auditService.record(eventId, change)` replaces the 14 inline `auditCollection.insertOne(...)` blocks.
  - `emailService.sendXxx(eventDoc)` resolves location names internally instead of each caller reassembling reservation payloads.
  - `lifecycleEvents.afterStateChange(event, transition)` runs the SSE broadcast in one consistent place after `res.json()`.
- **Tighten frontend render hygiene** with three targeted micro-fixes:
  - Wrap `LocationContext` value in `useMemo` (`src/context/LocationContext.jsx:182`) to stop cascade re-renders into `Calendar` / `RoomReservationFormBase` / `SchedulingAssistant`.
  - Move ≈20 pure utility functions out of `useCallback` inside `Calendar.jsx` to module scope so `WeekView` / `DayView` / `MonthView` memoization actually pays off.
  - Memoize the inline `getDatabaseLocationNames()` argument passed to `MonthView` (`Calendar.jsx:5516`).
- **Decompose `Calendar.jsx`** into five extracted units in priority order: `useCalendarDataLoader`, `useCalendarFilters`, `calendarEventUtils` (module-scope pure functions), `useUserProfileSync`, `CalendarModals`. Component shell shrinks from 5,878 lines toward ~1,500 lines of orchestration.

Out of scope: any behavior change to event semantics, status machine, OCC contract, recurring-event architecture, or permission rules. This change reshapes how data is fetched, cached, broadcast, and rendered — not what the data means.

## Capabilities

### New Capabilities
- `client-data-cache`: TanStack Query as the canonical client-side cache for all server data. Defines query-key conventions, mutation patterns (optimistic + rollback), the SSE-to-cache invalidation bridge, and the migration policy that retires `useDataRefreshBus`.
- `backend-route-modules`: Express route extraction convention for `api-server.js`. Defines the file/router layout, the per-module mounting contract, the rule that a route's logic must not change during extraction, and the seam-by-seam migration order.
- `event-list-performance`: Hot-path performance contract for `POST /api/events/load`, `GET /api/events/list`, and `POST /api/events/:eventId/audit-update`. Codifies parallelism, projection, OCC participation, conditional enrichment, and the supporting index.
- `write-path-services`: Cross-cutting write helpers (`auditService`, `emailService`, `lifecycleEvents`) that handlers must use instead of inlining audit insertion, email composition, or SSE broadcasts.
- `frontend-render-hygiene`: Render-stability rules — context value memoization, pure utilities at module scope, stable props into memoized children, and the `Calendar.jsx` decomposition target.

### Modified Capabilities
- `realtime-freshness`: SSE delivery semantics change from "broadcast → custom event bus → component refetch" to "broadcast → query cache invalidate / setQueryData". Subscribers move from `useDataRefreshBus` to React Query.

## Impact

- **Code**: `backend/api-server.js` (split), new `backend/routes/*.js`, new `backend/services/auditService.js` and `backend/services/lifecycleEvents.js`, additions to `backend/services/emailService.js`, `src/components/Calendar.jsx` (decompose), `src/components/MyReservations.jsx`, `src/components/ReservationRequests.jsx`, `src/components/EventManagement.jsx` (RQ migration), `src/context/LocationContext.jsx` (memo fix), `src/hooks/useServerEvents.js` (RQ bridge), retire `src/hooks/useDataRefreshBus.js`.
- **APIs**: No request/response shape changes for callers. List response payload shrinks (no `graphData`) — clients reading `graphData` from the list endpoint must already use the detail endpoint, which is the documented pattern.
- **Database**: New compound index `(status, calendarData.startDateTime)` on `templeEvents__Events`. No schema changes.
- **Dependencies**: No additions. TanStack Query 5 is already installed.
- **Tests**: Existing 523 backend + 189 frontend tests must remain green. New tests for OCC restoration in audit-update, parallel Graph fetch error handling, and the SSE→RQ bridge.
- **Migrations**: None. Index creation is additive and idempotent.
