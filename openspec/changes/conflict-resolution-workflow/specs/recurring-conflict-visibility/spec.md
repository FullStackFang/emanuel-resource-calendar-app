# Spec: recurring-conflict-visibility

## MODIFIED Requirements

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

The panel SHALL present the series as an occurrence strip: one element per
occurrence, in series order, each carrying its state — conflicted, clear, or
skipped. The strip SHALL be readable without expanding anything, so that which
occurrences are affected is answerable at a glance. Per-occurrence detail SHALL
be reached through the resolution drawer rather than through a flat expandable
list.

Because the check now blocks publishing, the panel's conflicted state SHALL
read as a verdict on whether the series can be published, not as an advisory
notice. The clear state SHALL be correspondingly quiet.

Occurrence detail SHALL NOT be laid out on fixed column widths; room names of
any length SHALL remain legible.

Above a threshold occurrence count the strip SHALL degrade to a compact
summary rather than rendering an unreadable field of elements.

#### Scenario: Approver sees conflicting occurrences before deciding
- **WHEN** an approver opens the review modal for a pending recurring series
  with room conflicts on some occurrences
- **THEN** the panel shows how many of how many occurrences conflict, and the
  strip marks which ones, without any user action

#### Scenario: Panel absent for non-recurring events
- **WHEN** the form shows a single (non-recurring) event
- **THEN** no `RecurringConflictSummary` renders

#### Scenario: Conflicted state reads as blocking
- **WHEN** at least one occurrence conflicts
- **THEN** the panel states that publishing is blocked, rather than presenting
  the conflicts as information only

#### Scenario: Clear state is quiet
- **WHEN** no occurrence conflicts
- **THEN** the panel reports the series is clear without the visual weight of
  the blocked state

#### Scenario: Long room names remain legible
- **WHEN** a blocking event occupies several rooms with long names
- **THEN** the names are fully legible and are not truncated by a fixed column
  width

#### Scenario: Very long series degrade gracefully
- **WHEN** the series has more occurrences than the strip can present legibly
- **THEN** the panel shows a compact summary and the conflict list instead of
  the full strip
