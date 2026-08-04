# Recurring Publish Conflict Blocking

Revision 2 — incorporates architecture review findings (2026-08-04): contradicting PRC test
suite, dead frontend force path, ConflictDialog scope correction, recurrence prop source,
fetch-stability hardening.

## Why

End users approved a recurring series of classes and one occurrence silently double-booked a room
against an existing (migrated) published event. Investigation (2026-08-04) found four compounding
gaps:

1. **`PUT /api/admin/events/:id/publish` is deliberately non-blocking for recurring events.**
   The comment at the conflict-check block says: "For recurring events: non-blocking (conflicts
   reported in response, not 409)". `checkRecurringRoomConflicts()` runs, correctly finds the
   per-occurrence conflicts, but the result is only attached to the success response and stamped
   as `recurringConflictSnapshot`. Publish always proceeds. Single events, by contrast, hard-block
   with 409 (`canForce` for admins only).

2. **The approver's review UI cannot show the conflict before the decision.** The review modal's
   `SchedulingAssistant` receives `selectedDate={formData.startDate}` — it visualizes the first
   occurrence's day only. A conflict on occurrence #7 is invisible.

3. **`RecurringConflictSummary` is dead code.** `src/components/RecurringConflictSummary.jsx` is a
   complete per-occurrence conflict panel (calls `POST /api/rooms/recurring-conflicts`, renders
   "N of M occurrences have room conflicts" with expandable detail) — and is imported nowhere.

4. **The admin-save recurring gate never fires.** `PUT /api/admin/events/:id` checks
   `recurringConflicts.totalHardConflicts > 0`, but `checkRecurringRoomConflicts()` returns
   `{ totalOccurrences, conflictingOccurrences, cleanOccurrences, conflicts, allOccurrences }` —
   no `totalHardConflicts` field exists anywhere in the repo. `undefined > 0` is always false, so
   editing a published series into a conflict is also never blocked, despite the code's clear
   intent.

Additionally, review of the frontend surfaced a fifth gap this change must not ignore:

5. **The force-override path is dead in the frontend.** Only `useReviewModal.jsx` reads
   `canForce`/`forceField` from 409 bodies; nothing in `src/` ever sends `forcePublish: true` or
   renders an override affordance. Hard-conflict 409s surface as a plain toast (`onError` →
   `showError`). So even for single events today, an admin blocked by a hard conflict has no
   in-app way to force-publish, despite full backend support.

The intended policy already exists in the codebase: the draft-submit path
(`conflictDowngradedToPending`, api-server.js ~16580) downgrades an **approver's** auto-publish of
a conflicted recurring series to `pending`, and only **admins** may auto-publish through
conflicts. The publish endpoint simply never got the same gate.

The users' "blank attendees" theory is disproven: `checkRoomConflicts()` never reads attendee
count, and their own single-event test confirmed migrated events are detected correctly. No data
backfill is needed.

## What Changes

### 1. Backend: make recurring publish blocking (parity with singles + existing draft policy)

In `PUT /api/admin/events/:id/publish` (backend/api-server.js, recurring branch ~line 21957):

- Run `checkRecurringRoomConflicts()` **regardless of `forcePublish`** (today the whole check is
  skipped when forcing, so a forced publish records no `recurringConflictSnapshot` — and the
  post-publish safety-net toasts in Calendar/MyReservations/ReservationRequests, which key off
  `recurringConflicts` in the response, never fire for forced publishes even though that is
  exactly the case they exist for; this change fixes that as a side benefit). The check stays
  wrapped in try/catch (non-fatal on error), preserving current resilience.
- If `recurringConflicts.conflictingOccurrences > 0` **and** `!forcePublish`, return **409**:

  ```js
  return res.status(409).json({
    error: 'SchedulingConflict',
    conflictTier: 'hard',
    message: `Cannot publish: ${rc.conflictingOccurrences} of ${rc.totalOccurrences} occurrence(s) have scheduling conflicts`,
    recurringConflicts: rc,          // full per-occurrence payload (grouped by date)
    hardConflicts: flattened,        // flattened entries, same shape as single-event 409s
    softConflicts: [],
    conflicts: flattened,
    canForce: true,
    forceField: 'forcePublish',
    _version: event._version        // matches single-event 409s at :21998 / :22009
  });
  ```

  `flattened` maps each `conflicts[].hardConflicts[]` entry to the single-event 409 entry shape
  (`{ id, eventTitle, startDateTime, endDateTime, roomNames, status }`) with an added
  `occurrenceDate` so message text can name which class session collides.
- The existing admin-only gate on `forcePublish` (~line 21924, 403 for non-admins, fires before
  the conflict check) already enforces who may override — identical to the draft-path policy.
  No change needed there.
- **Fail-open on check errors, but observably.** If `checkRecurringRoomConflicts()` throws, the
  publish proceeds (current behavior — blocking on Cosmos 429 noise would strand approvals), but
  the publish `$set` records `recurringConflictCheckError: true` alongside a warn-level log, so a
  series published unchecked is distinguishable from one verified clean. Without this marker, the
  fail-open path silently reproduces the original incident under exactly the failure mode most
  likely during real load.

