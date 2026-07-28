## MODIFIED Requirements

### Requirement: Week strip date picker for navigation
The system SHALL display a horizontal week strip at the top of the agenda view
showing 7 days. The strip SHALL be swipeable to navigate between weeks and
tappable to select a date. The strip's selected day SHALL reflect the day
currently at the top of the agenda viewport, which changes both by tapping and
by scrolling the list.

#### Scenario: Week strip shows current week by default
- **WHEN** the Calendar tab loads
- **THEN** the week strip SHALL display the current week with today highlighted
- **AND** days with events SHALL show dot indicators below the date number

#### Scenario: Tap date to scroll agenda
- **WHEN** the user taps a date in the week strip
- **THEN** the agenda list SHALL scroll to that date's section
- **AND** the tapped date SHALL become the selected date in the strip

#### Scenario: Swipe week strip to change week
- **WHEN** the user swipes left on the week strip
- **THEN** the strip SHALL navigate to the next week
- **AND** event data for the new date range SHALL load if not already cached

#### Scenario: Scrolling the agenda updates the selected day
- **WHEN** the user scrolls the agenda list so that a different day's section
  reaches the top of the viewport
- **THEN** that day SHALL become the strip's selected day
- **AND** the strip SHALL display the week containing it

#### Scenario: Today button returns to current date
- **WHEN** the user has navigated away from the current week
- **THEN** a "Today" button SHALL appear
- **AND** tapping it SHALL return the week strip and agenda to today's date

### Requirement: Pull-to-refresh
The system SHALL support the pull-to-refresh gesture on the agenda list to
reload event data for the current date range. The gesture SHALL be suppressed
for touches that have locked to the horizontal axis, so that a day-stepping
swipe never also refreshes.

#### Scenario: Pull down to refresh
- **WHEN** the user pulls down on the agenda list from the top
- **THEN** the system SHALL reload events for the currently visible date range
- **AND** a refresh indicator SHALL display during the reload
- **AND** the list SHALL update with fresh data upon completion

#### Scenario: Diagonal swipe from the top does not refresh
- **WHEN** a touch begins at the top of the agenda list, locks to the
  horizontal axis, and ends with enough vertical distance to satisfy the
  pull-to-refresh threshold
- **THEN** the system SHALL step the day and SHALL NOT reload events
