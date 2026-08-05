# Tasks: Room conflict report

## 1. Baseline

- [x] 1.1 Measure the pre-change baseline by stash (`git stash push -u` → run →
      `git stash pop` → run) for every suite this change touches:
      `recurringConflict.test.js`, `architecturalBugs.test.js`,
      `recurringAvailability.test.js`, `publishRecurringConflict.test.js`
      (backend). Main is red — record pass and fail counts before touching
      anything so no pre-existing failure is misattributed to this change.

## 2. Extract the concurrency predicate (D2)

- [x] 2.1 Write `backend/__tests__/unit/concurrencyRules.test.js` first, against
      the not-yet-existing module: bilateral category grant in both directions;
      no grant either way falls through to the per-event rules; a category name
      with no document in the map contributes no grant and does not throw;
      neither side concurrent → conflict; concurrent with empty restriction
      list → not a conflict; concurrent with a non-empty list and a matching
      counterpart category → not a conflict; non-matching → conflict; an absent
      `isAllowedConcurrent` is treated as false
- [x] 2.2 Create `backend/utils/concurrencyRules.js` exporting
      `isRealConflict(sideA, sideB, categoryMap)`. Lift the logic verbatim from
      `checkRoomConflicts()` (api-server.js ~2867-2915), preserving the
      short-circuit order exactly: A-grants-B, B-grants-A, then the legacy
      per-event branches. Pure — no I/O, no logger, no database
- [x] 2.3 Rewrite the `actualConflicts` filter in `checkRoomConflicts()` to call
      `isRealConflict`, and the equivalent inline block in the pending-edit loop
      (~2941-2971) which duplicates the same rules. Change no logic
- [x] 2.4 Re-run the 1.1 suites and confirm pass and fail counts are **identical**
      to the baseline. Any difference means the move was not pure — fix before
      continuing, do not proceed on a changed count

## 3. Conflict report service — detection core (test-first)

- [x] 3.1 Write `backend/__tests__/integration/conflictReport.test.js` covering
      detection, all failing initially: CR-1 two overlapping published events in
      one room → one conflict; CR-2 same room, non-overlapping → none; CR-3
      overlapping in time but no shared room → none; CR-11 draft, pending,
      rejected, and deleted events → excluded from both sides
- [x] 3.2 Create `backend/services/conflictReportService.js` with
      `runConflictReport({ windowStart, windowEnd, calendarOwner })`. Implement
      the four reads of D12, each wrapped in `withCosmosRetry`. Window bounds
      must be built with a local-getter ISO helper, matching
      `checkRoomConflicts` (~2625-2629) — stored datetimes are local-time
      strings with no `Z` and a UTC-based bound would silently shift the window
- [x] 3.3 Implement occurrence normalization: every side becomes a record
      carrying ids, title, calendar owner, status, visible times, effective
      times, rooms, categories, concurrency fields, requester name, event type,
      occurrence date, and series master id
- [x] 3.4 Implement bucketing by `(roomId, dayKey)` and the per-bucket
      sweep-line, calling `isRealConflict` for each candidate pair, then dedup
      by canonical pair key across buckets

## 4. Effective windows and buffers (test-first)

- [x] 4.1 Add CR-4: two events whose visible times do not overlap but whose
      teardown buffer makes their effective windows overlap → one conflict,
      **and** its contested interval equals the buffer intersection, not either
      event's span
- [x] 4.2 Implement effective-window computation using the exact fallback
      precedence at api-server.js ~2612-2613
      (`reservationStartMinutes ?? calendarData.reservationStartMinutes ??
      setupTimeMinutes ?? calendarData.setupTimeMinutes ?? 0`, and the teardown
      mirror). Reproduce the chain rather than simplifying it — legacy events do
      not all carry the outer bounds
- [x] 4.3 Implement `overlapStart` / `overlapEnd` as the intersection of the two
      effective windows (D8)
- [x] 4.4 Add CR-10: an event whose effective window crosses midnight collides
      with an event the next day in the same room → reported. Implement
      insertion into **every** day-bucket the effective window touches
- [x] 4.5 Mutation-check CR-4: remove the buffer extension and confirm CR-4
      fails. Restore

## 5. Recurring occurrences (test-first)

- [x] 5.1 Add CR-7: a weekly series with twelve in-window occurrences colliding
      on three → exactly three conflicts, each naming its occurrence date;
      CR-8: an occurrence in `recurrence.exclusions` → not reported
- [x] 5.2 Add CR-9: an exception document overrides an occurrence and moves it
      to a different time → the master's occurrence for that date is suppressed
      and the exception is evaluated in its place; and the variant where the
      exception moves the occurrence **outside** the window and the master's
      occurrence is still suppressed
- [x] 5.3 Implement master expansion inside the window only, via
      `expandRecurringOccurrencesInWindow`, subtracting exclusions and
      exception/addition dates. Masters are fetched by `eventType` and never by
      date range — a master's stored end is the series end (api-server.js
      2653-2660)
- [x] 5.4 Mutation-check CR-9: remove the exception-date suppression and confirm
      CR-9 fails. Restore

## 6. Grouping, scoping, caps, degradation (test-first)

