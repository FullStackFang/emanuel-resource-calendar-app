# Tasks: Conflict resolution workflow

## 1. Baseline

- [x] 1.1 Measure the pre-change baseline by stash (`git stash push -u` → run →
      `git stash pop` → run) for the suites this change touches:
      `recurringConflict.test.js`, `publishRecurringConflict.test.js`
      (backend); `RecurringConflictSummary.test.jsx`,
      `RoomReservationFormBase.test.jsx`, `useReviewModal.forcePublish.test.jsx`,
      `ReviewModal.forcePublish.test.jsx` (frontend). Main is red — record
      counts before touching anything so no pre-existing failure is
      misattributed.

## 2. Backend — requester name on conflict records (test-first)

- [x] 2.1 Add cases to `recurringConflict.test.js`: a single-instance conflict
      carries `requestedBy` from `roomReservationData.requestedBy.name`; a
      series-master conflict carries it too; an event with no reservation data
      yields `null` rather than being omitted; no conflict record carries
      email, phone, or userId
- [x] 2.2 Add `requestedBy` to both conflict push sites in
      `checkRecurringRoomConflicts()` (api-server.js ~3233 single-instance,
      ~3253 series-master). Name only, per design D6
- [x] 2.3 Confirm `flattenRecurringConflicts()` carries the new field through
      to the 409 body without changing the existing entry shape, and that the
      `recurring-publish-conflict-blocking` 409 contract tests still pass
- [x] 2.4 Run both backend suites in isolation and compare against the 1.1
      baseline

## 3. Modal navigation — fallback, origin, return bar (test-first)

- [x] 3.1 Write Vitest cases for the `navigateToEvent` fetch fallback: a target
      with reservation data resolves from `/api/room-reservations/:id` with no
      second request; a 404 from that endpoint falls back to
      `GET /api/events/:id`; both failing reports the load error and does not
      navigate; the fallback result is adapted to the same shape the primary
      source returns before any consumer sees it
- [x] 3.2 Implement the fallback in `useReviewModal.navigateToEvent`
      (useReviewModal.jsx ~472), including the shape adapter. Keep the primary
      path unchanged so existing series-master navigation is untouched
- [x] 3.3 Write Vitest cases for the navigation origin: recorded on a
      conflict-driven navigation with originating event, title, occurrence
      date, and outstanding count; replaced (not stacked) by a second
      navigation; cleared on modal close; absent for ordinary navigation
- [x] 3.4 Implement the single-entry `navigationOrigin` in `useReviewModal` per
      design D3, exposed alongside a return handler
- [x] 3.5 Write Vitest cases for the return bar in `ReviewModal`: renders only
      when an origin exists; names the originating event and the outstanding
      count; activating it navigates back and clears the origin; unsaved
      changes route through the discard-changes guard first
- [x] 3.6 Implement the return bar in `ReviewModal.jsx` / `ReviewModal.css`

## 4. Conflict panel — strip and drawer (test-first)

- [x] 4.1 Write Vitest cases for the occurrence strip: one element per
      occurrence in series order; conflicted, clear, and skipped states are
      distinguishable; conflicted counts render without expanding anything;
      clear series render the quiet state; the blocked state states that
      publishing is blocked
- [x] 4.2 Write Vitest cases for the drawer: opens from a strip element and
      from a conflict row; only one open at a time; clear occurrences are
      inert; a date with two blocking events lists both with per-event detail
      including the requester name; an event with a null requester is
      identified as synced from Outlook
- [x] 4.3 Rebuild `RecurringConflictSummary.jsx` around the strip and the
      single-open drawer, replacing the banner states. Keep the
      signature-keyed fetch effect and the `calendarOwner` request field
      exactly as they are — they are locked by existing tests
- [x] 4.4 Rewrite `RecurringConflictSummary.css`: strip, drawer, and the
      verdict/quiet state treatments. Remove the fixed
      `120px 130px 1fr` detail grid so long room names stay legible. Tokens
      only, no ad-hoc values
- [x] 4.5 Implement the strip degradation thresholds from design D9 and cover
      the compact-summary fallback with a test

## 5. Conflict panel — resolution actions (test-first)

- [x] 5.1 Write Vitest cases for the open action: calls the modal navigation
      with the conflict record's `id`; routes through the discard-changes
      guard when the form is dirty
- [x] 5.2 Write Vitest cases for skip: adds the occurrence date to
      `recurrence.exclusions` in form state and marks the form dirty; the
      conflict check re-runs as a consequence of the signature change with no
      explicit refetch; the occurrence renders skipped and unsaved; skip is
      absent when fields are disabled; skipping the last remaining occurrence
      is refused with an explanation
- [x] 5.3 Implement both actions in the drawer, threading the navigation
      callback and the skip handler from `RoomReservationFormBase` through the
      panel's props
- [x] 5.4 Implement the skip handler in `RoomReservationFormBase` using the
      same `setFormData` + `setHasChanges` + `notifyDataChange` sequence every
      other form control uses (design D1). Introduce no persistence endpoint
- [x] 5.5 Verify by inspection that no new backend write path was added and
      that the exclusion is persisted only by the normal form save

## 6. Reassign control — collapsed full-width combobox (test-first)

- [x] 6.1 Write Vitest cases in `RoomReservationFormBase.test.jsx` or a
      dedicated file: nothing but the trigger renders at rest; opening renders
      the search; matches are capped and the overflow count is stated;
      selecting collapses the search to the pending transfer; the existing
      two-step confirmation and 409 behavior still hold
- [x] 6.2 Rebuild `ReassignOwnerControl.jsx` per design D8 — collapsed
      trigger, capped result list, selection collapses to the pending transfer
- [x] 6.3 Rewrite `ReassignOwnerControl.css`: remove `max-height` and
      `overflow-y` from the list, and remove the
      `box-shadow: inset 3px 0 0` selected-row side-stripe
- [x] 6.4 Move the control to a full-span cell in the Submitter Information
      grid (`grid-column: 1 / -1`) in `RoomReservationFormBase.jsx` and
      `RoomReservationForm.css`
- [x] 6.5 Confirm the existing reassignment tests in
      `eventReassignment.test.js` are unaffected — this task changes
      presentation only

## 7. Clergy cell in Submitter Information (test-first)

- [x] 7.1 Write Vitest cases: the cell renders unconditionally; shows one
      labelled entry per person; shows `N/A` when both arrays are empty; shows
      only the assigned role when one is empty; renders multiple people in one
      role as separate entries; opens no selector and changes no form state
- [x] 7.2 Add the display-only Clergy cell to the Submitter Information grid,
      reading the same `assignedRabbi` / `assignedCantor` form arrays the
      existing controls write. Add no third editable control

## 8. Verification

- [x] 8.1 Run every touched suite in isolation and compare against the 1.1
      baseline; attribute any delta before proceeding
- [x] 8.2 Run `npm run lint` and clear anything this change introduced
- [x] 8.3 Mutation-check the two load-bearing new tests — the skip handler's
      "no persistence endpoint" case and the `navigateToEvent` fallback —
      by breaking the implementation and confirming they fail
- [ ] 8.4 Manual end-to-end on dev with a live MSAL session: open a conflicted
      series, confirm the strip marks the right weeks, open a drawer, navigate
      to a blocking event and return via the bar, skip a date and confirm it
      persists through save and clears the block, and confirm the fallback by
      opening a blocking event that is synced from Outlook
