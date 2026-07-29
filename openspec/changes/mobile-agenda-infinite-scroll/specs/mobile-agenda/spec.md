## MODIFIED Requirements

### Requirement: Data loading with incremental range
The system SHALL render an initial two-week window of day sections and SHALL
extend that window without bound, in both directions, as the reader scrolls
toward either end of the list. Extension SHALL fetch only the days not already
loaded. Selecting a date contiguous with the rendered range SHALL extend it;
selecting a date disjoint from it SHALL replace it.

#### Scenario: Initial load
- **WHEN** the Calendar tab first renders
- **THEN** the system SHALL load events for the current week and next week
- **AND** a loading skeleton SHALL display while data is fetching

#### Scenario: Load more on navigation
- **WHEN** the user navigates the week strip beyond the loaded date range
- **THEN** the system SHALL fetch events for the new date range
- **AND** previously loaded events SHALL remain in memory

#### Scenario: Scrolling toward the end of the list extends it forward
- **WHEN** the reader scrolls within one viewport of the bottom of the agenda list
- **THEN** the system SHALL fetch the next two weeks beyond the loaded range
- **AND** those day sections SHALL be appended once the fetch resolves
- **AND** the list SHALL have no final day at which scrolling stops

#### Scenario: Scrolling toward the start of the list extends it backward
- **WHEN** the reader scrolls within one viewport of the top of the agenda list
- **THEN** the system SHALL fetch the two weeks preceding the loaded range
- **AND** those day sections SHALL be prepended once the fetch resolves

#### Scenario: Backward extension preserves the reader's position
- **WHEN** day sections are prepended above the current scroll position
- **THEN** the content the reader was looking at SHALL remain at the same
  position on screen

#### Scenario: Extension fetches only the uncovered days
- **WHEN** the rendered range is extended by two weeks in either direction
- **THEN** the request SHALL cover only the days outside the already-loaded
  range
- **AND** SHALL NOT re-request days already held in memory

#### Scenario: A pending extension is visible and does not repeat
- **WHEN** an extension fetch is in flight
- **THEN** a loading indicator SHALL appear at the end of the list being extended
- **AND** no further extension SHALL be requested in that direction until the
  scroll position moves again

#### Scenario: A failed extension preserves the loaded list
- **WHEN** an extension fetch fails
- **THEN** the day sections already rendered SHALL remain rendered
- **AND** the list SHALL NOT be replaced by the full-screen error state
- **AND** the reader SHALL be offered a retry at the end that failed

#### Scenario: Selecting a distant date replaces rather than extends the range
- **WHEN** the user selects a date whose two-week window does not overlap the
  rendered range
- **THEN** the rendered range SHALL be replaced by the window around that date
- **AND** the intervening days SHALL NOT be rendered or fetched
- **AND** previously loaded events SHALL remain in memory

#### Scenario: Returning to a previously skipped range refetches it
- **WHEN** the user jumps to a distant date and later navigates back into a
  range that was never fetched
- **THEN** the system SHALL fetch that range rather than treat it as loaded

### Requirement: Pull-to-refresh
The system SHALL support the pull-to-refresh gesture on the agenda list to
reload event data for the entire loaded date range, however far it has been
extended. The gesture SHALL be suppressed for touches that have locked to the
horizontal axis, so that a day-stepping swipe never also refreshes.

#### Scenario: Pull down to refresh
- **WHEN** the user pulls down on the agenda list from the top
- **THEN** the system SHALL reload events for the entire loaded date range
- **AND** a refresh indicator SHALL display during the reload
- **AND** the list SHALL update with fresh data upon completion

#### Scenario: Refresh after the range has been extended
- **WHEN** the reader has extended the range by scrolling and then pulls to
  refresh
- **THEN** every rendered day SHALL be refreshed
- **AND** no rendered day SHALL be left showing data from before the refresh

#### Scenario: Diagonal swipe from the top does not refresh
- **WHEN** a touch begins at the top of the agenda list, locks to the
  horizontal axis, and ends with enough vertical distance to satisfy the
  pull-to-refresh threshold
- **THEN** the system SHALL step the day and SHALL NOT reload events
