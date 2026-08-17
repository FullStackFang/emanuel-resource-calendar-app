# Design — Save Conflict Delta Gate

Revision 2 (2026-08-17) — incorporates architecture review findings: series-master key
instability across the two runs (blocker), buffer-minutes on occurrence baselines, the
requester `thisEvent` branch, OCC-vs-conflict ordering, resubmit, ObjectId normalization.
Not yet implemented.

## Context (what the code does today)

Conflict producers, both in `backend/api-server.js`:

- `checkRoomConflicts(reservation, excludeId)` (~2608) — single window. Returns
  `{ hardConflicts, softConflicts, allConflicts }`; a hard entry is
  `{ id, eventTitle, startDateTime, endDateTime, rooms (conflicting event's ObjectIds),
  status, setupTimeMinutes, teardownTimeMinutes, isAllowedConcurrent, allowedConcurrentCategories }`.
  Published series masters are expanded per occurrence and reported ONCE per master
  (`break` after first overlap, ~2808-2834); `_occurrenceStartDateTime/_occurrenceEndDateTime`
  are computed on the internal entry but NOT surfaced in the result (~2918-2929), which
  uses the master's stored (series-span) dates.
- `checkRecurringRoomConflicts(params)` (~2970) — expands the source series, checks each
  occurrence window. Returns `{ totalOccurrences, conflictingOccurrences, conflicts:
  [{ occurrenceDate, hardConflicts: [{ id, eventTitle, startDateTime, endDateTime,
  roomNames (display names, NOT ids), status, requestedBy }] }] }`.
  `flattenRecurringConflicts()` (~3172) spreads `occurrenceDate` onto each entry.
- Both apply `isRealConflict()` (`utils/concurrencyRules.js`) and `calendarOwner` scoping.
- Both exclude the source event AND its series family via `resolveSeriesExclusionIds`.
- Buffers: `reservationStartMinutes ?? calendarData.reservationStartMinutes ??
  setupTimeMinutes ?? calendarData.setupTimeMinutes ?? 0` (`??`, so an explicit 0 shadows).

Save-time consumers (whole-state rule today):

| Path | Line | Branches | Force |
|---|---|---|---|
| `PUT /api/admin/events/:id` general | ~25368 | recurring → `checkRecurringRoomConflicts`; single → `checkRoomConflicts` | admin `forceUpdate` |
| `PUT /api/admin/events/:id` thisEvent | ~25092 | **none** | n/a |
| `PUT /api/room-reservations/:id/edit` general (incl. rejected→pending resubmit, `isResubmitEdit` ~18093) | ~18183 | single only | none |
| `PUT /api/room-reservations/:id/edit` thisEvent | ~18028-18091 | **none** | n/a |

Gate condition on the admin general path:
`timeOrRoomChanged && ['pending','published'].includes(event.status) && !forceUpdate`.

## D1: Conflict identity — what makes a conflict "the same one"

The delta needs a key per hard-conflict entry that is stable between the baseline run and
the proposed run. All ids are `String()`-normalized before comparison (`rooms` arrive as
ObjectIds from the projection; request rooms arrive as strings from the client — without
normalization every key mismatches and the delta always reports "introduced").

- **Single-window neighbour that is a `singleInstance` / `exception` / `addition` doc**:
  `${conflict.id}::${roomId}` for each `roomId ∈ conflict.rooms ∩ requestRooms`. Per-room,
  so adding room B — which the same neighbour X also occupies — IS introduced (a new
  double-booked room) even though X was already a conflict via room A.
- **Single-window neighbour that is a published series MASTER** (found by expansion inside
  `checkRoomConflicts`): the master's `_id` is stable within one call but NOT across the two
  calls the delta compares. Repro: pending single event P collides with weekly master M in
  room A on Mon 3/2 (baseline key `M::A`); approver moves P to Mon 3/23 — still Monday, still
  room A, still collides with M but with a DIFFERENT occurrence; proposed run also yields
  `M::A` → nothing "introduced" → a genuinely new double-booking saves silently. Fix:
  `checkRoomConflicts` surfaces `occurrenceStartDateTime` (from `_occurrenceStartDateTime`)
  on master-derived entries — additive field — and the key for those entries becomes
  `${conflict.id}::${roomId}::${occurrenceStartDateTime}`. Non-master entries keep the
  unqualified key (their stored window cannot shift between the two calls unless a third
  party edits them mid-request, which OCC on THEIR write already covers).
