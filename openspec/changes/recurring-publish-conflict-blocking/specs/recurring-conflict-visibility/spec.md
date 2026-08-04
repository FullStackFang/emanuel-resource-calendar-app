# Spec: recurring-conflict-visibility

## ADDED Requirements

### Requirement: Per-occurrence conflict panel in the reservation form
`RoomReservationFormBase` SHALL render `RecurringConflictSummary` directly
below the `SchedulingAssistant` container whenever a recurrence pattern with
`pattern` + `range` is active and at least one room is selected. The mount
SHALL pass `recurrence={recurrencePattern}` (the resolved
external-or-internal variable — NOT `formData.recurrence`, which is
undefined), memoized `roomIds` and `categories`, start/end datetimes composed
from the form's date/time fields, buffer minutes,
`excludeEventId = currentReservationId`, `apiToken`, `isAllowedConcurrent`,
and `readOnly` per mode (readOnly in the approver's review modal, debounced
live mode in the editor form).

#### Scenario: Approver sees conflicting occurrences before deciding
- **WHEN** an approver opens the review modal for a pending recurring series
  with room conflicts on some occurrences
- **THEN** the panel shows "N of M occurrences have room conflicts" with
  expandable per-date detail, without any user action

#### Scenario: Panel absent for non-recurring events
- **WHEN** the form shows a single (non-recurring) event
- **THEN** no `RecurringConflictSummary` renders

### Requirement: Fetch stability keyed on request signature
`RecurringConflictSummary` SHALL trigger its fetch effect from a serialized
request signature (recurrence, roomIds, start/end datetimes, buffer minutes,
categories, `isAllowedConcurrent`, `excludeEventId`, `calendarOwner`) rather
than callback identity, so unstable parent references cannot cause repeated
readOnly fetches or perpetually reset the form-mode debounce.

#### Scenario: One fetch across parent re-renders in readOnly mode
- **WHEN** the parent re-renders repeatedly with unchanged inputs (fresh array
  references) in readOnly mode
- **THEN** exactly one request is issued

### Requirement: Conflict scope includes the calendar owner
`RecurringConflictSummary` SHALL accept a `calendarOwner` prop and include it
in the `POST /api/rooms/recurring-conflicts` request body, sourced from the
form's effective calendar, so results are correctly scoped in multi-mailbox
deployments.

#### Scenario: calendarOwner sent in the request
- **WHEN** the panel fetches conflicts for a form whose effective calendar is
  a specific mailbox
- **THEN** the request body contains that `calendarOwner`