- [x] 6.1 Add CR-14: three events in one room where A/B and B/C contest
      different intervals and A/C never overlap → two pairwise conflicts, none
      between A and C (D10)
- [x] 6.2 Add CR-5 and CR-6: category-permitted overlap in **both** directions,
      and per-event-flag-permitted overlap → neither reported nor counted
- [x] 6.3 Add CR-12: the calendar filter scopes results; an unknown calendar
      returns an empty result rather than an error
- [x] 6.4 Add CR-15: induce a read failure (via a `Collection.prototype.find`
      spy, per the `publishRollback` and RCC-14 precedent) → response carries
      the results obtained plus a stage marker, is **not** presented as clean,
      and a total failure errors instead of returning empty (D9)
- [x] 6.5 Add CR-16: exceeding the 20,000-occurrence cap sets `truncated: true`
- [x] 6.6 Implement grouping and ordering by date, then room, then start time,
      and the stable per-conflict key derived from room, date, and event ids
- [x] 6.7 Implement the degraded and truncated response fields

## 7. Endpoint (test-first)

- [x] 7.1 Add CR-13: a requester-role user gets 403; an approver gets 200; an
      administrator gets 200. Add window validation cases: 30/90/180/365
      accepted, any other value 400 with no scan run
- [x] 7.2 Add `GET /api/admin/reports/conflicts` to `backend/api-server.js`
      beside the sync-health report endpoint (~12267), using `verifyToken` and
      the same `isAdmin(user, email) || canApproveReservations(user, email)`
      gate used at ~12271. No cache (D7)
- [x] 7.3 Confirm the endpoint performs no writes — no audit entry, no status
      history, no SSE emission
- [x] 7.4 Run the full `conflictReport.test.js` suite and the 1.1 baseline
      suites; confirm baseline counts still match

## 8. Frontend — route, guard, navigation

- [x] 8.1 Rename `RequireSyncHealth` to `RequireApproverReport` in
      `src/App.jsx` (~115-121) and point both the sync-health route and the new
      `/admin/reports/conflicts` route at it. The predicate is identical and two
      copies would have to be kept in sync by hand
- [x] 8.2 Add the navigation entries in `src/components/Navigation.jsx`,
      mirroring the Sync Health treatment at ~188-196: top-level for approvers
      who are not administrators, Admin dropdown for administrators
- [x] 8.3 Add a Vitest case asserting the route guard redirects a user with
      neither permission, and that the navigation entry appears for an approver

## 9. Frontend — the report view (test-first)

- [x] 9.1 Write `src/__tests__/unit/components/ConflictReport.firstPaint.test.jsx`
      following the existing first-paint precedent: no empty state renders at
      any point before the first scan resolves, including the `pending && idle`
      tick
- [x] 9.2 Write `src/__tests__/unit/components/ConflictReport.test.jsx`:
      conflicts render grouped by date then room with the contested interval
      leading; a side with no requester shows the Outlook-synced label; a
      recurring side is identified as an occurrence; the clean-calendar empty
      state reads as success and carries a refresh affordance; a degraded
      response banners incompleteness; a truncated response banners truncation;
      a failed request renders an error with retry and never an empty state
- [x] 9.3 Create `src/components/ConflictReport.jsx` and `.css`, modeled on
      `SyncHealthReport.jsx`. Derive loading via `deriveListLoadingState` and
      bind `loading` to `isFirstLoad`; gate the empty state on
      `!isPending && conflicts.length === 0 && !isSilentRefreshing`; include
      `EmptyStateRefreshButton`
- [x] 9.4 Implement the header controls: window preset (30/90/180/365, default
      90), calendar filter, re-run action, and the generated-at stamp

## 10. Frontend — drill-in

- [x] 10.1 Add Vitest cases: selecting a side opens the shared review
      experience; a side with no reservation data still resolves via the events
      fallback; the report remains mounted beneath the modal; closing after a
      reported change refetches the report
- [x] 10.2 Mount a single `EventReviewExperience` at report level fed by a
      selected id. Pass raw permissions and caller props only — per the
      component's contract, the report derives no gates itself
- [x] 10.3 Resolve a selected side through `/api/room-reservations/:id` with a
      404 fallback to `GET /api/events/:id` adapted by
      `adaptEventToReservationShape()` (`useReviewModal.jsx:62`). Mandatory, not
      defensive — Outlook-synced sides carry no `roomReservationData`
- [x] 10.4 Invalidate the report query when the modal reports a save or delete

## 11. Documentation and verification

- [x] 11.1 Add `conflictReportService.js` to the `calendarData`-removal refactor
      checklist in `CLAUDE.md`, naming the specific paths it reads
- [x] 11.2 Run the full frontend suite and confirm it matches the documented
      pre-existing baseline (10 failures across 3 files) with no new failures
- [ ] 11.3 Manual end-to-end on dev with a live MSAL session: open the report as
      an approver and as an administrator; confirm a known Outlook-created
      collision appears; change the window and the calendar filter; open both
      sides of one conflict including an Outlook-synced side; edit one event to
      resolve the conflict and confirm it leaves the list on close; confirm a
      non-approver is redirected
