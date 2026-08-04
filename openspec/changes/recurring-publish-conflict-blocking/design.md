# Design: Recurring Publish Conflict Blocking

## Context

An approved recurring class series silently double-booked a room against a
migrated published event. `PUT /api/admin/events/:id/publish`
(api-server.js:21900) branches on `isRecurringPublish` (line 21952): the
single-event branch hard-blocks with a 409 (`canForce: true`, admin-only
override), while the recurring branch runs `checkRecurringRoomConflicts()`
(defined at line 3049) inside a try/catch, attaches the result to the success
response, and always publishes. The comment at line 21948 documents this as
intentional ("non-blocking"), and the test suite
`publishRecurringConflict.test.js` asserts the non-blocking behavior as
correct.

The policy the org actually wants already exists in the draft-submit path
(`conflictDowngradedToPending`, api-server.js ~16526): approvers cannot push a
conflicted recurring series live; admins can. Publish never got the gate.

Compounding gaps, all verified against current source:

- **Dead admin-save gate**: `PUT /api/admin/events/:id` line 25383 checks
  `recurringConflicts.totalHardConflicts > 0` and line 25387 interpolates
  `occurrencesWithConflicts` — neither field exists in
  `checkRecurringRoomConflicts()`'s return
  (`{ totalOccurrences, conflictingOccurrences, cleanOccurrences, conflicts,
  allOccurrences }`), so the 409 never fires.
- **Dead conflict panel**: `src/components/RecurringConflictSummary.jsx` is a
  complete per-occurrence conflict UI (calls
  `POST /api/rooms/recurring-conflicts`, renders "N of M occurrences have room
  conflicts" with expandable detail, supports `readOnly` and debounced live
  modes) — imported nowhere.
- **Dead force path**: `useReviewModal.jsx:962` returns
  `{ canForce, forceField }` from hard 409s, but nothing in `src/` ever sends
  `forcePublish: true` or renders an override affordance; admins blocked by a
  hard conflict get only a toast.
- **Blind review UI**: the review modal's `SchedulingAssistant`
  (RoomReservationFormBase.jsx:2439) visualizes only the first occurrence's
  day; a conflict on occurrence #7 is invisible at decision time.

## Goals / Non-Goals

**Goals:**

- Recurring publish reaches parity with single-event publish and the existing
  draft policy: hard conflicts → 409, `canForce: true`, admin-only override.
- The approver can see *which* occurrences conflict before deciding
  (revive `RecurringConflictSummary` in the review modal and editor form).
- Admins get an in-app force-publish affordance (revives the dead `canForce`
  path for both recurring and single events — one mechanism).
- The dead admin-save gate actually fires.
- Forced publishes still record a `recurringConflictSnapshot` for audit and
  trigger the existing post-publish warning toasts.

**Non-Goals:**

- Requester submit paths stay non-blocking (conflicted series may still land
  in `pending`; triage is the approver's job, per the existing
  `conflictDowngradedToPending` policy).
- No soft-conflict computation for recurring
  (`checkRecurringRoomConflicts()` returns no `softConflicts`; unchanged).
- No `ConflictDialog` changes — its four modes
  (`status_changed`/`already_actioned`/`soft_conflict`/`data_changed`) never
  handled hard conflicts, and still won't. The grouped `recurringConflicts`
  payload rides in the 409 body for any future richer UI.
- No `reservationStartMinutes`/`reservationEndMinutes` buffer plumbing into
  `checkRecurringRoomConflicts()` (no call site passes them today; pending the
  legacy buffer migration noted at api-server.js ~2609).
- No audit/backfill of already-published conflicted series (follow-up script
  over `recurringConflictSnapshot.conflictCount > 0`).

## Decisions

### D1: Block, don't warn-only

If `recurringConflicts.conflictingOccurrences > 0` and `!forcePublish`, the
publish endpoint returns 409. Rejected alternative: a warn-only banner — the
incident shows advisory signals get missed at the moment of approval, and the
draft path already established blocking as policy. The existing admin-only
`forcePublish` gate at line 21924 (403 for non-admins, checked before the
conflict logic) already enforces who may override; no change there.

**409 body shape** — grouped payload plus flattened parity arrays:

