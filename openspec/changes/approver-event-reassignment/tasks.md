# Tasks: Approver Event Reassignment + Clergy on Additional Information Tab

## 1. Backend — reassign endpoint (test-first)

- [x] 1.1 Write Jest suite `backend/__tests__/integration/eventReassignment.test.js`
      (use `createAppForTest`, not testApp.js) covering: 200 happy path with
      server-resolved identity + `_version` bump, 403 non-approver, 404
      unknown event / unknown target user, 400 `EVENT_DELETED`,
      400 `ALREADY_OWNER` (case-insensitive email), 400
      `TARGET_USER_INCOMPLETE`, 400 `INVALID_TARGET_EVENT_TYPE` for
      exception/addition children, 409 stale `expectedVersion`, master
      cascade to non-deleted children, audit entry shape, email-to-new-owner-only,
      email failure still 200
- [x] 1.2 Implement `PUT /api/admin/events/:id/reassign` in
      `backend/api-server.js`: guards per design D3, `conditionalUpdate` with
      `CONFLICT_SNAPSHOT_FIELDS`, child `updateMany` cascade for series
      masters, best-effort audit insert (`action: 'ownership-reassigned'`),
      SSE `broadcastEventChange`
- [x] 1.3 Add `sendReassignmentNotification` to
      `backend/services/emailService.js` + template in `emailTemplates.js`
      (new owner only; event title/date/location, who reassigned)
- [x] 1.4 Run the new suite in isolation and iterate to green (19/19)

## 2. Frontend — reassign control (test-first)

- [x] 2.1 Write Vitest cases for the reassign control: renders only when
      `canApproveReservations`; picker fetches `GET /api/users` lazily on
      first open; current owner excluded; two-step in-button confirmation
      (no request on first click, request + disabled "Reassigning..." on
      second); success toast + updated requester cell; 409 shows one-line
      error and triggers refetch
- [x] 2.2 Build the reassign UI in the Submitter Information section of
      `RoomReservationFormBase.jsx` (or a small extracted
      `ReassignOwnerControl` component if the form base stays cleaner):
      searchable user picker, warning-color confirm state per the button
      standard, `showSuccess`/`showError` toasts
- [x] 2.3 Wire the permission prop through `EventReviewExperience` →
      `RoomReservationReview` → `RoomReservationFormBase` (derived-flag
      computation stays in `EventReviewExperience`), and add the API call
      with `expectedVersion` from the loaded event's `_version`
- [x] 2.4 Run the new frontend tests and iterate to green (28/28; RA-2 and RA-7
      mutation-checked)

## 3. Frontend — clergy on Additional Information tab

- [x] 3.1 Add Vitest cases: clergy button renders on the additional tab;
      opens the shared modal; selection made there is reflected in the Event
      Details summary; Clear from the additional tab empties both; button
      disabled when `fieldsDisabled`
- [x] 3.2 Render the second `⛪ Clergy` button + summary row in the
      Additional Information section, wired to the existing
      `setShowClergyModal` / `assignedRabbi` / `assignedCantor` state
- [x] 3.3 Run the touched suites and iterate to green

## 4. Verification

- [x] 4.1 Measure the pre-change baseline for every touched suite
      (`git stash push -u` → run → `git stash pop` → run) — main is red;
      compare counts, don't assume green.
      **Result — no regression.** `backend/__tests__/integration/events/`:
      identical before and after (34 failed suites / 195 failed / 661 passed /
      1 skipped, 857 total). `backend/__tests__/unit/services/`: 121/121.
      New `eventReassignment.test.js` 19/19, `emailTemplates.test.js` 26/26.
      Frontend `RoomReservationFormBase.test.jsx` 28/28 (was 13); the four
      review-chain suites (MyReservations/ReservationRequests/EventManagement
      firstPaint + ReviewModal) all pass.
- [ ] 4.2 Manual end-to-end check on dev: as approver, reassign a pending
      event between two test users; confirm it moves between their My
      Reservations lists, the audit entry exists, and the email fires (or is
      logged) to the new owner only; confirm clergy edits from the additional
      tab save
      **NOT DONE — needs a live MSAL session, Graph credentials, and writes to
      real reservations.** ER-3 covers the my-events list move against a real
      `/api/events/list` handler in-process, and ER-16/17 cover the audit entry
      and new-owner-only email, so what remains for a human is the browser
      round-trip: the picker rendering, the two-step confirm, the toast, the
      SSE-driven refresh of both users' lists, and the real outbound email.
- [x] 4.3 Provide the ready-to-use commit message (single quotes only)
