# Tasks: Recurring Publish Conflict Blocking

## 1. Backend — blocking publish + admin-save fix (test-first)

- [x] 1.1 Measure the pre-change baseline for the touched backend suites
      (`publishRecurringConflict.test.js`, `recurringConflict.test.js`,
      `recurringPublish.test.js`, `publishRollback.test.js`) — main is red;
      record counts before touching anything.
      **Baseline (clean tree):** PRC+RCC 16/16; publishRollback 8/8;
      recurringPublish 18 failed / 27 passed (pre-existing red)
- [x] 1.2 Rewrite `publishRecurringConflict.test.js` (PRC-1..5): PRC-1/PRC-2
      flip to assert 409 (`conflictTier: 'hard'`, `recurringConflicts`,
      `canForce: true`, event still `pending`, `_version` unchanged; one
      asserts flattened `hardConflicts` entries carry `occurrenceDate`);
      PRC-3 moves to forced-publish (admin `forcePublish: true` → 200 +
      `recurringConflictSnapshot` with correct counts); PRC-4 (single-event
      regression) and PRC-5 (clean series → 200) stay unchanged
- [x] 1.3 Add new cases to `recurringConflict.test.js` (and fix its stale
      "RCC-1 to RCC-9" describe title): RCC-12 approver `forcePublish: true`
      → 403; RCC-13 admin save moving a published series onto a conflict →
      409; RCC-14 conflict-check failure during publish → 200 +
      `recurringConflictCheckError: true` (induce via
      `jest.spyOn(Collection.prototype, 'find')` selective throw, per
      `publishRollback.test.js` precedent)
- [x] 1.4 Implement in `PUT /api/admin/events/:id/publish`
      (api-server.js recurring branch ~21947-22014): run
      `checkRecurringRoomConflicts()` regardless of `forcePublish` (try/catch
      non-fatal); 409 with grouped + flattened body when
      `conflictingOccurrences > 0 && !forcePublish`; stamp
      `recurringConflictCheckError: true` in the publish `$set` on check
      failure; shared flattening helper for the 409 entry shape
- [x] 1.5 Fix `PUT /api/admin/events/:id` (~25383/25387): phantom
      `totalHardConflicts`/`occurrencesWithConflicts` →
      `conflictingOccurrences`; add flattened `hardConflicts`/`conflicts`
      parity arrays to the 409 body
- [x] 1.6 Run the touched backend suites in isolation and iterate to green;
      confirm RCC-1..11 and RP-1..12 match baseline.
      **Result:** PRC+RCC 19/19 green; publishRollback 8/8 (= baseline);
      recurringPublish 18F/27P (= baseline, pre-existing red)

## 2. Frontend — conflict visibility (test-first)

- [x] 2.1 Write Vitest cases for `RecurringConflictSummary`: fetch fires once
      in readOnly mode across parent re-renders with fresh array references
      (locks the signature-keyed effect); `calendarOwner` included in the
      request body; warning header renders from a mocked response
- [x] 2.2 Harden `RecurringConflictSummary`: key the fetch effect on a
      serialized request signature instead of `fetchConflicts` identity; add
      the `calendarOwner` prop and include it in the request body
- [x] 2.3 Write Vitest cases for the form mount: panel renders below the
      SchedulingAssistant for a recurring event with rooms (readOnly and
      live modes); absent for non-recurring events; receives
      `recurrencePattern` (not `formData.recurrence`)
- [x] 2.4 Mount `RecurringConflictSummary` in `RoomReservationFormBase`
      below the SchedulingAssistant container (~2439):
      `recurrence={recurrencePattern}` (line 262), memoized
      `roomIds`/`categories` (mirror `assistantRooms` memo ~689), composed
      start/end datetimes, buffers, `excludeEventId = currentReservationId`,
      `apiToken`, `isAllowedConcurrent`,
      `calendarOwner={effectiveDefaultCalendar}`, `readOnly` per mode
- [x] 2.5 Run the touched frontend suites and iterate to green (37/37)

## 3. Frontend — admin force-publish affordance (test-first)

- [x] 3.1 Write Vitest cases: after a mocked hard 409 with
      `canForce`/`forceField`, an admin's Approve button enters the
      "Publish Anyway?" confirm state and the second click resends with
      `forcePublish: true`; a non-admin approver never enters the confirm
      state (toast only); confirm state persists (no timeout reset)
- [x] 3.2 Implement in `ReviewModal.jsx` (+ `useReviewModal.jsx`): capture
      `{ canForce, forceField }` from the approve result, gate on `isAdmin`
      (alongside `hardConflictBlocks` ~212), in-button confirmation per the
      repo standard (warning color, pulse), stored retry closure resending
      with `[forceField]: true` mirroring the soft-conflict pattern
      (~924-956)
- [x] 3.3 Run the ReviewModal/useReviewModal suites and iterate to green (36/36 incl. 8 new)

## 4. Verification

- [x] 4.1 Compare all touched suites against the task-1.1 baseline
      (stash-measured); confirm no regressions beyond the intended PRC
      rewrite; run the four review-chain suites
      (MyReservations/ReservationRequests/EventManagement firstPaint +
      ReviewModal).
      **Result — no regression.** Backend: PRC 5/5 + RCC 14/14 +
      publishRollback 8/8 all green; recurringPublish 18F/27P identical to
      baseline (pre-existing red). Frontend: 85/85 across 9 suites
      (review-chain + RoomReservationFormBase 32 + RecurringConflictSummary 5
      + ReviewModal 24 + 8 new force tests). ESLint problem counts per
      touched file identical HEAD vs working tree (0 new). No test asserts
      the old client-built hard-409 toast text.
- [ ] 4.2 Manual end-to-end on dev: as approver, attempt to publish a
      conflicted recurring series → blocked with toast + panel showing the
      conflicting dates; as admin, force-publish via "Publish Anyway?" →
      published with snapshot recorded; edit a published series into a
      conflict → blocked (needs live MSAL session and real reservations)
      **NOT DONE — needs a live MSAL session and writes to real
      reservations.** PRC-1..3 and RCC-12..14 cover the 409/force/snapshot
      round-trips in-process against the real api-server; FP-1..4 and
      FPC-1..4 cover the arming and resend. What remains for a human is the
      browser round-trip: the panel rendering in the open review modal, the
      toast text, the warning-color 'Publish Anyway?' pulse, and the SSE
      refresh after a forced publish.
- [x] 4.3 Provide the ready-to-use commit message (single quotes only)
