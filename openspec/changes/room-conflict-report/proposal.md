# Room conflict report

## Why

Every conflict check in the system is *one-vs-many*: `checkRoomConflicts()`
answers "given this candidate reservation, what does it hit?" and runs on
publish, admin save, owner edit, and restore. Nothing anywhere answers
"across the whole calendar, what is double-booked right now?"

That gap is not theoretical. Graph delta sync writes Outlook-originated events
straight into `templeEvents__Events` without running any conflict check at all,
so an event created in Outlook can land on top of an approved reservation and
no code path will ever notice. Forced publishes (`forcePublish`, admin-only)
deliberately write into a known conflict. Events edited after approval can move
into a collision. In every one of those cases the double-booking exists in the
database and is invisible until two groups show up at the same room.

Approvers currently have no way to find these. The only remedy available is to
open the calendar and look, room by room, day by day.

## What Changes

- **A new read-only report at `/admin/reports/conflicts`**, reachable by
  admins and approvers — the same audience and the same gate as the existing
  Sync Health report. It scans a forward window and lists every genuine room
  double-booking among published events, grouped by date and room.
- **The scan is an all-pairs sweep, not N conflict checks.** Four bounded
  reads, then recurring masters are expanded in memory only inside the window,
  occurrences are bucketed by `(room, day)`, and each bucket is swept with an
  active-interval line. Cosmos cost scales with events in the window, not with
  the width of the window.
- **The concurrency-allowance decision is extracted and shared.** The bilateral
  category-grant test plus the legacy `isAllowedConcurrent` fallback currently
  live inside a filter closure in `checkRoomConflicts()`. They move to a pure
  function that both the publish-time check and the report call, so the report
  can never disagree with what publish permits.
- **Each conflict names the contested interval**, not the two events' spans.
  With setup and teardown buffers in play two events can collide while their
  visible times do not overlap, and showing only the visible times produces a
  row an approver will argue with.
- **Clicking either side opens the existing review modal** over the report, via
  `EventReviewExperience`, so all permission gating stays where the contract
  says it lives. Loading a side reuses `navigateToEvent`'s
  `/api/room-reservations/:id` → `GET /api/events/:id` fallback, which is
  mandatory here because a large share of conflict sides are Outlook-synced
  events carrying no `roomReservationData`.
- **A scan that could not complete never renders as "no conflicts."** Partial
  read failure degrades visibly with a banner and whatever results were
  obtained; it does not silently report a clean calendar.

No breaking changes. No schema change, no new collection, no writes of any
kind.

## Capabilities

### New Capabilities

- `concurrency-rule-evaluation`: the single definition of whether two events
  sharing a room and a time window actually constitute a conflict — the
  bilateral category grant, the legacy per-event flag, and their precedence —
  lifted out of the publish-time check so more than one caller can use it
  without the two drifting apart.
- `room-conflict-report`: the scan itself and its HTTP contract — window
  semantics, which events are eligible, how recurring series contribute
  occurrences, how conflicts are identified and grouped, degradation
  behavior, and the permission gate.
- `conflict-report-view`: the approver-facing surface — route, navigation
  entry, grouping, loading and empty semantics, and drill-in to the review
  modal.

### Modified Capabilities

None. `checkRoomConflicts()` is refactored to call the extracted predicate,
but its observable behavior — the 409 contract, `hardConflicts` /
`softConflicts` / `allConflicts` shapes, and every conflict tier — is
unchanged by design, and that invariance is verified by baseline comparison
rather than assumed.

## Impact

**Backend**
- `backend/utils/concurrencyRules.js` — new, pure, no I/O.
- `backend/services/conflictReportService.js` — new; the four reads, the
  occurrence normalization, the bucketing, and the sweep.
- `backend/api-server.js` — `checkRoomConflicts()` delegates to the extracted
  predicate at **both** sites that currently carry the rules: the
  `actualConflicts` filter (~2867-2915) and the pending-edit loop (~2941-2971),
  which is a hand-copy of the same logic. New
  `GET /api/admin/reports/conflicts` endpoint alongside the existing
  sync-health report endpoint (~12267).

**Frontend**
- `src/components/ConflictReport.jsx` / `.css` — new.
- `src/App.jsx` — new route; `RequireSyncHealth` renamed to
  `RequireApproverReport` and shared by both report routes, since the guard
  predicate is identical and two copies would have to be kept in sync by hand.
- `src/components/Navigation.jsx` — top-level entry for non-admin approvers,
  Admin dropdown entry for admins, mirroring the Sync Health treatment.

**Documentation**
- `CLAUDE.md` — `conflictReportService.js` added to the `calendarData`-removal
  refactor checklist, since it reads `calendarData.*` paths like every other
  service and that checklist exists so the refactor does not miss new call
  sites.

**Unaffected**
- The event schema, the status machine, optimistic concurrency, SSE, and every
  existing conflict endpoint's request and response contract.
- `checkRecurringRoomConflicts()` and the recurring publish 409 path.

## Non-goals

Recorded as decisions, not omissions:

1. **Cross-mailbox room collisions.** The scan is scoped per `calendarOwner`,
   matching the semantics of every existing check. This leaves a real blind
   spot: a room is a physical object, so the same room booked at the same time
   from two different mailboxes is genuinely double-booked, and no check in the
   system — including this report — can see it. Deliberately deferred.
2. **Acknowledging or dismissing a conflict.** The report is read-only. A
   conflict leaves the list when the underlying events change. If an overlap is
   genuinely acceptable, the correct remedy is configuring the category
   allow-list, which the report already honors.
3. **Displaying overlaps the concurrency rules permit.** Violations only.
4. **A fix or reconcile panel.** Remediation happens in the review modal.
5. **Conflicts in the past.** Forward-only from today.
6. **Pending-versus-published collisions.** That is the approval queue's job.
7. **Non-room conflicts** — staff, clergy, or equipment double-booking.
