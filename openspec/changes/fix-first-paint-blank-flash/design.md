## Context

Three list-style views — `MyReservations`, `ReservationRequests`, and (after the in-flight `architecture-and-performance-uplift` change) `Calendar` — render their main content based on a `loading` flag derived from a TanStack Query result. Today, `MyReservations` and `ReservationRequests` derive `loading` from `query.isLoading`. In TanStack Query v5, `isLoading` is defined as `(status === 'pending') && (fetchStatus === 'fetching')`. When a query has `enabled: !!apiToken` and `apiToken` flips from `null` to a token, the query transitions in two ticks: first to `status: 'pending', fetchStatus: 'idle'`, then to `status: 'pending', fetchStatus: 'fetching'`. During the first tick, `isLoading === false` and `data === undefined`. Components that key their spinner gate off `isLoading` therefore render the empty-state branch (`!loading && data.length === 0`) for one render cycle before the spinner takes over.

The Calendar uses imperative `useState` for `initializing` and `loading`, not TanStack Query. Its overlay shows whenever `initializing || isNavigating || loading` is true. The `initializeApp` happy path correctly batches `setLoading(true); setInitializing(false)` so the overlay stays continuous. The error path at lines 2360-2367 of `Calendar.jsx` only sets `setInitializing(false)` and clears the timeout — `loading` stays `false`, the overlay disappears, and the empty calendar grid is visible until the consolidated effect later sets `loading` back to `true` via `loadEvents`.

The codebase already has the correct primitive used in one place: `ReservationRequests.jsx:217` derives `countsLoaded = !countsQuery.isPending`. The bug is that the same file's main `loading` binding (line 204) uses `isLoading`. The convention is partially adopted — this change makes it consistent and codifies it.

The in-flight `architecture-and-performance-uplift` proposal will migrate `EventManagement` and the Calendar's event list to TanStack Query. Whatever pattern this change establishes must be the pattern those migrations follow, otherwise the bug will be reintroduced under a different file path.

Existing infrastructure relevant to this design:
- TanStack Query v5 with sessionStorage persistence (already wired up).
- `LoadingSpinner` component (`src/components/shared/LoadingSpinner.jsx`).
- `AppSkeleton` (in `App.jsx`, shown when `!isInitialized`) — operates one level higher than this change and is unaffected.
- Stale-write guards inside `MyReservations.jsx` and `ReservationRequests.jsx` `queryFn` bodies that already prevent zero-length refetches from blanking populated state.
- `permissionsLoading` from `RoleSimulationContext` — gate before these views render. Already correct (returns spinner).

## Goals / Non-Goals

**Goals:**

- Eliminate the blank/empty-state flash on first paint of `MyReservations`, `ReservationRequests`, and (via the same convention) any future TanStack Query consumer.
- Codify a single project-wide convention for first-load gating that is unambiguous, two-word small, and discoverable in `CLAUDE.md`.
- Keep the Calendar's overlay continuously visible across the init-error → consolidated-effect-load handoff.
- Land as a small, low-risk surgical fix: ≤ 5 production-code line changes plus targeted tests.
- Compatible forward path for the `EventManagement`/`Calendar` migrations planned in `architecture-and-performance-uplift`.

**Non-Goals:**

- Introducing a `useFirstLoadGate(query)` wrapper hook. Considered and rejected (see Decisions).
- Suspense-driven data loading.
- Refactoring the empty-state component itself.
- Visual changes to the spinner.
- Touching `useDataRefreshBus` or the SSE → query-cache bridge — owned by `architecture-and-performance-uplift`.
- Calendar internal decomposition (also owned by `architecture-and-performance-uplift`).

## Decisions

### Decision 1: Use `isPending` as the first-load gate

`isPending` is `true` whenever `status === 'pending'`, regardless of `fetchStatus`. This covers both the `pending && idle` window (the bug) and the `pending && fetching` window (the in-flight request). It becomes `false` only after the first response resolves (success or error). This is exactly the semantic "has this query ever resolved?" that the spinner gate needs.

