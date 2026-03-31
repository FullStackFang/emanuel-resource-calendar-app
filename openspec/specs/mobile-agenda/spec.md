## ADDED Requirements

### Requirement: Agenda displays all events grouped by date
The system SHALL display all calendar events in a vertically scrollable list, grouped by date with date section headers. Events within each date SHALL be sorted by start time ascending.

#### Scenario: Events grouped by date
- **WHEN** the Calendar tab is active and events are loaded
- **THEN** events SHALL be grouped under date headers (e.g., "Today, Mon Mar 31", "Tomorrow, Tue Apr 1", "Wed, Apr 2")
- **AND** events within each date SHALL be sorted by start time ascending

#### Scenario: Empty day display
- **WHEN** a date within the loaded range has no events
- **THEN** the date header SHALL still appear with a "No events" indicator

#### Scenario: All-day events displayed first
- **WHEN** a date has both all-day events and timed events
- **THEN** all-day events SHALL appear before timed events under that date header

### Requirement: Event cards show key information
Each event in the agenda list SHALL be rendered as a card showing the event time, title, location, and status.

#### Scenario: Timed event card content
- **WHEN** a timed event renders in the agenda list
- **THEN** the card SHALL display the start time, event title, location display name, and a status dot (green for published, yellow for pending, gray for draft, red for rejected)

#### Scenario: All-day event card content
- **WHEN** an all-day event renders in the agenda list
- **THEN** the card SHALL display "All Day" instead of a specific time
- **AND** the title, location, and status dot SHALL still be visible

#### Scenario: Event card is tappable
- **WHEN** the user taps an event card
- **THEN** the MobileEventDetail bottom sheet SHALL open with that event's full details

### Requirement: Week strip date picker for navigation
The system SHALL display a horizontal week strip at the top of the agenda view showing 7 days. The strip SHALL be swipeable to navigate between weeks and tappable to select a date.

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

#### Scenario: Today button returns to current date
- **WHEN** the user has navigated away from the current week
- **THEN** a "Today" button SHALL appear
- **AND** tapping it SHALL return the week strip and agenda to today's date

### Requirement: Data loading with incremental range
The system SHALL load events for a 2-week window and load additional weeks as the user navigates forward or backward.

#### Scenario: Initial load
- **WHEN** the Calendar tab first renders
- **THEN** the system SHALL load events for the current week and next week
- **AND** a loading skeleton SHALL display while data is fetching

#### Scenario: Load more on navigation
- **WHEN** the user navigates the week strip beyond the loaded date range
- **THEN** the system SHALL fetch events for the new date range
- **AND** previously loaded events SHALL remain in memory

### Requirement: Pull-to-refresh
The system SHALL support the pull-to-refresh gesture on the agenda list to reload event data for the current date range.

#### Scenario: Pull down to refresh
- **WHEN** the user pulls down on the agenda list from the top
- **THEN** the system SHALL reload events for the currently visible date range
- **AND** a refresh indicator SHALL display during the reload
- **AND** the list SHALL update with fresh data upon completion
