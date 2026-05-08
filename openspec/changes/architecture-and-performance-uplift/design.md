## Context

Two structural pressures shape this change:

1. **Backend monolith.** `backend/api-server.js` is 26,152 lines containing 198+ Express routes. Audit insertion, email composition, SSE broadcasting, location resolution, and Graph synchronization are duplicated across 14–21 sites each. Section banner comments at lines `3483, 4205, 8656, 18430, 19472, 22245` already mark the seams a future split would follow. Concrete hot-path defects have accumulated: `POST /api/events/load` issues sequential per-calendar Graph requests inside a `for ... await` loop (lines 6393–6619); `GET /api/events/list` performs a JavaScript-side sort on up to 1,000 documents (line 7489) because of "Cosmos DB index limitations"; `POST /api/events/:eventId/audit-update` writes via a bare `updateOne` (line 8195) — bypassing `conditionalUpdate()` and the OCC contract every other write endpoint participates in — and follows it with a redundant `findOne` (lines 8270–8272).
2. **Frontend data-flow inertia.** `@tanstack/react-query@5` is installed with a fully configured `queryClient` (`src/config/queryClient.js`) including sessionStorage persistence, 5 min staleTime, 30 min gcTime, refetchOnWindowFocus, and 24 h cache-age cap. It is consumed in three files: `useCategoriesQuery.js`, `useLocationsQuery.js`, and `EventSearch.jsx`. Every other view — `Calendar.jsx` (5,878 lines, 33 useStates), `MyReservations.jsx`, `ReservationRequests.jsx`, `EventManagement.jsx` — uses `useAuthenticatedFetch` + `useEffect` + `useState` + a custom `useDataRefreshBus` event channel. SSE arrives through `useServerEvents`, which calls `dispatchRefresh(...)`, which fans out to component subscribers, which then call their bespoke fetch routines. The result is visible UI churn (spinners, full reloads) on every tab switch and every approve/reject/edit action. Render hygiene problems compound this: `LocationContext.jsx:182` returns a fresh object literal each render, cascading re-renders into `Calendar`, `RoomReservationFormBase`, and `SchedulingAssistant`; ~20 pure utility functions live inside `useCallback` in `Calendar.jsx` despite closing over no state; `MonthView` receives a fresh `getDatabaseLocationNames()` call per render at `Calendar.jsx:5516`.

The design problem is not "what new system to build" but "how to adopt the systems we already have, in an order that does not destabilize 523 backend + 189 frontend tests, and that produces visible UX gains early."

## Goals / Non-Goals

**Goals:**
- Tab switches and CRUD actions across `MyReservations`, `ReservationRequests`, `EventManagement`, and `Calendar` feel instant — cache-served reads and optimistic mutations replace spinner-and-reload cycles.
- `backend/api-server.js` shrinks below 1,500 lines (orchestration only); each route module is independently editable, reviewable, and testable.
- Hot-path latencies on `POST /api/events/load` and `GET /api/events/list` drop materially: parallel Graph fetches, projection-trimmed payloads, conditional enrichment, indexed sort.
- The OCC contract is uniform — no write endpoint bypasses `conditionalUpdate()`.
- Audit, email, and SSE responsibilities live in one place each, so handlers stop duplicating them.
- Existing tests stay green throughout the migration; new tests cover the changed contracts.

**Non-Goals:**
- No change to event semantics, status machine, OCC version contract, recurring-event document model, permission rules, or auth flow.
- No new external dependencies (TanStack Query is already installed).
- No rewrite of `RoomReservationFormBase.jsx` or `SchedulingAssistant.jsx` — they are large but functional and out of scope here.
- No frontend framework change, no router change, no styling overhaul.
- No public API shape change; only the `GET /api/events/list` payload shrinks (drops `graphData`), which is consistent with documented usage (callers fetch `graphData` from the detail endpoint).

## Decisions

### Decision 1: Client cache adopts TanStack Query everywhere; `useDataRefreshBus` retires

**Choice:** Migrate every server-data fetch in `MyReservations`, `ReservationRequests`, `EventManagement`, and `Calendar` to `useQuery` / `useMutation`. Retire `useDataRefreshBus` once all subscribers have moved.

**Rationale:** The infrastructure is already in place (`queryClient.js` with persistence). The custom event bus duplicates what RQ's `invalidateQueries` already provides, but without the cache, the optimistic-update primitives, the deduplication, the focus refetch, or the persistence story. Keeping both indefinitely doubles the surface area.

