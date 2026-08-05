# Design: Room conflict report

## Context

`checkRoomConflicts()` (api-server.js ~2606) is the system's only conflict
authority, and it is shaped for a single question: given one candidate
reservation, what does it collide with? It runs at write time — publish, admin
save, owner edit, restore — and returns `{ hardConflicts, softConflicts,
allConflicts }`.

A report inverts the traversal: across a window, which events collide with each
other? The overlap arithmetic and the allowance rules are the same; the
traversal, the cost model, and the output identity are not.

Three properties of the existing code constrain the design and are cited
throughout:

1. **A series master's stored date range is the series span, not an
   occurrence.** api-server.js:2653-2660 documents this: a master's
   `calendarData.endDateTime` holds the series end (e.g. 2027-06-30), so
   including masters in a date-range query makes the "encompassing" overlap
   case match any same-room event anywhere in the span. Masters must be
   fetched by `eventType` and expanded, never matched by date.
2. **Stored datetimes are local-time strings with no `Z`.**
   `checkRoomConflicts` converts its window bounds with a local-getter
   `toLocalISOString` helper (~2625-2629) precisely because comparisons are
   made against these strings. Any new range query must do the same.
3. **Overlap is not conflict.** Lines 2867-2915 encode a bilateral rule:
   either event's category may whitelist the other's category, and there is a
   legacy per-event `isAllowedConcurrent` fallback beneath it.

## Goals

- Surface genuine room double-bookings among published events that no existing
  check can see.
- Cost that scales with events in the window, not the width of the window.
- One definition of "conflict" shared with the publish path.
- Drill-in that reuses the existing modal and permission layer rather than
  re-deriving either.

## Non-goals

See `proposal.md`. The load-bearing one is per-calendar scoping (D6), which is
a deliberate blind spot rather than an oversight.

## Decisions

### D1 — All-pairs sweep over room-day buckets, not N conflict checks

Calling `checkRoomConflicts()` once per event would guarantee identical
semantics and is rejected anyway. Each call issues roughly four queries; a
90-day window holding ~1,500 occurrences is ~6,000 queries per page load on
Cosmos. It also emits every conflict twice (A→B and B→A) requiring dedup, and
it cannot attribute a conflict to a specific occurrence of a series because it
collapses a master to a single "this series conflicts" verdict (`break` at
~2826).

Instead: four bounded reads, then all comparison happens in memory. Occurrences
are bucketed by `(roomId, dayKey)` and each bucket is swept — sort by effective
start, maintain an active set, compare each arrival only against actives whose
effective end is still open.

Bucketing is not only a performance device. It gives each conflict a natural
identity — a room, a day, an interval — which is the grouping the report is
asked to present.

**An occurrence is inserted into every day-bucket its effective window
touches.** An event spanning midnight, or one whose setup buffer pushes its
effective start into the previous day, belongs to two buckets. Bucketing on
effective start-day alone silently drops those pairs.

### D2 — Extract the allowance predicate; do not duplicate it

The bilateral category test and legacy fallback move verbatim to
`backend/utils/concurrencyRules.js` as a pure `isRealConflict(sideA, sideB,
categoryMap)`. `checkRoomConflicts()` is rewritten to call it.

The alternative — the report carrying its own copy — is rejected because this
codebase has already been bitten by exactly that failure. The admin-save
recurring gate checked `totalHardConflicts`, a field that never existed, so a
check that read correctly did nothing at all for months. Two definitions of
"conflict" drift, and here drift means the report tells an approver to fix
something that publish considers legal, which destroys the report's credibility
on first contact.

The extraction changes no logic. Its safety is established by **baseline
comparison, not by assertion**: main is red, so the only honest proof is
running the affected suites before and after via `git stash` and comparing
counts.

The current code names its two sides `request` and `conflict`, which reads
asymmetrically, but the logic is genuinely bilateral. The extracted function
takes `sideA` / `sideB` and the extraction must preserve the existing
short-circuit order exactly: A-grants-B, then B-grants-A, then the legacy
per-event branches.

### D3 — Violations only

Overlaps the concurrency rules permit are not listed and are not counted. The
report is a defect list.

The accepted cost: a misconfigured category allow-list suppresses a genuine
conflict from the report with no indication. This was weighed against listing
permitted overlaps behind a toggle and rejected as scope the first version does
not need.

### D4 — Read-only

No acknowledge, no dismiss, no fix panel, no writes. A conflict leaves the list
when the underlying events change. This keeps the entire backend surface a
single GET and means the change adds no collection, no schema field, and no
concurrency concern.

### D5 — Forward-only window, presets only

`days` ∈ {30, 90, 180, 365}, default 90, always starting today. Any other value
is a 400 rather than a clamp — a silently clamped window would misreport its
own coverage.

Past conflicts are excluded because they cannot be fixed. An arbitrary
start/end picker was considered for post-mortems and deferred.

### D6 — Per-calendar scoping, with a filter

