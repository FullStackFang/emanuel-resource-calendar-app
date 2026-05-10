## 1. MyReservations first-paint fix

- [x] 1.1 Edit `src/components/MyReservations.jsx` line 193: change `const loading = myReservationsQuery.isLoading;` to `const loading = myReservationsQuery.isPending;`
- [x] 1.2 Edit `src/components/MyReservations.jsx` line 198: change `myReservationsQuery.isFetching && !myReservationsQuery.isLoading` to `myReservationsQuery.isFetching && !myReservationsQuery.isPending`
- [x] 1.3 Run `npm test -- MyReservations` and confirm all existing tests still pass — **22 tests passed**
- [ ] 1.4 **(MANUAL — for user)** Cold-load `MyReservations` (clear sessionStorage, refresh) and confirm spinner appears immediately with no "No reservations" flash before data arrives

## 2. ReservationRequests first-paint fix

- [x] 2.1 Edit `src/components/ReservationRequests.jsx` line 204: change `const loading = reservationsQuery.isLoading;` to `const loading = reservationsQuery.isPending;`
- [x] 2.2 Edit `src/components/ReservationRequests.jsx` line 211: change both `!reservationsQuery.isLoading` and `!countsQuery.isLoading` clauses to `!reservationsQuery.isPending` and `!countsQuery.isPending`
- [x] 2.3 Run `npm test -- ReservationRequests` and confirm all existing tests still pass — **16 tests passed**
- [ ] 2.4 **(MANUAL — for user)** As Approver, cold-load `/admin/reservations`. Confirm spinner appears immediately with no flash of empty needs-attention list before data arrives

## 3. Calendar init-error overlay fix

- [x] 3.1 Edit `src/components/Calendar.jsx` (~line 2363): inside the `initializeApp` catch block, add `setLoading(true);` BEFORE the existing `setInitializing(false);` line so the overlay stays visible across the error → consolidated-effect-load handoff
- [ ] 3.2 **(MANUAL — for user)** Temporarily throw from `loadUserProfile` (or block `/api/users/profile` in dev tools network tab) and reload. Confirm the loading overlay stays visible until either `loadEvents` completes or the 30-second initialization timeout fires
- [ ] 3.3 **(MANUAL — for user)** Verify the happy path is unchanged: clear the temporary throw, reload, confirm calendar loads normally with continuous overlay until events render

## 4. New first-paint unit tests

- [x] 4.1 Create `src/__tests__/unit/components/MyReservations.firstPaint.test.jsx` with three test cases:
  - `MR-FP-1`: spinner present immediately after `apiToken` arrival, before fetch resolves; "No reservations" not in the DOM
  - `MR-FP-2`: empty-state appears after fetch resolves with `[]`
  - `MR-FP-3`: cards render correctly when fetch resolves with non-empty data
- [x] 4.2 Create `src/__tests__/unit/components/ReservationRequests.firstPaint.test.jsx` with four test cases:
  - `RR-FP-1`: spinner present immediately after token arrival
  - `RR-FP-2`: spinner persists when reservations query resolves but counts query is still pending (asserts the `!countsLoaded` arm of the spinner gate)
  - `RR-FP-3`: empty-state ("All caught up!") appears after both queries resolve with empty/zero results
  - `RR-FP-4`: cards render correctly when both queries resolve with data
- [x] 4.3 Run `npm test -- firstPaint` and confirm all 7 new tests pass — **7 tests passed**
- [ ] 4.4 **(DEFERRED — Playwright)** Calendar init-error overlay coverage. The Calendar.jsx mock surface is too costly to set up at the unit-test level; manual verification step 3.2 is the temporary acceptance criterion until the Playwright suite is wired up

## 5. Convention documentation

- [x] 5.1 Added "React Query loading primitives (TanStack v5)" section to `CLAUDE.md` under "Key Architectural Patterns" (just before `### Testing`). Includes:
  - `query.isPending` — first-load gate
  - `query.isFetching && !query.isPending` — silent-refresh detector
  - `query.isLoading` — DO NOT use as the first-load gate (with rationale)
  - Empty-state predicate: `!isPending && data.length === 0 && !isSilentRefreshing`
  - Reference implementations and the locked-by tests
- [x] 5.2 No edit required: the in-flight `architecture-and-performance-uplift` change has not yet landed. When that change ships its EventManagement and Calendar TanStack Query migrations, the new code must follow the convention documented in CLAUDE.md.

## 6. Verification and acceptance

- [x] 6.1 Run `npm test -- --run "MyReservations" "ReservationRequests"` — **45 tests passed across 11 test files**
- [x] 6.2 Lint check on touched files (`npx eslint src/components/MyReservations.jsx src/components/ReservationRequests.jsx src/components/Calendar.jsx src/__tests__/unit/components/*.firstPaint.test.jsx`) — pre-existing warnings/errors only; no new issues introduced by this change. New test files have zero lint errors.
- [ ] 6.3 **(MANUAL — for user)** In dev, cold-load each affected view (MyReservations, ReservationRequests, Calendar) with throttled network (Slow 3G in dev tools) and confirm no blank/empty-state flash appears
- [ ] 6.4 **(MANUAL — for user)** Verify the existing stale-write guards in `MyReservations.jsx` (lines 174-180) and `ReservationRequests.jsx` (`bypassEmptyGuardRef` pattern) still behave correctly: trigger a delete mutation that empties the list and confirm the empty-state appears (not suppressed) and stale data does not return
- [ ] 6.5 Update the change status to ready-for-archive once all manual verification tasks above are checked

## Implementation summary

**Code changes (5 lines + 1 doc section):**
- `src/components/MyReservations.jsx`: 2 lines (`isLoading` → `isPending`)
- `src/components/ReservationRequests.jsx`: 2 lines (3 occurrences across two expressions)
- `src/components/Calendar.jsx`: 1 line added (`setLoading(true)` in init-error catch)
- `CLAUDE.md`: new "React Query loading primitives (TanStack v5)" section under "Key Architectural Patterns"

**Tests added (7 new tests across 2 files):**
- `MyReservations.firstPaint.test.jsx`: MR-FP-1, MR-FP-2, MR-FP-3
- `ReservationRequests.firstPaint.test.jsx`: RR-FP-1, RR-FP-2, RR-FP-3, RR-FP-4

**Tests passing:** 45 (in MyReservations + ReservationRequests scope), 0 regressions