### 2. Backend: fix the dead admin-save gate

In `PUT /api/admin/events/:id` (~line 25383): replace the phantom fields —
`totalHardConflicts` → `conflictingOccurrences`, `occurrencesWithConflicts` →
`conflictingOccurrences` — so the intended 409 actually fires. Add the same `flattened`
`hardConflicts`/`conflicts` arrays for response-shape parity with the publish endpoint. (Repo-wide
grep confirms these are the only two references to the phantom fields.)

### 3. Frontend: mount `RecurringConflictSummary` pre-decision

- Render `RecurringConflictSummary` in `RoomReservationFormBase` directly below the
  `SchedulingAssistant` container whenever a recurrence pattern with `pattern` + `range` is
  active and at least one room is selected. This covers both the approver's review modal
  (readOnly) and the requester/editor form (debounced live mode) — the component already
  supports both via its `readOnly` prop.
- **Recurrence prop source (corrected per review):** the local `formData` state in
  `RoomReservationFormBase` does NOT carry `.recurrence` — recurrence lives in the resolved
  `recurrencePattern` variable (~line 256: `externalRecurrencePattern` when lifted by
  `RoomReservationReview`, else internal state), and is only merged into form data inside the
  `onFormDataRef` getter. The mount MUST pass `recurrence={recurrencePattern}`; wiring
  `formData.recurrence` would be `undefined` and silently no-op the component.
- Remaining props: `roomIds` and `categories` **memoized at the caller** (mirror the existing
  `assistantRooms` `useMemo` pattern ~line 668 — a fresh `[]` literal per render would defeat the
  component's debounce), `startDateTime`/`endDateTime` composed from
  `formData.startDate/startTime/endDate/endTime`, buffer minutes, `excludeEventId =
  currentReservationId`, `apiToken`, `isAllowedConcurrent`, `readOnly` per mode.
- **Harden the component's fetch stability (required before first live mount).**
  `fetchConflicts` is a `useCallback` with array/object deps consumed by a
  `useEffect([fetchConflicts, readOnly])`; with unstable parent references, readOnly mode
  refetches on every parent render and form mode's 1200ms debounce is perpetually reset. Fix
  inside the component so all future callers are safe: key the effect on a serialized request
  signature (`JSON.stringify` of recurrence, roomIds, start/end datetimes, buffer minutes,
  categories, `isAllowedConcurrent`, `excludeEventId`, and the new `calendarOwner`) instead of
  the callback identity. Caller memoization above remains good practice but is no longer
  load-bearing.
- **Add `calendarOwner` to the component's request body** (new prop, passed from the form's
  effective calendar). The endpoint `POST /api/rooms/recurring-conflicts` already accepts it;
  the component currently omits it, which mis-scopes results in multi-mailbox deployments.

### 4. Frontend: hard-409 handling + admin force-publish affordance

**Corrected scope (per review):** `ConflictDialog` has no hard-conflict mode — its four modes are
`status_changed` / `already_actioned` / `soft_conflict` / `data_changed`, and
`EventReviewExperience` wires it only for OCC version conflicts and soft conflicts. Hard-conflict
409s currently surface as a toast via `onError`. This change does NOT teach `ConflictDialog` a new
mode. Instead:

- **Toast parity:** the recurring hard 409 flows through the existing `onError` toast path exactly
  as single-event hard 409s do today. The toast message comes from the server `message` (counts of
  conflicting occurrences); the mounted `RecurringConflictSummary` (§3) is what shows the approver
  *which* dates conflict — it is already visible in the modal they are looking at when the toast
  fires.
- **Admin force-publish affordance (revives the dead `canForce` path):** when the approve call
  returns `{ success: false, canForce: true, forceField }` and the viewer is an admin, the review
  modal's Approve/Publish button enters the repo-standard **in-button confirmation** state
  ("Publish Anyway?", warning color, pulse; second click resends the approve request with
  `[forceField]: true`; persists until acted on or navigated away — no `window.confirm`, no
  timeout). The gate (admin + `canForce` received) follows the existing precedent for the
  analogous `hardConflictBlocks = hasSchedulingConflicts && !isAdmin` check, which lives in
  `ReviewModal.jsx` (~line 212, via its own `usePermissions()`) — `ReviewModal` is the single
  shared rendering surface, so this is still computed once, not per caller. Non-admin approvers
  get the blocking toast only, matching the backend 403 and the draft-path policy. Precedent for
  the retry mechanics: the soft-conflict path in `useReviewModal.jsx` (~lines 924-956) already
  resends `handleApprove` with `acknowledgeSoftConflicts: true` via a stored retry closure; the
  force path substitutes `forcePublish: true` in the same pattern.
- This affordance is implemented on the shared approve flow, so the same dead path is revived for
  single-event hard conflicts too (same backend contract, same button) — one mechanism, no
  special-casing recurring.

### 5. Tests