**Alternatives considered:**
- *SWR:* same shape, but RQ is already chosen and configured. No reason to swap.
- *Hand-rolled Map cache + custom subscriber model:* what `useDataRefreshBus` already approximates. Has none of RQ's lifecycle handling.
- *Keep both layers permanently:* viable but doubles the mental model and leaves the bus as a parallel source of truth that drifts from the cache.

### Decision 2: SSE bridges into RQ via `queryClient.invalidateQueries` (and selective `setQueryData`)

**Choice:** `useServerEvents` consumes `event-changed` broadcasts and translates them into `queryClient.invalidateQueries({ queryKey: ['events', ...] })` for list/queue queries, plus targeted `setQueryData` for single-event updates when the SSE payload carries the full updated document. The custom `dispatchRefresh` exit retires.

**Rationale:** A push from the server should mark cache entries stale, not force every subscribed component to refetch independently. RQ then resolves "should we actually go to the network" based on which queries are mounted, focused, and stale. Targeted `setQueryData` for single-event updates avoids a refetch entirely in the common case.

**Alternatives considered:**
- *Always refetch on broadcast:* the current behavior. Wastes a network round-trip in cases where the broadcast already contains the data.
- *Push full snapshots through SSE and never refetch:* the SSE payload is not always a full normalized event; some broadcasts deliver only `{ eventId, action }`. Mixing strategies (setQueryData when full payload, invalidate when partial) preserves correctness.

### Decision 3: Backend split is a `git mv`-shaped extraction along existing seams

**Choice:** Extract `routes/graphProxy.js`, `routes/events.js`, `routes/eventsList.js`, `routes/reservations.js`, `routes/adminEvents.js`, `routes/locations.js`, `routes/sse.js`, `routes/ai.js`, `routes/users.js`. Each is an `express.Router()` mounted from `api-server.js`. Move handlers verbatim — same dependencies, same logic, same tests pass before and after.

**Rationale:** A logic refactor combined with a file split is two unrelated risks compounded. Doing the move first (handler logic identical) is a low-risk, mechanical change that immediately makes future logic refactors smaller and safer. The seam comments already in `api-server.js` are the natural cut lines.

**Alternatives considered:**
- *NestJS / module-based rewrite:* large effort, no near-term UX payoff, deviates from the rest of the stack.
- *Logical refactor first (DRY audit/email/SSE), then split:* would touch the monolith twice. Splitting first means each subsequent refactor lands in a smaller, focused file.

### Decision 4: Hot-path fixes ride along with the route split, in the same module

**Choice:** When `routes/eventsList.js` is extracted, apply five hot-path fixes in the same change:
- `POST /api/events/load`: replace the `for (...) await graphApi(...)` loop with `await Promise.allSettled([...])`. Failed calendars degrade to "no events from this calendar" with logged warning, matching today's per-call error-tolerant behavior.
- `POST /api/events/load` and `GET /api/events/list`: gate `enrichSeriesMastersWithOverrides` on `mastersFound > 0`. The retry-on-cold-Cosmos-metadata path stays untouched.
- `GET /api/events/list`: add MongoDB compound index `(status: 1, calendarData.startDateTime: 1)` (idempotent `createIndex`). Move sort from JS into the Mongo query. Add projection that excludes `graphData` from the list response.
- `POST /api/events/:eventId/audit-update`: replace the bare `updateOne` with `conditionalUpdate(..., { expectedVersion })`. Collapse the trailing `findOne` into the `conditionalUpdate` return value (which already returns the post-image when implemented through `findOneAndUpdate`).

**Rationale:** These are line-level fixes the backend audit already located. Bundling them with the route extraction means one PR per module, and the move + fix are visible together. Splitting them across multiple PRs costs review attention without reducing risk.

**Alternatives considered:**
- *Fix hot paths first, then split:* doable, but doubles the time the monolith is live. Splitting first lets the fix land in a 500-line file rather than a 26K-line one.

### Decision 5: Cross-cutting helpers — small, opinionated, opt-in

**Choice:** Three new (or expanded) services with narrow surfaces:
- `backend/services/auditService.js`: exports `record(eventId, { changeType, oldValue, newValue, userId, ... })`. Wraps the 14 inline audit insertion patterns.
- `backend/services/emailService.js` (existing): add `sendApprovalNotification(eventDoc)`, `sendRejectionNotification(eventDoc)`, `sendEditRequestNotification(eventDoc)`, etc., that resolve location names from the event's `locations[]` internally instead of the caller pre-resolving them.
- `backend/services/lifecycleEvents.js`: exports `afterStateChange(event, transition)` which broadcasts SSE and runs any other post-write side effects in one place. Handlers call this exactly once after `res.json()`.

