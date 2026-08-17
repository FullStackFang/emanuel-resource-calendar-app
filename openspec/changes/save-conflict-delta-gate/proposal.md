# Save Conflict Delta Gate

Revision 2 — post architecture review (2026-08-17): series-master key qualifier, requester
`thisEvent` branch, buffer minutes on occurrence baselines, OCC ordering, resubmit. Not yet
implemented.

## Why

Field report (2026-08-17): approvers John O'Hara and Daniela Guitelman could remove a room
from the 2026-11-08 occurrence of the pending "Religious School" series in the UI but could
not save; an admin could. Root cause found and fixed client-side the same day
(`ReviewModal.jsx` no longer disables **Save** on `hardConflictBlocks`; the gate stays on
**Approve/Publish**). That fix unblocks the *occurrence* edit because
`PUT /api/admin/events/:id` with `editScope: 'thisEvent'` has no server-side conflict check.

But the same policy defect lives on the server for every other save path, and the client fix
merely moves the wall one step later:

- `PUT /api/admin/events/:id` (general path, single AND recurring) 409s whenever the
  **resulting** state has any hard conflict, `canForce` admin-only. So an approver still cannot
  trim a room from a *whole* pending series (or edit the time of a single pending event) if
  the event has ANY residual collision — even a collision the edit did not create, even a
  collision the edit *reduces*. The 2026-11-08 series shares 22 rooms with the published
  "RS Sunday" series every Sunday: no approver can ever save a change to it. Only an admin
  with `forceUpdate` can.
- `PUT /api/room-reservations/:id/edit` (owner edit, pending/rejected) has the identical
  rule with `canForce: false` — a requester whose pending request already collides can never
  edit it at all, not even to shrink it.

The rule "block a save if the resulting state conflicts" conflates two things:

1. **Introducing** a double-booking — the thing the gate exists to prevent.
2. **Carrying** an existing double-booking — which the save did not cause and often reduces.

Publish/approve is the commitment point and correctly blocks on the *whole* resulting state.
Save on a `pending` event commits nothing; save on a `published` event is already
double-booked if it conflicts, and blocking every later edit does not un-book it.

## What Changes

**Save-time conflict checks block only conflicts the save introduces.** For each save path
that currently runs `checkRoomConflicts` / `checkRecurringRoomConflicts` on the proposed
state, ALSO run it on the stored state (same exclusion, same category rules, same calendar
scope) and 409 only on `proposed − stored`.

- **New pure helper `backend/utils/conflictDelta.js`**: `conflictKey(entry)` and
  `introducedConflicts(baselineHard, proposedHard)`. Deterministic, unit-tested in isolation
  like `concurrencyRules.js`.
- **`PUT /api/admin/events/:id` general path** (~25368): single and recurring branches use
  the delta. Response contract keeps `hardConflicts` as the BLOCKING set (introduced only) so
  the existing toast/force flow is unchanged, and adds `preexistingConflicts` (informational)
  plus `deltaGate: true` so clients can tell which rule produced the 409.
- **`PUT /api/admin/events/:id` occurrence path** (`editScope: 'thisEvent'`, ~25092): gains a
  delta check for the first time. Baseline = the stored occurrence's effective window/rooms
  (existing exception doc if any, else the master's values for that date); proposed = the
  override data. Introduced conflicts → 409 with the same contract, `canForce` admin-only.
  Today this path has NO check, so admins are currently strictly less protected here than on
  the general path; the delta makes both paths agree without regressing the approver fix.
- **`PUT /api/room-reservations/:id/edit`** (owner edit, including rejected→pending
  resubmit): delta on the general branch, AND a new delta check on its `thisEvent` branch
  (~18028-18091), which today — like the admin occurrence path — has no conflict check at
  all. `canForce: false` unchanged.
- **`checkRoomConflicts` surfaces the occurrence it hit** on series-master-derived entries
  (`occurrenceStartDateTime`, additive). Without it the delta key for a recurring
  NEIGHBOUR is stable within one run but not across the two runs it compares — moving a
  single event to a different week that collides with a *different occurrence* of the same
  weekly master would read as pre-existing and save silently (review blocker, design D1).
- **`checkRecurringRoomConflicts` entries gain `rooms`** (ObjectIds, additive) so the
  recurring key can be per-room.
- **`_version` mismatch is answered BEFORE any conflict check** on the general path
  (in-memory compare of the already-fetched doc): `VERSION_CONFLICT`, never a
  `SchedulingConflict` computed from a baseline that OCC is about to reject.
- **Unchanged (whole-state rule stays)**: `/publish`, `/restore` (both), draft `/submit`,
  `/edit-requests/:id/approve` (it publishes the proposal), the in-save exclusion-restore
  pre-check (~25488, restoring a date IS introducing it), and `/rooms/recurring-conflicts`
  (informational). Publishing INTO any conflict remains admin-force-only.
- **Frontend**: `useReviewModal.handleSave` toast prefers `data.message` (already done); the
  message text distinguishes "introduces N new conflict(s)" from the publish wording.
  `ReviewModal`'s "Save & Resubmit" button drops the whole-state `hardConflictBlocks` gate
  the same way Save did (server decides). No new UI.

## Non-goals

- Changing what counts as a conflict (`isRealConflict`, buffers, category grants).
- Changing the publish/approve gate or the admin force mechanism.
- Persisting conflict snapshots. Baseline is computed live against the current calendar —
  "conflicts that already exist right now", not "conflicts that existed at publish time".

## Review outcome (2026-08-17)

Architecture review verdict: **adopt with changes** — all folded into design.md Rev 2.
Alternatives evaluated and rejected: (a) skip conflict gating for `pending` saves entirely
(lets a pending request be edited into a brand-new double-booking with zero server
protection until publish); (b) delta only on the recurring branch (does not cover the
field-reported single-occurrence path nor the single-event/owner paths). Recurrence
PATTERN changes deliberately fall back to "every date is new" (whole-state in effect) —
conservative and correct for a rare edit type.