- **Recurring source branch**: `${occurrenceDate}::${conflict.id}::${roomId}`. Requires
  `checkRecurringRoomConflicts` to also emit `rooms` (ObjectIds) on each entry — it already
  has `calendarData.locations` in `CONFLICT_PROJECTION`; today it maps only
  `locationDisplayNames`. Additive.
- **Not part of the key**: overlap extent/time — but ONLY for non-master neighbours. If the
  stored event overlaps X by 5 min in room A and the edit extends it to swallow X's whole
  slot, the key is unchanged and the save is allowed: the room is already double-booked with
  X, and "worse overlap with an existing collision" is an approver judgment, not a new
  booking. For master neighbours the occurrence qualifier above already makes "same master,
  different occurrence" a new key, which is correct — that IS a different collision.

`conflictKey(entry, requestRoomIds)` and `introducedConflicts(baselineHard, proposedHard,
requestRoomIds)` live in a new pure module `backend/utils/conflictDelta.js`, unit-tested in
isolation like `concurrencyRules.js`.

## D2: Baseline = the stored event, checked live, with identical parameters

Baseline hard set = the SAME checker, called with the stored values the proposed call would
have fallen back to (`cd.startDateTime`, `cd.locations`, stored recurrence, stored buffers,
stored categories) and the SAME `excludeId`/`calendarOwner`. Category grants and buffers are
therefore applied symmetrically. Anything true of the baseline is, by construction, "already
the case in the calendar right now".

**The baseline run is only performed when the proposed run returned ≥1 hard conflict.** This
is mandatory, not an optimisation option: it keeps the common (clean) save at today's
one-check cost and pays the second Cosmos round-trip only on the exceptional path where
there is something to adjudicate. Both runs stay sequential (burst guidance in
`checkRoomConflicts`).

**OCC ordering (accepted pre-existing race, documented here).** The general path fetches
`event` with an unguarded `findOne` (~25081) and runs the conflict block (~25368) BEFORE
`conditionalUpdate` with `expectedVersion` (~26377). A stale client can therefore receive
`SchedulingConflict` (or a 200 whose baseline was computed from state that then fails OCC)
where `VERSION_CONFLICT` would have been the honest answer. The proposal does not change
this ordering; it makes the baseline load-bearing, so the race is now stated: when
`_version` in the request differs from the fetched `event._version`, return
`VERSION_CONFLICT` BEFORE running any conflict check. That is a cheap in-memory compare of
already-fetched data (no extra read) and turns an accident of code order into a contract.
Locked by a test (SCG-13).

Not chosen: persisting a conflict snapshot on the document — stale under calendar churn.

## D3: Response contract — `hardConflicts` stays the BLOCKING set

```
409 {
  error: 'SchedulingConflict', conflictTier: 'hard',
  message: 'Cannot save: this change introduces N new scheduling conflict(s)',
  hardConflicts:        [ ...introduced ],          // unchanged meaning: what blocks
  preexistingConflicts: [ ...baseline ∩ proposed ], // NEW, informational
  conflicts: [ ...introduced, ...soft ],
  deltaGate: true,                                  // NEW
  canForce, forceField, _version                    // unchanged per path
}
```

`useReviewModal.handleSave` already prefers `data.message`; nothing else on the client reads
`hardConflicts.length` on Save except that fallback string. `SchedulingAssistant`'s live
badges are unaffected (they visualise the day, not the delta).

## D4: Occurrence paths get a delta check (new) — BOTH actors

`editScope: 'thisEvent'` today writes the exception doc with no check at all on BOTH
`PUT /api/admin/events/:id` (~25092-25225) and `PUT /api/room-reservations/:id/edit`
(~18028-18091). Add, via one shared helper:

- proposed window/rooms = `overrideData` merged over the effective occurrence (existing
  exception doc overrides, else master values for `dateKey`);
- baseline = the effective occurrence BEFORE the override;
- **buffer minutes come from `masterDoc.calendarData`** (`reservationStart/EndMinutes` /
  `setup/teardownTimeMinutes` via the same `??` chain), NOT from the merged occurrence
  fields — `INHERITABLE_FIELDS` / `extractOverrideData` carry only HH:MM strings, so a naive
  construction silently computes 0-minute buffers on both sides and misses a buffer-zone-only
  collision outright;