The scan compares events within one `calendarOwner`, matching every existing
check, with an optional filter to narrow to a specific mailbox.

**This is a known, accepted blind spot.** A room is a physical object; the same
room booked at the same time from two different mailboxes is genuinely
double-booked, and no check in the system can currently see it. Recorded here
so that a future reader finds a decision rather than infers a bug.

### D7 — No server-side cache

Four indexed reads on a deliberate, approver-triggered action is cheap. A cache
would introduce the worst possible failure mode for a defect list: an approver
fixes a conflict, re-runs, and still sees it. Staleness here costs more than
RU. Revisit only if RU measurement says otherwise.

### D8 — Report the contested interval

Each conflict carries `overlapStart` / `overlapEnd` — the intersection of the
two effective windows — as its headline, with each side's real times shown
beneath.

This matters because buffers make conflicts invisible in the visible times. A
2:00-3:00 event with 30 minutes of teardown collides with a 2:45 event; a row
reading "2:00-3:00 vs 2:45-4:00" leaves an approver staring at two times that
look fine to them. Naming the contested interval is the difference between a
report that explains itself and one that gets argued with.

Effective windows use the exact fallback precedence already in
`checkRoomConflicts` (~2612-2613):
`reservationStartMinutes ?? calendarData.reservationStartMinutes ??
setupTimeMinutes ?? calendarData.setupTimeMinutes ?? 0`, and the teardown
mirror. Reproducing this precedence rather than simplifying it is required —
the fallbacks exist because legacy events do not all carry the outer bounds.

### D9 — Degrade visibly; never a false all-clear

The governing error rule. A scan that could not complete must not render as
"no conflicts," because a false all-clear on a defect list is strictly worse
than an error: the approver leaves believing the calendar is clean.

Each read is wrapped in `withCosmosRetry`. If a read fails but others succeed,
the response carries `degraded: [{ stage, message }]` and the results obtained
so far, and the view banners the incompleteness above the list. Total failure
is a 500 with an error state and a retry — never an empty list.

This follows the sync-health precedent, where `calendar.degraded` is
deliberately a banner and not `error`, because `error` suppresses all findings.

### D10 — Pairs, not clusters

Three events overlapping in one room emit pairwise conflicts, not one merged
"3-way conflict" row. A/B may contest 2:00-2:30 while B/C contest 3:00-3:30
with A and C never touching; a merged row cannot state a truthful contested
interval. Room-day grouping already presents them together, so clustering would
buy presentation at the cost of accuracy.

### D11 — Drill-in through `EventReviewExperience`

One instance mounted at report level, fed by a selected id — the same
single-instance pattern the other callers use. Per the `EventReviewExperience`
contract, the report passes raw permissions and caller-specific props and
derives no gates itself.

Loading a side reuses `navigateToEvent`'s fallback: `/api/room-reservations/:id`,
and on 404 `GET /api/events/:id` adapted by `adaptEventToReservationShape()`
(exported from `useReviewModal.jsx:62`). **The fallback is mandatory, not
defensive** — Outlook-synced events are expected to be a large share of the
rows and none of them carry `roomReservationData`.

The report stays mounted beneath the overlay, so scroll position survives
without special handling. The report query is invalidated when the modal
reports a save or delete, so a resolved conflict disappears on close.

### D12 — Four reads, masters by type

| # | Query | Bounded by | Index |
|---|---|---|---|
| 1 | Published `singleInstance` / `exception` / `addition` / null-type events overlapping the window | window dates | `calData_startDateTime` / `calData_endDateTime` |
| 2 | Published series masters | `eventType` | `conflict_series_masters` |
| 3 | Exception/addition children of those masters, for occurrence suppression | master ids | `exception_master_date` |
| 4 | Categories and locations | — | already 5-minute cached |

Query 3 is separate from query 1 rather than reusing it: an exception document
that moved its occurrence *outside* the window still has to suppress the
master's in-window occurrence, and query 1 by definition would not return it.

Expansion subtracts `recurrence.exclusions` and any date carrying an
exception/addition child. A total cap of 20,000 expanded occurrences sets
`truncated: true` — a stated limit, never a silent drop.

## Risks

- **The extraction touches the hot path.** Mitigated by making it a pure move
  with no logic change and proving invariance by stash-baseline on
  `recurringConflict.test.js`, `architecturalBugs.test.js`, and
  `recurringAvailability.test.js`.
- **The report may surface a large number of pre-existing conflicts on first
  run.** This is the point of the change, but it should be expected rather
  than treated as a defect in the scan.
- **Cosmos index availability.** The compound-on-nested index
  `conflict_status_locations_dates` may be rejected by this Cosmos account
  (documented at api-server.js:695-701). The single-field nested indexes
  `calData_startDateTime` / `calData_endDateTime` are legal and sufficient for
  query 1; the design does not depend on the compound index existing.

## Open questions

None blocking. Deferred by decision: cross-mailbox scanning (D6), permitted-
overlap visibility (D3), acknowledgement (D4), and arbitrary date ranges (D5).
