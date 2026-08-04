# Spec: recurring-publish-blocking

## ADDED Requirements

### Requirement: Recurring publish blocks on hard conflicts
`PUT /api/admin/events/:id/publish` SHALL run
`checkRecurringRoomConflicts()` for recurring events (recurrence with
`pattern` + `range`, at least one room) and, when
`conflictingOccurrences > 0` and `forcePublish` is not set, SHALL return 409
with `error: 'SchedulingConflict'`, `conflictTier: 'hard'`,
`canForce: true`, `forceField: 'forcePublish'`, the grouped
`recurringConflicts` payload, flattened `hardConflicts`/`conflicts` arrays in
the single-event entry shape with an added `occurrenceDate`, and the event's
current `_version`. The event SHALL remain `pending` with `_version`
unchanged.

#### Scenario: Conflicted series is blocked
- **WHEN** an approver publishes a pending recurring series where 2 of 8
  occurrences collide with a published event's room
- **THEN** the response is 409 with `conflictTier: 'hard'`,
  `recurringConflicts.conflictingOccurrences` = 2,
  `canForce: true`, and the event is still `pending` at its prior `_version`

#### Scenario: Flattened entries name the conflicting occurrence
- **WHEN** the recurring 409 is returned
- **THEN** each `hardConflicts[]` entry carries
  `{ id, eventTitle, startDateTime, endDateTime, roomNames, status,
  occurrenceDate }` so message text can name which session collides

#### Scenario: Clean series publishes
- **WHEN** a recurring series has no conflicting occurrences
- **THEN** the publish returns 200 and no conflict snapshot with conflicts is
  recorded

#### Scenario: Single-event blocking is unchanged
- **WHEN** a non-recurring pending event with a hard conflict is published
- **THEN** the response is the existing single-event 409 (regression guard)

### Requirement: Only admins may force-publish through conflicts
The existing pre-check gate SHALL continue to return 403 when a non-admin
sends `forcePublish: true`. An admin's `forcePublish: true` SHALL publish the
series despite conflicts.

#### Scenario: Approver cannot force
- **WHEN** an approver (non-admin) sends `forcePublish: true`
- **THEN** the response is 403 and the event is unchanged

#### Scenario: Admin force succeeds
- **WHEN** an admin sends `forcePublish: true` for a conflicted series
- **THEN** the response is 200 and the event is published

### Requirement: Conflict check runs even when forcing
`checkRecurringRoomConflicts()` SHALL run regardless of `forcePublish`
(wrapped in try/catch, non-fatal on error) so a forced publish still records
`recurringConflictSnapshot` with correct counts and the response still carries
`recurringConflicts` for the post-publish warning toasts.

#### Scenario: Forced publish records the snapshot
- **WHEN** an admin force-publishes a series with 2 conflicting occurrences
- **THEN** the stored event carries a `recurringConflictSnapshot` reflecting
  the 2 conflicts and the 200 response includes `recurringConflicts`

### Requirement: Check failures fail open but observably
If `checkRecurringRoomConflicts()` throws during publish, the publish SHALL
proceed, log at warn level, and the publish `$set` SHALL record
`recurringConflictCheckError: true` so unchecked publishes are queryable.

#### Scenario: Conflict check error does not block publish
- **WHEN** the conflict check throws (e.g., Cosmos failure) during a recurring
  publish
- **THEN** the response is 200 and the stored event has
  `recurringConflictCheckError: true`

### Requirement: Admin-save recurring gate fires
`PUT /api/admin/events/:id` SHALL gate recurring saves on
`recurringConflicts.conflictingOccurrences > 0` (replacing the phantom
`totalHardConflicts`/`occurrencesWithConflicts` fields) and return a 409 with
the same flattened `hardConflicts`/`conflicts` parity arrays as the publish
endpoint.

#### Scenario: Editing a published series into a conflict is blocked
- **WHEN** an admin save moves a published recurring series onto a time that
  conflicts with another published event's room
- **THEN** the response is 409 and the series is unchanged
