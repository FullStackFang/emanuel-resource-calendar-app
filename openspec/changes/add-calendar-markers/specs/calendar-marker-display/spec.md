## ADDED Requirements

### Requirement: Marker ribbon in Month view
For each day covered by an active marker, the Month view SHALL display a transparent-wash ribbon at the top of the day cell showing the marker name. Holiday markers SHALL use a gold wash (accent-500 at low opacity) with `--color-accent-700` text; Office Closed markers SHALL use a red wash (error-500 at low opacity) with `--color-error-700` text. The ribbon SHALL NOT alter the existing "today" highlight.

#### Scenario: Holiday ribbon
- **WHEN** a day is covered by an active `holiday` marker
- **THEN** the Month view renders a gold transparent-wash ribbon with the marker name at the top of that day cell

#### Scenario: Office Closed ribbon
- **WHEN** a day is covered by an active `officeClosed` marker
- **THEN** the Month view renders a red transparent-wash ribbon with the marker name

#### Scenario: Today highlight preserved
- **WHEN** a marked day is also today
- **THEN** the existing blue "today" indicator still renders alongside the ribbon

### Requirement: Marker ribbon in Week and Day views
The Week and Day views SHALL render the same ribbon color and label scheme in each affected day-column header.

#### Scenario: Week and Day header ribbon
- **WHEN** a marked day is visible in the Week or Day view
- **THEN** its day-column header shows the marker ribbon in the type's color

### Requirement: Multi-day marker rendering
A marker spanning multiple days SHALL render the ribbon on every day within its inclusive range.

#### Scenario: Ribbon repeats across the span
- **WHEN** a marker spans several consecutive days
- **THEN** every day in the inclusive range displays the ribbon

### Requirement: Multiple markers on one day
When a day is covered by more than one active marker, the views SHALL render each marker's ribbon.

#### Scenario: Holiday and closure on the same day
- **WHEN** a single day is covered by both a `holiday` and an `officeClosed` marker
- **THEN** both ribbons are rendered for that day

### Requirement: Soft reservation advisory
When a user selects a date in a booking form that is covered by an active marker with `warnOnReservation` true, the system SHALL show a dismissible, non-blocking advisory that names the marker and its type. The advisory SHALL NOT block submission and SHALL NOT trigger a scheduling conflict.

#### Scenario: Advisory shown for a flagged day
- **WHEN** a user selects a date covered by a marker with `warnOnReservation` true
- **THEN** a non-blocking advisory naming the marker is shown and the user can still submit the booking

#### Scenario: No advisory without the flag
- **WHEN** a user selects a date covered by a marker with `warnOnReservation` false
- **THEN** no advisory is shown

#### Scenario: Advisory never blocks
- **WHEN** the advisory is displayed
- **THEN** no 409 scheduling conflict is raised and the booking proceeds unchanged if submitted