Handlers are not retrofitted in a sweep — they migrate as their containing routes are extracted. New code MUST use the helpers.

**Rationale:** Forcing immediate retrofit of 14–21 sites would require a parallel diff that bloats the route-split PRs. Migrating per-route as we touch each handler keeps each change reviewable. The "new code must use the helper" rule prevents regression while migration is in flight.

**Alternatives considered:**
- *Big-bang sweep across the monolith:* high diff volume, hard to review.
- *Class-based service hierarchy:* heavier than needed. The handlers are stateless functions; plain exported functions match the rest of the codebase.

### Decision 6: Render hygiene — three micro-fixes, then `Calendar.jsx` decomposition

**Choice:** Land the three micro-fixes (LocationContext memo, Calendar.jsx pure utils to module scope, MonthView prop memo) in one small PR — they are 5-line changes with broad ripple. Then decompose `Calendar.jsx` in five sequential steps:
1. Extract `src/utils/calendarEventUtils.js` (pure functions, currently `Calendar.jsx:1127–1370`).
2. Extract `src/hooks/useCalendarDataLoader.js` (currently `Calendar.jsx:1418–2238`).
3. Extract `src/hooks/useCalendarFilters.js` (currently `Calendar.jsx:2852–3555`).
4. Extract `src/hooks/useUserProfileSync.js` (currently `Calendar.jsx:2363–2455` + `5264–5291`).
5. Extract `src/components/CalendarModals.jsx` (currently `Calendar.jsx:5640–5878`).

Target: `Calendar.jsx` shell at ~1,500 lines of orchestration.

**Rationale:** Pure utilities first is the lowest-risk extraction (no React semantics). Hooks come next because they have clean state-shape boundaries. Modals last because they touch the largest set of props and event handlers. RQ migration can begin in parallel once `useCalendarDataLoader` is its own file.

**Alternatives considered:**
- *Decompose first, RQ-migrate second:* viable but pushes the visible UX win further out.
- *RQ-migrate inside the monolith Calendar.jsx:* possible, but hard to review (every diff sits in a 5,878-line file).

### Decision 7: Migration order optimizes for early UX wins

**Choice:** Apply in this order:
1. **Render hygiene micro-fixes** (LocationContext memo + Calendar pure utils to module scope + MonthView prop memo).
2. **`MyReservations` → RQ** (smallest surface, clear mutations).
3. **`ReservationRequests` → RQ** (next-smallest, similar shape).
4. **Hot-path fixes + extract `routes/eventsList.js` + `routes/graphProxy.js`** (high-leverage backend, low-risk leaves).
5. **SSE → RQ bridge** (rewires `useServerEvents`; old bus stays alive but unused for a release).
6. **`EventManagement` → RQ.**
7. **Extract `routes/events.js` and `routes/reservations.js`** (the larger middle).
8. **`Calendar.jsx` decomposition steps 1–5.**
9. **`Calendar.jsx` → RQ migration** (largest payoff, highest blast radius — done last).
10. **Extract `routes/adminEvents.js`, `routes/locations.js`, `routes/sse.js`, `routes/ai.js`, `routes/users.js`.**
11. **Retire `useDataRefreshBus`** once no subscribers remain.

**Rationale:** Steps 1–3 deliver visible UX gains in a few weeks. Backend hot-path fixes (4) reduce the worst-case latency that survives even after caching. SSE bridge (5) lets caches stay warm rather than invalidate-and-refetch. Calendar work (8–9) is the riskiest and is sequenced after the team has built fluency on the smaller views.

## Risks / Trade-offs

