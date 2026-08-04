# Spec: conflict-resolution-actions

## ADDED Requirements

### Requirement: Conflicted occurrences open a resolution drawer
`RecurringConflictSummary` SHALL let the user open a resolution drawer for any
conflicted occurrence, by activating either that occurrence's square in the
strip or its row in the conflict list. At most one drawer SHALL be open at a
time; opening a second closes the first. The drawer SHALL show, for every
event blocking that occurrence, its title, status, time range, rooms, and the
name of the person who requested it.

Occurrences with no conflict SHALL NOT be openable.

#### Scenario: Opening a drawer from the strip
- **WHEN** the user activates a conflicted occurrence's square
- **THEN** that occurrence's drawer opens showing each blocking event's title,
  status, time range, rooms, and requester

#### Scenario: Only one drawer at a time
- **WHEN** a drawer is open for Sep 9 and the user opens the drawer for Sep 23
- **THEN** the Sep 9 drawer closes and only the Sep 23 drawer is open

#### Scenario: Clear occurrences are inert
- **WHEN** the user activates a square for an occurrence with no conflict
- **THEN** no drawer opens

#### Scenario: Multiple blocking events on one date
- **WHEN** an occurrence is blocked by two events
- **THEN** the drawer lists both, each with its own detail and its own action
  to open it

### Requirement: The drawer can open the blocking event
The drawer SHALL offer an action that navigates the review modal to a blocking
event. Activating it SHALL call the modal's navigation with that event's `id`
from the conflict record.

When the form has unsaved changes, the navigation SHALL route through the
existing discard-changes guard rather than navigating directly.

#### Scenario: Navigating to a blocking event
- **WHEN** the user activates the open action for a blocking event
- **THEN** the review modal navigates to that event using its conflict-record
  `id`

#### Scenario: Unsaved changes block direct navigation
- **WHEN** the form has unsaved changes and the user activates the open action
- **THEN** the discard-changes guard is shown and no navigation occurs until it
  is resolved

### Requirement: The drawer can skip a conflicted date
The drawer SHALL offer an action that excludes the conflicted occurrence from
the series by adding its date to `recurrence.exclusions` in form state, marking
the form dirty through the same path every other form control uses. No
dedicated persistence endpoint SHALL be introduced; the exclusion is persisted
by the normal form save.

Because the panel's fetch is keyed on a signature that includes the recurrence,
the conflict check SHALL re-run as a consequence of the state change rather
than through an explicit refetch call.

The skip action SHALL NOT be offered when the form's fields are disabled.

The system SHALL refuse to skip the last remaining occurrence in a series and
SHALL explain why.

#### Scenario: Skipping a date
- **WHEN** the user skips the Sep 23 occurrence
- **THEN** `Sep 23` is added to the recurrence exclusions in form state, the
  form is marked dirty, and the conflict check re-runs

#### Scenario: The strip reflects a skipped date
- **WHEN** an occurrence has been skipped but not yet saved
- **THEN** that occurrence renders in a skipped state distinct from both
  conflicted and clear, and the interface states that the change is not saved
  yet

#### Scenario: Skip is unavailable in read-only mode
- **WHEN** the form's fields are disabled
- **THEN** the drawer offers navigation but no skip action

#### Scenario: The last occurrence cannot be skipped
- **WHEN** the user attempts to skip the only remaining occurrence
- **THEN** the skip is refused with an explanation, and the recurrence is
  unchanged

### Requirement: Conflict records identify the requester
`checkRecurringRoomConflicts()` SHALL include the name of the person who
requested each conflicting event, taken from
`roomReservationData.requestedBy.name`, on every conflict record it produces,
for both single-instance conflicts and conflicts sourced from existing series
masters. Events with no reservation data SHALL yield a null value rather than
being omitted.

No other requester identity fields SHALL be included.

#### Scenario: Requester name on a single-instance conflict
- **WHEN** a published single event blocks an occurrence
- **THEN** its conflict record carries the requester's name

#### Scenario: Requester name on a series-master conflict
- **WHEN** an existing recurring series blocks an occurrence
- **THEN** that conflict record carries the requester's name

#### Scenario: Outlook-synced event has no requester
- **WHEN** the blocking event has no reservation data
- **THEN** its conflict record carries a null requester name and the drawer
  identifies it as synced from Outlook

#### Scenario: No contact details are exposed
- **WHEN** any conflict record is produced
- **THEN** it carries no requester email, phone, or user id