```js
{
  error: 'SchedulingConflict',
  conflictTier: 'hard',
  message: `Cannot publish: ${rc.conflictingOccurrences} of ${rc.totalOccurrences} occurrence(s) have scheduling conflicts`,
  recurringConflicts: rc,      // grouped per-occurrence payload
  hardConflicts: flattened,    // single-event 409 entry shape + occurrenceDate
  softConflicts: [],
  conflicts: flattened,
  canForce: true,
  forceField: 'forcePublish',
  _version: event._version     // matches single-event 409s at :21998/:22009
}
```

`flattened` maps each `rc.conflicts[].hardConflicts[]` entry to
`{ id, eventTitle, startDateTime, endDateTime, roomNames, status,
occurrenceDate }`. The flattening exists so recurring and single hard 409s
share one contract for the toast/force flow (D4 in proposal) — the frontend's
existing hard-409 handling at `useReviewModal.jsx:959-962` works unmodified.

### D2: Fail open on check errors, with an observable marker

If `checkRecurringRoomConflicts()` throws, publish proceeds (current behavior
— blocking on Cosmos 429 noise would strand approvals) but the publish `$set`
records `recurringConflictCheckError: true` alongside the existing warn log.
Without the marker, the fail-open path silently reproduces the original
incident under exactly the failure mode most likely during real load.
Rejected alternative: fail closed — availability over strictness, and the
marker makes unchecked publishes queryable.

### D3: Run the check under `forcePublish` too

Today the whole conflict block is inside `if (!forcePublish)` (line 21954), so
a forced publish records no `recurringConflictSnapshot`, and the post-publish
safety-net toasts in Calendar/MyReservations/ReservationRequests (keyed off
`recurringConflicts` in the response) never fire for forced publishes — the
exact case they exist for. Restructure: the recurring check always runs
(still try/catch non-fatal); only the *409 decision* is gated on
`!forcePublish`. The single-event branch keeps its existing
`!forcePublish`-gated structure. Cost: ~3 extra Cosmos queries on a deliberate
admin override — acceptable.

### D4: Fix the admin-save gate by renaming fields, not restructuring

At api-server.js:25383/25387, replace the phantom `totalHardConflicts` /
`occurrencesWithConflicts` with `conflictingOccurrences` (repo-wide grep
confirms these two lines are the only references). Add the same `flattened`
`hardConflicts`/`conflicts` arrays for response-shape parity with the publish
endpoint. The flattening helper is shared between the two endpoints (small
function near `checkRecurringRoomConflicts`).

### D5: Mount `RecurringConflictSummary` in `RoomReservationFormBase`

Rendered directly below the `SchedulingAssistant` container (~line 2439)
whenever a recurrence with `pattern` + `range` is active and ≥1 room is
selected. This one mount covers both the approver's review modal (readOnly
mode) and the requester/editor form (debounced live mode) via the component's
existing `readOnly` prop.

**Prop wiring (the part that silently no-ops if done wrong):**

- `recurrence={recurrencePattern}` — the resolved variable at line 262
  (`externalRecurrencePattern` when lifted by `RoomReservationReview`, else
  internal state). Local `formData` does NOT carry `.recurrence`;
  `formData.recurrence` would be `undefined` and the component would return
  null.
- `roomIds` and `categories` memoized at the caller (mirror the
  `assistantRooms` `useMemo` at line 689) — a fresh `[]` literal per render
  would defeat the debounce.
- `startDateTime`/`endDateTime` composed from
  `formData.startDate/startTime/endDate/endTime`; buffer minutes;
  `excludeEventId = currentReservationId`; `apiToken`;
  `isAllowedConcurrent`; `readOnly` per mode.
- New `calendarOwner` prop from the form's effective calendar
  (`effectiveDefaultCalendar`), included in the request body — the endpoint
  already accepts it; omitting it mis-scopes results in multi-mailbox
  deployments.

### D6: Harden the component's fetch stability before first live mount

