# mobile-three-day Specification

## Purpose

Defines the layout contract of the mobile 3-day time grid: how vertical space is
allocated across the day, how concurrent events are presented, how the scroll
position survives a change of window, and what text a block carries.

The governing constraint is a 390px phone. Minus the 28px hour gutter that leaves
~120px per day column, so the desktop rules this view was derived from fail in
two directions at once. Splitting a column evenly across an overlap cluster gives
each member of a three-way collision ~40px, of which the border and padding take
11px — about five characters of title. And a uniform 24-hour axis spends roughly
a fifth of its height on the 4-9 PM window where essentially every collision in
this building occurs, while reserving the same pixels per hour for a
midnight-to-6 AM stretch that is empty every single day. Concurrency is not an
edge case here: this is a room-reservation calendar where four rooms booked at
7 PM is an ordinary Wednesday.

Both problems are answered by spending pixels in proportion to density rather
than uniformly — vertically via an elastic axis, horizontally by giving a dense
cluster one container with full-width rows instead of slivers. The cost is that
vertical position and extent become weaker statements about duration, which is
why blocks in the tall tier restate their time as text and why every stack row
carries its own time.

One constraint is inherited rather than chosen: `mobile-day-navigation` binds a
horizontal swipe to the same subtree, and the established contract is that every
behavior bound to that subtree reads the locked axis and defers to it. This grid
is the second consumer of that lock, after the agenda's pull-to-refresh.

Implemented in `src/components/mobile/MobileThreeDay.jsx`. `buildTimeScale`,
`minutesToY` / `yToMinutes`, and `layoutDayEvents` are pure and exported, which
is what makes the geometry assertable without a render.

## Requirements

### Requirement: Elastic time axis
The 3-day grid SHALL size each hour in proportion to the density observed in that
hour, rather than allocating a uniform height to all 24 hours. The scale SHALL be
derived from the maximum concurrency in that hour across the three visible day
columns, and SHALL be identical for all three columns.

#### Scenario: A contended hour is taller than a quiet one
- **WHEN** one hour contains three concurrent events in any visible column and
  another contains one
- **THEN** the contended hour SHALL render taller than the quiet hour

#### Scenario: An ordinary single-booking hour is unchanged
- **WHEN** an hour's maximum concurrency across the three columns is one
- **THEN** that hour SHALL render at the established single-booking height

#### Scenario: Concurrency is per column, not pooled
- **WHEN** three different columns each contain exactly one event in the same
  hour
- **THEN** that hour SHALL be treated as a single-booking hour, not a three-way
  overlap

#### Scenario: A given clock time sits at the same height in every column
- **WHEN** two events on different days start at the same clock time
- **THEN** both SHALL be positioned at the same vertical offset

### Requirement: Empty hours collapse
The grid SHALL collapse runs of consecutive hours that contain no events in any
visible column, and SHALL label a collapsed run with the time range it covers.

#### Scenario: A multi-hour empty run collapses to a single band
- **WHEN** two or more consecutive hours contain no events in any column
- **THEN** the run SHALL render as one band whose total height is a small fixed
  value regardless of how many hours it spans
- **AND** the band SHALL state the time range it covers

#### Scenario: A collapsed run is still ordered
- **WHEN** a collapsed run sits between two populated hours
- **THEN** events before the run SHALL render above it and events after it SHALL
  render below it

#### Scenario: An isolated empty hour does not get a band
- **WHEN** exactly one empty hour sits between two populated hours
- **THEN** it SHALL render at a reduced height without a range label

### Requirement: Scroll anchors to clock time across a scale change
When the visible window changes and the scale is rebuilt, the grid SHALL preserve
the clock time shown at the top of the viewport.

#### Scenario: Stepping a day does not displace the viewport
- **WHEN** the user swipes to step the window by one day
- **AND** the new three-day union produces a different scale
- **THEN** the time that was at the top of the viewport before the swipe SHALL
  still be at the top of the viewport after it

#### Scenario: An anchor time inside a newly collapsed run stays valid
- **WHEN** the anchored time falls inside an hour that is collapsed under the new
  scale
- **THEN** the grid SHALL scroll to a position within that collapsed band rather
  than failing or jumping to the top