Backend (Jest, `backend/__tests__/integration/events/`, using `setupTestApp` from
`createAppForTest` — confirmed to be what `recurringConflict.test.js` uses):

- **Rewrite `publishRecurringConflict.test.js` (PRC-1..5), which currently asserts the bug as
  intended behavior** ("publishing recurring events is non-blocking"). PRC-1 (200-not-409) and
  PRC-2 (200 + conflicts in body) flip to assert **409** with `conflictTier: 'hard'`,
  `recurringConflicts`, `canForce: true`, event still `pending`, `_version` unchanged — one of
  them also asserts the flattened `hardConflicts` entries carry `occurrenceDate`. PRC-3
  (snapshot stored) moves to the forced-publish path: admin `forcePublish: true` → 200 +
  `recurringConflictSnapshot` recorded with correct counts. PRC-4 ("non-recurring events still
  block") is the single-event regression guard and **stays unchanged**, like PRC-5 (clean series
  → 200, no snapshot). Without this rewrite the change ships with a suite that re-asserts the
  bug and goes red.
- New cases in `recurringConflict.test.js` (and update its stale `describe` title, currently
  "RCC-1 to RCC-9"):
  - RCC-12: approver `forcePublish: true` → 403 (locks the existing pre-check gate).
  - RCC-13: admin save (`PUT /api/admin/events/:id`) moving a published series onto a conflicting
    time → 409 (locks the §2 field-name fix; currently passes through silently).
  - RCC-14: conflict-check failure during publish → 200 + `recurringConflictCheckError: true`
    stamped (locks the observable fail-open marker). `checkRecurringRoomConflicts` is an
    unexported internal, so induce the failure at the Mongo-driver level via
    `jest.spyOn(Collection.prototype, 'find').mockImplementation(...)` with a selective throw,
    per the `publishRollback.test.js` precedent (~lines 113/162).
- Regression: existing RCC-1..RCC-11 unchanged (they publish non-recurring events against
  existing series — the opposite direction, untouched). `recurringPublish.test.js` (RP-1..12,
  Graph-sync focus, no conflicting rooms in fixtures) unaffected.

Frontend (Vitest):

- `RecurringConflictSummary`: mounts in the form for a recurring event with rooms, fetch fires
  once in readOnly mode across parent re-renders (locks the signature-keyed effect),
  `calendarOwner` included in the request body, warning header renders from mocked response.
- Force affordance: after a mocked hard 409 with `canForce`, admin sees the "Publish Anyway?"
  confirm state and the second click resends with `forcePublish: true`; a non-admin approver
  never enters the confirm state.

## Explicitly Out of Scope

- **Requester submit paths** (`POST /api/room-reservations`, draft submit): a requester may still
  submit a conflicting series → `pending`. Matches the users' expectation ("It is up to the
  Approver to either Reject ... or move") and the existing single-event request flow, including
  the `conflictDowngradedToPending` downgrade.
- **Soft conflicts for recurring**: `checkRecurringRoomConflicts()` does not compute pending-edit
  soft conflicts (`softConflicts` is always `[]`). Unchanged.
- **`reservationStartMinutes`/`reservationEndMinutes` buffers**: no call site of
  `checkRecurringRoomConflicts()` passes them today (codebase-wide convention pending the legacy
  buffer migration noted at api-server.js ~2609). Not changed here.
- **Teaching `ConflictDialog` a grouped hard-conflict mode**: deferred; §3's panel + toast +
  force affordance cover the incident. The grouped `recurringConflicts` payload rides along in
  the 409 body for any future richer UI.
- **Audit of already-published conflicted series**: a one-off read-only script over
  `recurringConflictSnapshot` (`conflictCount > 0`) is a follow-up, not part of this change.

## Decisions

- **D1 — Block, don't warn-only.** The draft path already established the policy (approvers may
  not push a conflicted series live; admins may). Publish gets the same rule. A warn-only banner
  was rejected: the users' incident shows advisory signals get missed at the moment of approval.
- **D2 — Fail open on check errors, with an observable marker.** If the conflict check itself
  errors, publish proceeds and logs a warning (availability over strictness), but stamps
  `recurringConflictCheckError: true` so unchecked publishes are queryable rather than silent.
- **D3 — Run the check under `forcePublish` too.** Records `recurringConflictSnapshot` for audit
  and makes the existing post-publish warning toasts actually fire on forced publishes (they
  currently never do, because the check is skipped entirely when forcing). Cost: ~3 extra Cosmos
  queries on a deliberate admin override — acceptable.
- **D4 — Flatten for response-shape parity, not for ConflictDialog.** The flattened
  `hardConflicts`/`conflicts` arrays exist so recurring and single hard 409s share one contract
  for the toast/force flow; the grouped payload is preserved separately. ConflictDialog is
  explicitly not in the loop for hard conflicts (it never has been).
- **D5 — Revive `canForce` with the in-button confirmation standard rather than a new dialog.**
  Smallest surface that gives admins in-app recourse; consistent with the repo-wide button
  standard; gate computed in `EventReviewExperience` per the shared-modal-layer rule.
