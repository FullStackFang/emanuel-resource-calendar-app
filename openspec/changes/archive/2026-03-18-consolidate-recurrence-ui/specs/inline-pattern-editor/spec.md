## ADDED Requirements

### Requirement: Pattern editor renders inline in Recurrence tab left column
The Recurrence tab left column SHALL render the full pattern editor (frequency selector, interval input, day-of-week buttons, end date picker, styled calendar preview) directly — not behind a modal or button click.

#### Scenario: No existing pattern — creation mode
- **WHEN** user opens the Recurrence tab and no recurrence pattern exists
- **THEN** the left column displays the pattern editor fields with defaults (frequency=weekly, interval=1, no end date) and a "Create" action to apply the pattern

#### Scenario: Existing pattern — edit mode
- **WHEN** user opens the Recurrence tab and a recurrence pattern exists
- **THEN** the left column displays the pattern editor fields populated with current pattern values (frequency, interval, days of week, end date) and changes take effect immediately on the occurrence list

#### Scenario: Calendar preview matches modal styling
- **WHEN** the inline calendar renders in the left column
- **THEN** pattern dates, ad-hoc additions, and ad-hoc exclusions are highlighted with the same color scheme as the former RecurrencePatternModal (blue for pattern, green for additions, red for exclusions)

#### Scenario: Calendar date click toggles add/exclude
- **WHEN** user clicks a date on the inline calendar
- **THEN** the date toggles between states: pattern date click excludes it, excluded date click restores it, non-pattern date click adds it, added date click removes it

### Requirement: RecurrencePatternModal is no longer used
No component SHALL render or open RecurrencePatternModal. All pattern editing happens inline in the Recurrence tab.

#### Scenario: Modal is not triggered from Recurrence tab
- **WHEN** user interacts with the Recurrence tab (create, edit, any action)
- **THEN** no modal overlay appears for pattern editing

#### Scenario: Modal is not triggered from Details tab
- **WHEN** user views the Details tab
- **THEN** no recurrence card, "Manage Recurrence" link, or "Set Up Recurrence" button is present

### Requirement: Recurrence card removed from Details tab
RoomReservationFormBase SHALL NOT render recurrence summary cards, "Manage Recurrence" links, or "Set Up Recurrence" buttons. The Recurrence tab is the sole UI for recurrence management.

#### Scenario: Details tab has no recurrence UI
- **WHEN** user views the Details tab for an event with a recurrence pattern
- **THEN** no recurrence information or controls are rendered on that tab

### Requirement: Occurrence list updates reactively as pattern changes
The right column occurrence list SHALL update in real-time as the user modifies pattern fields (frequency, interval, days, end date) in the left column.

#### Scenario: Change frequency updates occurrence list
- **WHEN** user changes frequency from weekly to daily in the left column
- **THEN** the occurrence list immediately reflects the new set of dates without requiring a save or refresh