### Requirement: Overlap handling is tiered by cluster size
The grid SHALL split the column for clusters of two overlapping events, and SHALL
render clusters of three or more as a single stacked container rather than
splitting the column further.

#### Scenario: Two overlapping events split the column
- **WHEN** exactly two events overlap
- **THEN** each SHALL occupy half the column width at its own vertical extent

#### Scenario: Three or more overlapping events render as a stack
- **WHEN** three or more events overlap
- **THEN** they SHALL render as one container spanning the cluster's time
  envelope
- **AND** each event SHALL occupy its own full-width row within that container
- **AND** each row SHALL state the event's title, time range, and location

#### Scenario: A stack too short for all its rows truncates with a count
- **WHEN** a stack's time envelope cannot fit a row for every event
- **THEN** it SHALL render as many rows as fit
- **AND** SHALL render a final row stating how many events are not shown

#### Scenario: Tapping a row inside a stack opens that event
- **WHEN** the user taps an individual row inside a stack
- **THEN** the detail sheet SHALL open for that row's event

### Requirement: Tap to expand a time range
The grid SHALL let the user expand a dense or collapsed time range in place,
without leaving the grid.

#### Scenario: Expanding a stack reveals every event
- **WHEN** the user taps a stack that is truncated with a `+N more` row
- **THEN** the hours it spans SHALL expand
- **AND** every event in the cluster SHALL be visible without truncation

#### Scenario: Expanding a collapsed empty run
- **WHEN** the user taps a collapsed empty band
- **THEN** the hours it covers SHALL expand to their uncollapsed height

#### Scenario: Only one range is expanded at a time
- **WHEN** a range is expanded and the user expands a different range
- **THEN** the first range SHALL return to its unexpanded height

#### Scenario: Expanding does not displace the expanded range
- **WHEN** a range expands
- **THEN** the start of that range SHALL remain at the same position in the
  viewport

#### Scenario: Expansion is cleared when the window moves
- **WHEN** the focused date changes while a range is expanded
- **THEN** the expansion SHALL be cleared

#### Scenario: Reduced motion gets the same result without animation
- **WHEN** the user has requested reduced motion
- **THEN** expanding SHALL apply immediately with no transition
- **AND** the resulting layout SHALL be identical to the animated case

### Requirement: Gestures defer to the locked axis
The grid SHALL NOT act on a tap that is part of a gesture the system has locked
to the horizontal axis.

#### Scenario: A horizontal drag ending over a block does not open it
- **WHEN** a gesture has locked to the horizontal axis
- **AND** it ends over an event block
- **THEN** the detail sheet SHALL NOT open
- **AND** no range SHALL expand

#### Scenario: A plain tap is unaffected
- **WHEN** the user taps an event block without a locked horizontal axis
- **THEN** the detail sheet SHALL open for that event

### Requirement: Block density and category treatment
Event blocks SHALL carry a full category-tinted border over a category wash, and
SHALL choose what text they carry based on their rendered height.

#### Scenario: A block is bordered in its category colour
- **WHEN** a timed event renders
- **THEN** it SHALL have a full border in its category colour over a wash of the
  same colour
- **AND** it SHALL NOT use a single-side rail

#### Scenario: All-day chips match the timed blocks
- **WHEN** an all-day event renders in the chip row
- **THEN** it SHALL use the same border-and-wash treatment as a timed block

#### Scenario: A tall block states its time range
- **WHEN** a block is tall enough for the tall density tier
- **THEN** it SHALL render its time range as text

#### Scenario: A short block does not state its time
- **WHEN** a block is at the short or medium density tier
- **THEN** it SHALL NOT render its time as text
- **AND** its accessible name SHALL still include its start time

### Requirement: Initial scroll targets the first event
The grid SHALL open scrolled to the earliest hour carrying an event in the
visible window.

#### Scenario: A window with events opens at the first one
- **WHEN** the earliest event in the three-day window starts at 7 AM
- **THEN** the grid SHALL open scrolled to the 7 AM hour

#### Scenario: An empty window falls back to the working day
- **WHEN** no visible column contains any timed event
- **THEN** the grid SHALL open scrolled to 9 AM