The change is mechanical: in each consumer, replace `query.isLoading` with `query.isPending` for the `loading` derivation. The component-side conditional logic (e.g., `if (loading && data.length === 0)`) does not change.

**Why not `isFetching`?** `isFetching` is true during *every* network request, including background refetches when data is already populated. Using it as the spinner gate would re-show the full-screen spinner on every silent refresh, which would be a UX regression.

**Why not a derived helper like `const firstLoad = query.isPending`?** That is exactly what `isPending` already is — adding a layer of naming would obscure the TanStack Query API rather than clarify it.

### Decision 2: Reject a `useFirstLoadGate(query)` wrapper hook

A wrapper would centralize the rule and prevent regression at the language level. But it has costs:

- Adds a new file, a new test surface for the wrapper itself, and import churn across every consumer.
- Replaces a TanStack Query primitive (`isPending`) with a project-specific name, hurting discoverability for new contributors who already know RQ.
- Encodes a two-word idiom that the docs already name explicitly. The convention can be enforced with a CLAUDE.md note plus a small ESLint rule (future).

The convention-plus-documentation approach matches the codebase's posture toward other RQ idioms (see the existing correct usage at `ReservationRequests.jsx:217`).

### Decision 3: Update `isSilentRefreshing` to use `!isPending` instead of `!isLoading`

`isSilentRefreshing` is meant to mean "a background refresh is in progress while data is already shown." Today it is computed as `query.isFetching && !query.isLoading`. With `isLoading = isPending && isFetching`, `!isLoading` is `true` during `pending && idle` — the very tick we want to suppress. The corrected expression is `query.isFetching && !query.isPending`, which is `true` only when a fetch is happening *and* prior data already resolved. This is a side-effect of Decision 1 that aligns the silent-refresh semantic with the empty-state semantic.

### Decision 4: Calendar init-error path adds `setLoading(true)` before `setInitializing(false)`

The Calendar's overlay formula at line 5192 is `initializing ? visible+initial : (isNavigating || loading) ? visible : hidden`. The happy path of `initializeApp` (lines 2354-2355) correctly batches `setLoading(true); setInitializing(false)` so the overlay never goes hidden between the init phase and the data-fetch phase. The catch block at lines 2360-2367 omits `setLoading(true)`, so the overlay class flips from `visible initial` to `hidden` until the consolidated effect runs `loadEvents`, which then sets `loading` back to `true`.

The fix is to add `setLoading(true)` inside the catch block before `setInitializing(false)`. This is safe because the consolidated effect runs after `initializing` flips and `loadEvents` always calls `setLoading(false)` in its `finally`. If the consolidated effect never fires (a deeper failure), the user sees a permanent spinner — acceptable, as the app is in a broken state and the existing 30-second initialization timeout will surface a hard error path.

**Why not change the overlay formula?** It is correct. The bug is the missing state write on the error path, not the rendering condition.

### Decision 5: Convention lives in `CLAUDE.md` "Key Architectural Patterns"

The durable artifact that prevents regression in future query-using components is a documented convention. Add a section called "React Query loading primitives (TanStack v5)" alongside existing entries (Status Machine, OCC, Requester Canonical Source, etc.). The section names each primitive, its semantic, and the empty-state rendering rule. Subsequent migrations referenced by `architecture-and-performance-uplift` (`EventManagement`, `Calendar`) will follow the documented convention.

### Decision 6: Test placement and depth

Two new Vitest files at the unit level:

- `src/__tests__/unit/components/MyReservations.firstPaint.test.jsx`
- `src/__tests__/unit/components/ReservationRequests.firstPaint.test.jsx`

Each file exercises the cold-token mount path with a controllable `authFetch` (existing helper pattern: `makeControllableAuthFetch` and `withQueryClient`). The assertions are: (1) spinner present immediately after token arrival, (2) no empty-state text in the DOM during the `pending && idle` window, (3) empty-state appears after fetch resolves with `[]`, (4) `isSilentRefreshing` suppresses empty-state during background refetch.