- **[Cache staleness for non-RQ-aware mutations during migration]** → While some views are on RQ and others on the bus, a write through one path may not invalidate the other. **Mitigation:** for the duration of the migration, dual-publish — RQ mutations also call `dispatchRefresh` for back-compat, and the SSE bridge invalidates RQ keys. Remove dual-publish in step 11.
- **[`graphData` removal from list response breaks an undocumented caller]** → A component or test may be reading `graphData` off list payloads despite the documented pattern. **Mitigation:** grep for `graphData` reads in components consuming `/api/events/list` before the projection lands; add a temporary feature flag if the grep finds anything.
- **[Compound index creation on Cosmos]** → Cosmos index builds are not always free; on a busy collection they can briefly elevate RU usage. **Mitigation:** create the index off-peak (e.g., overnight); the create call is idempotent so re-deploys do not re-build.
- **[OCC introduction in `audit-update` causes 409s in flows that previously couldn't conflict]** → Some callers may not currently send `expectedVersion`. **Mitigation:** support `expectedVersion: null` to skip the version check (matches the pattern documented in MEMORY) — preserves backward compatibility while new code adopts the contract.
- **[Route-extraction PRs each carry the full Express middleware wiring concern]** → If two route modules need the same middleware, where does it live? **Mitigation:** middleware stays in `api-server.js` (auth, body parsing, error handling); route modules export only routers. No middleware duplication.
- **[Calendar.jsx decomposition introduces hook-extraction bugs]** → Refs and effects can subtly change behavior when moved across hook boundaries. **Mitigation:** decompose in five small steps, run `npm test` (frontend) after each step, and exercise the calendar in a browser between extractions. Each extraction is reverted independently if a regression appears.
- **[Sequential-to-parallel Graph fetch changes error-mode coupling]** → `Promise.all` would surface one calendar's failure as the whole call failing; `Promise.allSettled` preserves today's tolerant behavior but logs differently. **Mitigation:** use `allSettled`; treat each rejected calendar as "no events from that source" with a structured warning log, matching today's per-call try/catch.
- **[Test count grows]** → Each new contract (RQ patterns, SSE bridge, OCC on audit-update, parallel Graph) needs coverage. **Mitigation:** add tests as part of each step's PR; do not run the full suite per change (per CLAUDE.md rule); rely on per-file targeted runs and final integration sweep.

## Migration Plan

1. Land the three render-hygiene micro-fixes as a single small PR. Smoke-test in browser; targeted `Calendar`/`MonthView` tests.
2. Migrate `MyReservations` to RQ. Add per-component tests for the new query/mutation patterns. Browser-verify Edit / Delete / Restore flows.
3. Migrate `ReservationRequests` to RQ. Browser-verify Approval Queue end-to-end.
4. Open the `eventsList` extraction PR: move handler to `routes/eventsList.js`, apply parallel Graph fetch, conditional enrichment, projection, and the compound index. Run targeted backend tests for `/api/events/list` and `/api/events/load`. Browser-verify Calendar and Approval Queue still load.
5. Add OCC to `audit-update` in a focused PR. Targeted unit tests.
6. Open the `routes/graphProxy.js` extraction PR (lowest-risk leaves first to build muscle memory).
7. Bridge SSE to RQ in `useServerEvents`. Keep `dispatchRefresh` calling for back-compat. Targeted tests for the bridge.
8. Migrate `EventManagement` to RQ. Browser-verify admin event browser.
9. Extract `routes/events.js`, `routes/reservations.js`. Targeted backend tests per extracted endpoint.
10. Decompose `Calendar.jsx` in five steps (utils → loader → filters → profile sync → modals). Frontend tests after each.
11. Migrate `Calendar.jsx` to RQ.
12. Extract remaining route modules (`adminEvents`, `locations`, `sse`, `ai`, `users`).
13. Once no `useDataRefreshBus` subscribers remain, retire the file. Remove the dual-publish layer from RQ mutations.
14. Final full-suite sweep (`npm test` backend + frontend) before declaring the change archive-ready.

**Rollback:** Each step is its own PR with a clean revert. The three risky steps (compound index, OCC on audit-update, SSE bridge) are reversible without data implications because: index drop is idempotent, OCC accepts `expectedVersion: null` so legacy callers never broke, and the SSE bridge can be flag-disabled to fall back to dispatchRefresh-only behavior.

## Open Questions

- Should the SSE-to-RQ bridge live inside `useServerEvents` (closer to the existing connection logic) or a separate `useSSEQueryBridge` hook (cleaner separation)? Leaning toward a separate hook for testability.
- Do we want to introduce a typed `queryKey` factory (e.g., `keys.events.list({ view, ...filters })`) before the migration, or after? A factory upfront prevents key-shape drift; deferring lets the migration teach us what shapes we actually need. Leaning toward "introduce a minimal factory in step 2 and grow it as we go."
- For the route extraction, do we want one shared `routes/index.js` that mounts all routers, or do we keep mounts in `api-server.js`? Leaning toward keeping mounts in `api-server.js` so the bootstrap file stays the source of truth for what's served.
- Compound index: should it be `(status, calendarData.startDateTime)` (current proposal) or `(calendarOwner, status, calendarData.startDateTime)` (would also serve calendar-scoped queries)? Need a query-shape audit on `routes/eventsList.js` extraction to decide.
