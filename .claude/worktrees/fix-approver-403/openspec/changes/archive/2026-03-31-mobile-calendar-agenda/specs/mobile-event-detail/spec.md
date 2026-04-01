## ADDED Requirements

### Requirement: Event detail bottom sheet
The system SHALL display event details in a bottom sheet overlay that slides up from the bottom of the screen when an event card is tapped.

#### Scenario: Bottom sheet opens on event tap
- **WHEN** the user taps an event card in the agenda list
- **THEN** a bottom sheet SHALL slide up from the bottom of the screen
- **AND** the sheet SHALL display the selected event's details
- **AND** the agenda list SHALL remain visible but dimmed behind the sheet

#### Scenario: Bottom sheet dismissal by tap outside
- **WHEN** the bottom sheet is open
- **AND** the user taps the dimmed area outside the sheet
- **THEN** the sheet SHALL slide down and close

#### Scenario: Bottom sheet dismissal by drag
- **WHEN** the bottom sheet is open
- **AND** the user drags the sheet handle downward
- **THEN** the sheet SHALL slide down and close

#### Scenario: Bottom sheet maximum height
- **WHEN** the bottom sheet opens
- **THEN** the sheet SHALL NOT exceed 85% of the dynamic viewport height (85dvh)
- **AND** content exceeding this height SHALL be scrollable within the sheet

### Requirement: Event detail fields displayed
The bottom sheet SHALL display key event fields in a clear, readable layout. All fields are read-only.

#### Scenario: Published event detail
- **WHEN** a published event's detail sheet opens
- **THEN** the sheet SHALL display: event title, status badge ("Published" in green), date and time range, location name(s), requester name and department, categories, event description, and attendee count if available

#### Scenario: Pending event detail
- **WHEN** a pending event's detail sheet opens
- **THEN** the sheet SHALL display the same fields as a published event
- **AND** the status badge SHALL show "Pending" in yellow

#### Scenario: Event with setup/teardown times
- **WHEN** an event has setup time, teardown time, door open, or door close times
- **THEN** the detail sheet SHALL display these timing fields in a dedicated section

#### Scenario: Event without optional fields
- **WHEN** an event does not have a description, attendee count, or timing fields
- **THEN** those sections SHALL be omitted from the detail sheet (not shown as empty)

### Requirement: Status badge styling
The event detail sheet SHALL display a status badge with color coding consistent with the desktop application.

#### Scenario: Status badge colors
- **WHEN** the detail sheet renders a status badge
- **THEN** published events SHALL show a green badge
- **AND** pending events SHALL show a yellow badge
- **AND** draft events SHALL show a gray badge
- **AND** rejected events SHALL show a red badge
