# Spec: sa-series-navigation

## ADDED Requirements

### Requirement: The SchedulingAssistant enters series mode for active recurrences
When the form has a recurrence with `pattern` + `range` and at least one
requested room, `SchedulingAssistant` SHALL render a series occurrence band
inside its own chrome, between the assistant header and the room tabs. The
band SHALL show one date chip per occurrence (month abbreviation + day
number), each carrying its state — conflicted, clear, or skipped — plus a
series meta line naming the recurrence pattern and a series verdict chip.
For single (non-recurring) events, or when no room is selected, the assistant
SHALL render exactly as it does today, with no band and no behavior change.

#### Scenario: Band renders for a recurring series
- **WHEN** the form has an active weekly recurrence and one room selected
- **THEN** the assistant shows a date chip for every occurrence, each marked
  conflicted, clear, or skipped

#### Scenario: No band for single events
- **WHEN** the form describes a non-recurring event
- **THEN** the assistant renders without the series band, unchanged from
  current behavior

#### Scenario: Band disappears when rooms are cleared
- **WHEN** the last requested room is removed from a recurring form
- **THEN** the band unmounts

### Requirement: Occurrence chips retarget the timeline via a view date
Selecting an occurrence chip SHALL set a series view date, owned by
`RoomReservationFormBase`, that is distinct from the form's start date. The
assistant's day timeline, day-availability fetch, room-tab conflict badges,
and event summary SHALL all follow the view date. Browsing occurrences SHALL
NOT modify `formData.startDate`, any other form field, or the form's dirty
state. The view date SHALL reset to the form's start date whenever it no
longer corresponds to an occurrence or exclusion of the current recurrence
(pattern, range, or room changes).

#### Scenario: Clicking a chip shows that day
- **WHEN** the user clicks the Sep 8 chip
- **THEN** the timeline, room-tab badges, and header date show Sep 8, and the
  day-availability query runs for Sep 8

#### Scenario: Browsing never edits the form
- **WHEN** the user browses several occurrence days and closes the form
- **THEN** the form's date fields are unchanged and no unsaved-changes state
  was introduced by browsing

#### Scenario: View date resets on recurrence change
- **WHEN** the user is viewing occurrence Sep 8 and edits the recurrence so
  Sep 8 is no longer an occurrence
- **THEN** the assistant returns to the form's start date

#### Scenario: Conflict gating ignores browsed days
- **WHEN** the user browses to a conflicted occurrence day that is not the
  form's start date
- **THEN** the assistant's day-conflict callback does not alter the parent
  form's scheduling-conflict gating

### Requirement: Conflicts-only focus compresses clear days
The band SHALL offer a focus toggle with two states, all dates and conflicts
only, the latter labeled with a live conflicted count. In conflicts focus,
chips for non-conflicted occurrences SHALL compress to small state squares,
remain visible in series order, and become inert to selection; conflicted
chips SHALL keep their full size and remain selectable. Entering conflicts
focus while a non-conflicted occurrence is selected SHALL move the selection
to the first conflicted occurrence.

#### Scenario: Entering conflicts focus
- **WHEN** the user activates the conflicts focus with 3 conflicts in a
  12-occurrence series
- **THEN** the 9 non-conflicted chips compress to small squares and the 3
  conflicted chips stay full size

#### Scenario: Compressed chips are inert
- **WHEN** conflicts focus is active and the user clicks a compressed clear
  chip
- **THEN** the selection does not change

#### Scenario: Focus entry jumps to a conflict
- **WHEN** a clear day is selected and the user switches to conflicts focus
- **THEN** the first conflicted occurrence becomes selected

### Requirement: A stepper walks conflicted occurrences
The band SHALL provide previous/next controls that step through conflicted
occurrences only, in series order, wrapping at the ends, together with a
position indicator reading which conflict of how many is selected. The
controls SHALL be disabled when no occurrence conflicts. Stepping SHALL
perform the same view-date retargeting as chip selection.

#### Scenario: Stepping to the next conflict
- **WHEN** conflict 1 of 3 is selected and the user activates next
- **THEN** the second conflicted occurrence's day is shown and the indicator
  reads conflict 2 of 3

#### Scenario: Stepper wraps
- **WHEN** the last conflicted occurrence is selected and the user activates
  next
- **THEN** the first conflicted occurrence is selected

#### Scenario: Stepper disabled when clear
- **WHEN** no occurrence conflicts
- **THEN** both stepper controls are disabled

### Requirement: The band degrades with series length
Above 60 occurrences the chips SHALL drop their date labels and render as
small state squares while retaining selection, focus, and stepper behavior.
Above 150 occurrences the chip row SHALL be replaced by a compact text
summary plus the conflict list, with the stepper remaining as the navigation
affordance.

#### Scenario: Dense series drops labels
- **WHEN** the series has 80 occurrences
- **THEN** occurrences render as unlabeled state squares that still select on
  click

#### Scenario: Very long series collapses the row
- **WHEN** the series has 200 occurrences
- **THEN** no chip row renders; a compact summary and the conflict list
  appear and the stepper still navigates between conflicts
