## ADDED Requirements

### Requirement: Calendar tab view switcher
The mobile calendar tab SHALL offer two views — Agenda and 3 Day — via a segmented control rendered on its own right-aligned row beneath the week strip. The active view SHALL persist across sessions in localStorage (`mobile-calendar-view`), defaulting to Agenda when no stored value exists. Switching views SHALL NOT trigger an event refetch and SHALL preserve the selected date.

#### Scenario: Switching to 3 Day view
- **WHEN** the user taps the "3 Day" segment while the agenda is active
- **THEN** the 3-day grid SHALL render for the currently selected date without a network request
- **AND** the "3 Day" segment SHALL show the active pill styling

#### Scenario: View choice persists across sessions
- **WHEN** the user selects the 3 Day view and later reopens the app
- **THEN** the calendar tab SHALL open in the 3 Day view

#### Scenario: First-time default
- **WHEN** a user with no stored view preference opens the calendar tab
- **THEN** the Agenda view SHALL be active

#### Scenario: Switcher placement
- **WHEN** the calendar tab renders in either view
- **THEN** the switcher SHALL appear on its own row beneath the week strip, right-aligned, and SHALL NOT be placed beside the month label (whose caret opens the date picker)

### Requirement: 3-day window follows the selected date
The 3-day grid SHALL display three consecutive day columns with the selected date as the leftmost column. All existing date-navigation affordances (week strip day tap, week chevrons, date picker, Today button) SHALL move the window by changing the selected date only.

#### Scenario: Week strip tap moves the window
- **WHEN** the 3 Day view is active and the user taps a day in the week strip
- **THEN** the grid SHALL re-render with the tapped day as the leftmost column

#### Scenario: Today button
- **WHEN** the user taps the Today button while the 3 Day view is active
- **THEN** the leftmost column SHALL be today

### Requirement: Time grid layout
The 3-day grid SHALL render a 24-hour vertical time grid at 52px per hour with a 44px hour-label gutter, day columns of equal width separated by subtle borders, a hairline at each hour, and hidden scrollbars. The scroll area SHALL have an 8px top inset and SHALL open scrolled to 9 AM. A sticky day-header row (day letter plus number circle, today's number circle filled with the primary color) SHALL remain visible while the grid scrolls; today's column SHALL be tinted with the primary-50 token.

#### Scenario: Initial scroll position
- **WHEN** the 3 Day view first renders
- **THEN** the grid SHALL be scrolled so that the 9 AM line is at the top of the visible area

#### Scenario: Sticky day headers
- **WHEN** the user scrolls the grid vertically
- **THEN** the day-header row SHALL remain pinned above the grid and column-aligned with it

#### Scenario: Today column emphasis
- **WHEN** the visible window includes today
- **THEN** today's column SHALL render with the primary-50 background tint
- **AND** today's header number circle SHALL be filled with primary-600 and inverse text

### Requirement: Current-time indicator
The grid SHALL render a current-time indicator — a 1px error-500 line with a 7px dot at its left edge — only in today's column, positioned by the current local time and updated at least once per minute.

#### Scenario: Indicator on today only
- **WHEN** the visible window includes today and two other days
- **THEN** the time indicator SHALL appear only in today's column at the current time's vertical position

#### Scenario: No today in window
- **WHEN** the visible window does not include today
- **THEN** no current-time indicator SHALL render

### Requirement: Event block rendering
Timed events SHALL render as blocks absolutely positioned by their local start and end times, styled with a 1px outline in the event's category color over a ~13% alpha fill of the same color, small radius, showing the start time (9px semibold) and title (10px medium) with ellipsis clipping. Pending events SHALL render at 0.9 opacity. Blocks SHALL have a minimum height of 20px. Tapping a block SHALL open the shared event detail sheet. Category colors SHALL resolve from the Outlook category presets via the shared resolver, falling back to #cccccc for uncategorized or unknown categories.

#### Scenario: Block position matches times
- **WHEN** an event runs 10:00-11:30 local time
- **THEN** its block SHALL start at the 10:00 line and span 1.5 hour-heights (78px) in its day column

#### Scenario: Pending event opacity
- **WHEN** an event with status pending renders in the grid
- **THEN** its block SHALL render at 0.9 opacity

#### Scenario: Tap opens detail sheet
- **WHEN** the user taps an event block
- **THEN** the event detail sheet SHALL open with that event's details

#### Scenario: Unknown category color
- **WHEN** an event has no categories or a category absent from the Outlook master list
- **THEN** its block SHALL use #cccccc as the category color

### Requirement: Overlapping events split column width
Events in the same day column whose times overlap SHALL be laid out side by side, splitting the column width equally within their overlap cluster.

#### Scenario: Two overlapping events
- **WHEN** two events in the same day column overlap in time
- **THEN** each SHALL occupy half the column width, side by side, with neither obscured

### Requirement: All-day events render in a chip row
All-day events SHALL render as tappable chips in a thin row pinned beneath the sticky day headers, one chip per event in its day's column, using the same outline-over-wash category styling. All-day events SHALL NOT occupy space in the timed grid.

#### Scenario: All-day chip display
- **WHEN** a day in the window has an all-day event
- **THEN** a chip with the event title SHALL render in that day's slot of the all-day row
- **AND** tapping it SHALL open the event detail sheet

### Requirement: Shared data window across calendar views
The agenda and 3-day views SHALL consume the same in-memory event window (the existing rolling range fetched via POST /events/load, filtered to published and pending), with fetching owned by the calendar tab container. The agenda view's user-visible behavior SHALL remain unchanged by this restructure.

#### Scenario: No refetch on view switch
- **WHEN** events are loaded and the user switches between Agenda and 3 Day
- **THEN** no additional /events/load request SHALL be made for the already-loaded range

#### Scenario: Range extension while in 3 Day view
- **WHEN** the user navigates to a date outside the loaded range while the 3 Day view is active
- **THEN** the container SHALL fetch and append the missing range, and the grid SHALL render the new days' events

#### Scenario: Agenda parity after restructure
- **WHEN** the agenda view is active after the restructure
- **THEN** grouping, cards, week strip behavior, pull-to-refresh, and error/retry SHALL behave exactly as before
