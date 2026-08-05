# Spec: recurring-conflict-visibility

## MODIFIED Requirements

### Requirement: Per-occurrence conflict panel in the reservation form
The per-occurrence conflict surface SHALL live inside the
`SchedulingAssistant` as the series occurrence band, driven by a
`useRecurringConflicts` hook that owns the `POST /rooms/recurring-conflicts`
fetch (signature-keyed request, debounced in edit mode, single fetch in
readOnly). `RoomReservationFormBase` SHALL call the hook whenever a
recurrence pattern with `pattern` + `range` is active and at least one room
is selected, passing `recurrence={recurrencePattern}` (the resolved
external-or-internal variable — NOT `formData.recurrence`, which is
undefined), memoized `roomIds` and `categories`, start/end datetimes composed
from the form's date/time fields, buffer minutes,
`excludeEventId = currentReservationId`, `apiToken`, `isAllowedConcurrent`,
and `calendarOwner`. The standalone `RecurringConflictSummary` component
SHALL no longer be mounted below the assistant.

The band SHALL present the series as one element per occurrence, in series
order, each carrying its state — conflicted, clear, or skipped. The chip list
SHALL merge the server's expanded occurrences with the recurrence's exclusion
dates (both saved and session-pending), re-inserted client-side in date
order, so skipped dates remain visible and actionable. The band SHALL be
readable without expanding anything, so that which occurrences are affected
is answerable at a glance.

Because the check blocks publishing, the series verdict chip SHALL read as a
verdict on whether the series can be published, not as an advisory notice,
and SHALL retain the phrase form counting how many of how many occurrences
have room conflicts. The clear state SHALL be correspondingly quiet.

Occurrence detail SHALL NOT be laid out on fixed column widths; room names of
any length SHALL remain legible.

Above the density thresholds the band SHALL degrade per the
`sa-series-navigation` capability rather than rendering an unreadable field
of elements.

#### Scenario: Approver sees conflicting occurrences before deciding
- **WHEN** an approver opens the review modal for a pending recurring series
  with room conflicts on some occurrences
- **THEN** the assistant's band shows how many of how many occurrences
  conflict, and the chips mark which ones, without any user action

#### Scenario: Panel absent for non-recurring events
- **WHEN** the form shows a single (non-recurring) event
- **THEN** no series band renders and no recurring-conflicts request is made

#### Scenario: Conflicted state reads as blocking
- **WHEN** at least one occurrence conflicts
- **THEN** the verdict chip states that publishing is blocked, rather than
  presenting the conflicts as information only

#### Scenario: Clear state is quiet
- **WHEN** no occurrence conflicts
- **THEN** the verdict chip reports the series is clear without the visual
  weight of the blocked state

#### Scenario: Long room names remain legible
- **WHEN** a blocking event occupies several rooms with long names
- **THEN** the names are fully legible and are not truncated by a fixed
  column width

#### Scenario: Saved exclusions stay visible
- **WHEN** the form loads a series whose saved recurrence already excludes
  two dates
- **THEN** those dates render as skipped chips in the band, in series order

#### Scenario: Standalone panel is gone
- **WHEN** the reservation form renders a recurring series
- **THEN** no `RecurringConflictSummary` panel renders below the assistant;
  the band inside the assistant is the only per-occurrence surface