- exclude the whole series family (`resolveSeriesExclusionIds(masterDoc._id)`), so the
  master's own expansion never self-conflicts, whether `id` was the master, the child, or a
  virtual occurrence;
- 409 on introduced conflicts. Admin path: `canForce: effectiveRole === 'admin'`,
  `forceField: 'forceUpdate'`. Owner path: `canForce: false`.

This keeps the approver fix intact — removing a room introduces nothing, and if the proposed
run itself finds zero hard conflicts there is nothing to subtract and nothing to block,
independent of the baseline — while closing the hole where an occurrence could be MOVED into
a fresh conflict with no server check.

## D5: Which paths keep the whole-state rule, and resubmit

Publish (`/publish`), approve-edit-request (publishes the proposal), both `/restore`s, draft
`/submit`, and the exclusion-restore pre-check inside the general save all decide whether an
event ENTERS the published calendar (or re-enters a date). Whole-state is correct there and is
untouched. Non-admin approvers still cannot approve/publish into a conflict; the client keeps
`hardConflictBlocks` on Approve.

**Resubmit (rejected → pending) IS delta-gated**, deliberately: it shares the owner-edit
route and, like any pending save, commits nothing to the published calendar — approval does.
Consequence: `ReviewModal.jsx` line ~648 ("Save & Resubmit") still disables on the
whole-state `hardConflictBlocks`; that gate must be revisited exactly as Save's was (server
decides; the button gates on `hasChanges`/`isFormValid` only) or the client over-blocks the
case the server now allows — the same client/server disagreement that produced the original
report, in the safe direction. Covered by an extra ReviewModal test (SCG-5 in the existing
`saveConflictGate` suite).

## Test plan (minimum; names are the ones the review proposed)

Existing locked tests need NO change: `editConflict.test.js` EC-1..4 and
`recurringConflict.test.js` RCC-13 are all "stored-clean → proposed-conflicting", i.e.
genuinely introduced, and stay 409. None of today's tests exercise the carrying/reducing
case — that coverage is new.

New unit: `conflictDelta.test.js` — key normalisation (ObjectId vs string), per-room
intersection, master occurrence qualifier, recurring `(date, id, room)` key.

New integration (`backend/__tests__/integration/events/saveConflictDelta.test.js`):
1. SCG-1 general/single: stored conflict via room A; save drops room A → 200.
2. SCG-2 general/single: stored clean; save moves into conflict with Y → 409, `deltaGate`.
3. SCG-3 (locks D1 master fix) general/single vs weekly published master M: stored collides
   with M on date D1; save moves to another week, same weekday/room → still 409.
4. SCG-4 general/recurring: stored series conflicts on 3/10 dates via one room; save drops
   that room → 200.
5. SCG-5 general/recurring: stored clean; new rooms conflict on 2/10 dates → 409,
   `conflictingOccurrences: 2`.
6. SCG-6 owner-edit: stored conflict; edit narrows the window, still overlapping the same
   neighbour/room → 200 (locks "extent not keyed").
7. SCG-7 general/single: baseline run is NOT performed when the proposed run is clean
   (spy on the collection: one conflict query batch, not two).
8. SCG-8/9/10 admin thisEvent: (a) occurrence collides via inherited rooms, edit removes the
   colliding room → 200 (the field-report repro at endpoint level); (b) edit adds a colliding
   room → 409, `canForce: true`, `forceField: 'forceUpdate'`; (c) same as (b) as approver →
   409, `canForce: false`.
9. SCG-11 (locks D4 buffers) admin thisEvent: the only conflict is buffer-zone-only → still
   caught.
10. SCG-12 (locks D4 owner) owner-edit thisEvent: requester moves own occurrence into a new
    conflict → 409, `canForce: false`.
11. SCG-13 (locks D2 ordering) general: stale `_version` + would-be conflict →
    `VERSION_CONFLICT`, not `SchedulingConflict`, and no conflict query issued.

Frontend: `ReviewModal.saveConflictGate.test.jsx` +1 (Save & Resubmit no longer disabled
by the conflict flag; still disabled without changes).
