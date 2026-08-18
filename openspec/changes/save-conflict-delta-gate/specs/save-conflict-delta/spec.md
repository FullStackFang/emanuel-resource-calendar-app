# Spec: save-conflict-delta

Server-side save-time conflict policy: a save is blocked only by hard
conflicts it INTRODUCES, never by hard conflicts the stored event already
carries. Publish/approve/restore/submit keep the whole-state rule.

## ADDED Requirements

### Requirement: Save blocks only introduced hard conflicts
The server SHALL, on every save path that runs a hard-conflict check
(`PUT /api/admin/events/:id` general branch, single and recurring;
`PUT /api/room-reservations/:id/edit` general branch, including
rejected→pending resubmit), compute the hard-conflict set of
the PROPOSED state and, when that set is non-empty, the hard-conflict set of
the STORED state using the same checker, the same `excludeId`, the same
`calendarOwner`, and the stored values for every field the proposed call
would otherwise fall back to. It SHALL return 409 only when
`proposed − stored` (by conflict key, see below) is non-empty. When the
proposed set is empty the stored-state check SHALL NOT run.

#### Scenario: Removing a colliding room saves
- **WHEN** a pending single event's stored rooms collide with a published
  event in room A, and an approver saves it with room A removed and no other
  collision
- **THEN** the response is 200 and the event is updated

#### Scenario: Carrying an unrelated collision saves
- **WHEN** a pending series' stored rooms collide with a published series in
  room B on several dates, and an approver saves it removing room A (not B)
- **THEN** the response is 200; the room-B collisions are unchanged and were
  not a reason to block

#### Scenario: Introducing a collision is blocked
- **WHEN** a pending single event with no stored collisions is saved onto a
  time/room that overlaps a published event
- **THEN** the response is 409 with `error: 'SchedulingConflict'`,
  `conflictTier: 'hard'`, `deltaGate: true`, `hardConflicts` containing only
  the introduced entries, and the event unchanged at its prior `_version`

#### Scenario: Recurring save introducing collisions is blocked
- **WHEN** a pending series with no stored collisions is saved with rooms
  that collide with a published event on 2 of 10 occurrences
- **THEN** the response is 409 with `recurringConflicts.conflictingOccurrences`
  = 2 and `hardConflicts` flattened with `occurrenceDate`

#### Scenario: Extending an existing overlap with a non-recurring neighbour saves
- **WHEN** a stored event already overlaps published single event X in
  room A and the edit lengthens the window so the overlap with X grows
- **THEN** the response is 200 (the key is unchanged; the room is already
  double-booked with X)

#### Scenario: Clean save costs one check
- **WHEN** the proposed state has no hard conflicts
- **THEN** exactly one conflict query batch is issued (the stored-state
  baseline is not computed)

### Requirement: Conflict identity key
`backend/utils/conflictDelta.js` SHALL export pure `conflictKey(entry,
requestRoomIds)` and `introducedConflicts(baselineHard, proposedHard,
requestRoomIds)`. Keys SHALL be built from `String()`-normalized ids. For a
single-window entry whose neighbour is a `singleInstance` / `exception` /
`addition` document the key SHALL be `${id}::${roomId}` for each shared room
(`entry.rooms ∩ requestRoomIds`). For a single-window entry whose neighbour
is a published series master the key SHALL additionally carry the occurrence
the checker met: `${id}::${roomId}::${occurrenceStartDateTime}`. For the
recurring-source branch the key SHALL be
`${occurrenceDate}::${id}::${roomId}`.

#### Scenario: Same master, different occurrence, is new
- **WHEN** a pending single event's stored window collides with weekly
  published master M in room A on one Monday, and the edit moves it to a
  different Monday that collides with a different occurrence of M in room A
- **THEN** the response is 409 (the occurrence-qualified key differs)

#### Scenario: Same neighbour, additional room, is new
- **WHEN** the stored event collides with published event X in room A and
  the edit adds room B, which X also occupies
- **THEN** the response is 409 with `hardConflicts` naming X for room B

#### Scenario: ObjectId and string ids compare equal
- **WHEN** the neighbour's `rooms` are ObjectIds and the request rooms are
  strings for the same room
- **THEN** the key matches and the conflict is classed as pre-existing

### Requirement: Checker result shapes carry what the key needs
`checkRoomConflicts()` SHALL surface `occurrenceStartDateTime` on
hard-conflict entries derived from a published series master (the
occurrence it met before `break`). `checkRecurringRoomConflicts()` per-date
`hardConflicts[]` entries SHALL carry `rooms` (the neighbour's location
ObjectIds) alongside the existing `roomNames`. Both additions are additive;
no existing field changes meaning.