`fetchConflicts` is a `useCallback` whose deps include arrays/objects
(`recurrence`, `roomIds`, `categories`), consumed by
`useEffect([fetchConflicts, readOnly])` (RecurringConflictSummary.jsx:105-124).
With unstable parent references, readOnly mode refetches on every parent
render and form mode's 1200ms debounce resets perpetually. Fix inside the
component so all future callers are safe: key the effect on a serialized
request signature (`JSON.stringify` of recurrence, roomIds, start/end
datetimes, buffer minutes, categories, `isAllowedConcurrent`,
`excludeEventId`, `calendarOwner`) instead of callback identity. Caller
memoization (D5) remains good practice but is no longer load-bearing.

### D7: Revive `canForce` via the in-button confirmation standard

When the approve call returns `{ success: false, canForce: true, forceField }`
and the viewer is an admin, the Approve/Publish button in `ReviewModal.jsx`
enters the repo-standard in-button confirmation state ("Publish Anyway?",
warning color, pulse; persists until acted on — no `window.confirm`, no
timeout). Second click resends the approve request with
`[forceField]: true`.

- **Gate location**: `ReviewModal.jsx` computes it next to the analogous
  `hardConflictBlocks = hasSchedulingConflicts && !isAdmin` (line 212, via its
  own `usePermissions()`). `ReviewModal` is the single shared rendering
  surface, so the gate is computed once, not per caller — consistent with the
  `EventReviewExperience` contract's intent even though this is a raw-flag
  (`isAdmin`) + server-response gate, not a threaded derived flag.
- **Retry mechanics**: mirror the soft-conflict precedent at
  `useReviewModal.jsx:924-956` (stored retry closure resending with
  `acknowledgeSoftConflicts: true`); the force path substitutes
  `forcePublish: true`. Alternative rejected: a new confirmation dialog —
  larger surface, violates the no-browser-dialog standard's spirit of
  in-place confirmation.
- Because the gate reads the shared approve flow's result, the same affordance
  revives force-publish for single-event hard conflicts too — one mechanism.
- Non-admin approvers get the blocking toast only, matching the backend 403
  and the draft-path policy.

### D8: Rewrite the PRC suite rather than adding alongside it

`publishRecurringConflict.test.js` (PRC-1..5) asserts the bug as intended
behavior. PRC-1/PRC-2 flip to assert 409; PRC-3 moves to the forced-publish
path (admin `forcePublish: true` → 200 + snapshot); PRC-4 (single-event
regression guard) and PRC-5 (clean series → 200) stay. Shipping without the
rewrite means the change lands with a suite that re-asserts the bug and goes
red. New RCC cases (12-14) lock the 403 gate, the admin-save fix, and the
fail-open marker; RCC-14 induces the check failure at the Mongo-driver level
(`jest.spyOn(Collection.prototype, 'find')` with a selective throw, per the
`publishRollback.test.js` precedent) because `checkRecurringRoomConflicts` is
an unexported internal.

## Risks / Trade-offs

- [Approvers with in-flight legitimate conflicted publishes get hard-blocked
  after deploy] → intended policy change; the mounted summary panel shows them
  exactly which dates conflict, and escalation to an admin is the designed
  path (matches draft flow they already use).
- [Fail-open marker adds a field queries don't know about] → additive only;
  `recurringConflictCheckError` is written solely on the failure path and read
  by humans/scripts, never by app logic.
- [Signature-keyed effect serializes on every render] → `JSON.stringify` of a
  small request object is negligible next to a render; correctness of the
  debounce wins.
- [Flattened + grouped payloads duplicate data in the 409 body] → deliberate
  (D1); bodies are small (bounded by occurrence count) and one round-trip.
- [Force affordance appears mid-flow if a non-conflicting publish races into a
  conflict] → the second click resends through the same endpoint; the backend
  re-validates everything (status, version, 403 gate) on the forced attempt.
- [Running the check under force adds latency to admin overrides] → ~3 Cosmos
  queries; acceptable for a deliberate, rare action (D3).

## Migration Plan

Pure behavior change; no schema migration. Deploy backend and frontend
together (frontend relies on the new 409 contract only additively — old
frontend against new backend shows the toast, which is safe-blocking; new
frontend against old backend simply never sees a recurring 409). Rollback is a
redeploy of the previous build.

## Open Questions

None — resolved during investigation and architecture review (revision 2 of
the proposal incorporates the review findings: PRC suite contradiction, dead
frontend force path, ConflictDialog scope correction, recurrence prop source,
fetch-stability hardening).