The Calendar init-error scenario is harder to unit-test because `Calendar.jsx` has a large mock surface. Two options were weighed: (a) add an integration test using the existing `testApp.js` infrastructure, (b) defer to a Playwright E2E that force-throws from a network-mocked endpoint and asserts the overlay class. We choose **(b) Playwright-deferred** with a clear note in `tasks.md`; if the Playwright suite is not yet up, the manual smoke check (force a network failure on `/api/users/profile` in dev tools and reload) is documented as the verification step.

## Risks / Trade-offs

[**Risk**: `isPending` is `true` for permanently disabled queries (`enabled: false`)] → Mitigated by upstream guards. In `MyReservations`, the component returns the `permissionsLoading` spinner before reaching the `loading` gate when permissions haven't resolved. In `ReservationRequests`, `queryEnabled` includes `canApproveReservations && !permissionsLoading`, and the `permissionsLoading` early return covers the disabled-but-pending state. The new `loading` derivation does not change either component's reachability of the `loading` gate.

[**Risk**: A requester with zero historical reservations sees the spinner first, then the empty-state — perceived as a "delay" before the empty message] → Acceptable and arguably more correct. Today the same user sees `empty-state → spinner → empty-state`, which is worse. After the fix the sequence is `spinner → empty-state`. The minimum perceived "wait" is bounded by the events list endpoint latency, which is already short for a user with no events.

[**Risk**: `isSilentRefreshing` semantic shift breaks an existing UI assumption] → Audit showed only two consumers of `isSilentRefreshing` (within `MyReservations.jsx` and `ReservationRequests.jsx`), both used to suppress the empty-state during background refetches. The corrected semantic (`!isPending`) is strictly tighter — it suppresses empty-state during true silent refreshes only, not during the disabled-but-pending state. Verified to be the desired behavior.

[**Risk**: Calendar `setLoading(true)` in the catch block creates a permanent spinner if the consolidated effect never fires] → Mitigated by the existing 30-second `initializationTimeout` at lines 2273-2276 that fires `setInitializing(false)` after timeout — but that on its own does not flip `loading`. Add documentation in `tasks.md` to verify the timeout path manually. If the timeout is reached and `loading` is still `true`, the user sees a spinner with no recovery. Today they see a blank grid with no recovery. Both are degenerate states; spinner is preferable to blank because at least it signals "still working" until the user manually refreshes. Long-term, surface an error UI when the timeout trips — out of scope for this change.

[**Risk**: Future RQ adopters miss the convention] → Mitigated by the CLAUDE.md entry. A follow-up could add an ESLint rule (`no-isLoading-as-first-load-gate`) to enforce mechanically — out of scope here.

[**Trade-off**: No wrapper hook means the convention lives in the consumer's code rather than at a typed seam] → Accepted. The convention is two words. A wrapper would over-engineer the fix and add more files than the bug warrants.

## Migration Plan

This change has no migration in the schema or API sense. Order of code changes:

1. Update `MyReservations.jsx` (lines 193, 198). Run `npm test -- MyReservations` for that file and verify all existing tests pass.
2. Update `ReservationRequests.jsx` (lines 204, 211). Run `npm test -- ReservationRequests` for that file and verify all existing tests pass.
3. Update `Calendar.jsx` init-error catch block (~line 2363). Manual smoke test: temporarily throw from `loadUserProfile` and verify overlay stays visible.
4. Add new first-paint tests for both query consumers.
5. Add the CLAUDE.md "React Query loading primitives" section.
6. Run targeted test files; do not run the full suite (per project convention).

Rollback: trivial — revert four production-code lines and the doc edit. No data has been written, no user-visible state has been migrated.

## Open Questions

- Should the CLAUDE.md entry be paired with an ESLint rule that flags `query.isLoading` outside of explicit allowlist usage? Deferred — out of scope for this change but a sensible follow-up.
- Should the Calendar init-error path additionally surface a user-visible error toast when the 30-second initializationTimeout trips? Deferred — separate concern, owned by error-surfacing in `architecture-and-performance-uplift` if scoped there, otherwise its own future change.