#### Scenario: Master-derived entry names its occurrence
- **WHEN** `checkRoomConflicts()` reports a published weekly master as a
  hard conflict
- **THEN** the entry carries `occurrenceStartDateTime` equal to the
  overlapping occurrence's start, not the master's stored series start

### Requirement: 409 response contract
The delta 409 body SHALL keep `hardConflicts` as the BLOCKING (introduced)
set and `conflicts` as introduced + soft, and SHALL add
`preexistingConflicts` (baseline ∩ proposed, informational) and
`deltaGate: true`. `message` SHALL read
`Cannot save: this change introduces N new scheduling conflict(s)` (recurring:
`... on N of M occurrence(s)`). `canForce`/`forceField`/`_version` are
unchanged per path: admin general path `canForce: true, forceField:
'forceUpdate'`; owner-edit `canForce: false`.

#### Scenario: Pre-existing conflicts are reported, not blocking
- **WHEN** a save introduces 1 conflict while the stored event carries 3
- **THEN** `hardConflicts.length` = 1, `preexistingConflicts.length` = 3,
  `deltaGate: true`

### Requirement: Occurrence edits are delta-checked
The server SHALL run the delta check for `editScope: 'thisEvent'` on BOTH
`PUT /api/admin/events/:id` and `PUT /api/room-reservations/:id/edit`,
before writing the exception document. Proposed = the override data merged over the
effective occurrence (existing exception overrides, else master values for
that date); baseline = the effective occurrence before the override. Buffer
minutes (`reservationStart/EndMinutes`, `setup/teardownTimeMinutes`) SHALL be
read from the master's `calendarData` with the existing `??` chain, not from
the merged occurrence fields. The exclusion set SHALL be the whole series
family (`resolveSeriesExclusionIds(master._id)`). Admin path:
`canForce: effectiveRole === 'admin'`, `forceField: 'forceUpdate'`; owner
path: `canForce: false`.

#### Scenario: Approver removes a room from a colliding occurrence
- **WHEN** an approver saves a pending series occurrence with one inherited
  room removed, while other inherited rooms still collide with published
  events on that date
- **THEN** the response is 200 and the exception document is written

#### Scenario: Occurrence moved into a new collision is blocked
- **WHEN** an approver saves a series occurrence adding a room that a
  published event occupies at that time
- **THEN** the response is 409 with `deltaGate: true` and `canForce: false`

#### Scenario: Admin can force an occurrence collision
- **WHEN** an admin does the same with `forceUpdate: true`
- **THEN** the response is 200; without `forceUpdate` it is 409 with
  `canForce: true, forceField: 'forceUpdate'`

#### Scenario: Buffer-only collision on an occurrence is caught
- **WHEN** the master has a 30-minute setup buffer and the only overlap with
  a published event falls inside that buffer
- **THEN** the occurrence delta check still reports it (buffers came from the
  master, not the merged occurrence)

#### Scenario: Requester occurrence edit into a collision is blocked
- **WHEN** a requester edits their own pending series occurrence onto a
  published event's room/time
- **THEN** the response is 409 with `canForce: false`

### Requirement: Version mismatch is answered before conflict checks
The server SHALL, on `PUT /api/admin/events/:id`, when the request carries `_version` /
`expectedVersion` and it differs from the fetched event's `_version`, the
server SHALL return the existing `VERSION_CONFLICT` 409 BEFORE any conflict
query is issued.

#### Scenario: Stale client gets VERSION_CONFLICT, not SchedulingConflict
- **WHEN** a save arrives with a stale `_version` for an event whose
  proposed state would also introduce a conflict
- **THEN** the response is `VERSION_CONFLICT` and no conflict query ran

### Requirement: Whole-state paths are unchanged
The following SHALL keep whole-state blocking: `PUT /api/admin/events/:id/publish`, `PUT /api/edit-requests/:id/approve`,
both `/restore` endpoints, `POST /api/room-reservations/draft/:id/submit`,
and the exclusion-restore pre-check inside the general save SHALL keep
blocking on the whole resulting state.

#### Scenario: Publish into a carried conflict still blocks
- **WHEN** an approver publishes a pending event whose stored rooms collide
  with a published event
- **THEN** the response is the existing whole-state 409 (regression guard)
