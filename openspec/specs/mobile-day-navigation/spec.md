# mobile-day-navigation Specification

## Purpose

Defines which day the mobile calendar is focused on and how that focus moves —
horizontal swipe stepping, and the agenda's scroll position driving the header.
Owns the intent/observation state split shared by both mobile calendar views:
selection intent (`selectedDate`) drives the fetch window, the rendered day
list, and the agenda's scroll-into-view, while scroll observation
(`visibleDate`) drives the week strip alone. Keeping them separate is what makes
a scroll/scroll-into-view feedback loop unrepresentable rather than suppressed
by a flag.

Also owns the gesture axis lock, which is authoritative for every behavior bound
to the same touch — notably `mobile-agenda`'s pull-to-refresh, which defers to
it. Applies to both presentations of the mobile calendar window: `mobile-agenda`
and `mobile-three-day`.

## Requirements
### Requirement: Horizontal swipe steps the focused day
The mobile calendar SHALL advance or rewind the focused day by exactly one day
per horizontal swipe, in both the agenda and the 3-day grid. Swiping left SHALL
move forward in time; swiping right SHALL move backward.

#### Scenario: Swipe left advances one day
- **WHEN** the user swipes left across the calendar view area
- **THEN** the focused date SHALL advance by one day
- **AND** the week strip SHALL highlight the new date

#### Scenario: Swipe right rewinds one day
- **WHEN** the user swipes right across the calendar view area
- **THEN** the focused date SHALL move back by one day

#### Scenario: Three-day grid shifts by one column
- **WHEN** the user swipes left in the 3-day grid
- **THEN** the leftmost column SHALL become the day that was previously second
- **AND** two of the three previously visible days SHALL remain on screen

#### Scenario: Swipe across the loaded window boundary
- **WHEN** a swipe moves the focused date outside the currently loaded event
  range
- **THEN** the system SHALL fetch the missing range and append it, exactly as a
  week strip navigation does
- **AND** previously loaded events SHALL remain in memory

#### Scenario: Swipe zone excludes the week strip
- **WHEN** the user swipes horizontally on the week strip itself
- **THEN** the day-stepping gesture SHALL NOT fire

### Requirement: Gesture axis lock
The system SHALL lock a touch gesture to a single axis and SHALL treat that
lock as authoritative for every behavior bound to the gesture.

#### Scenario: Vertical gesture never steps a day
- **WHEN** a gesture's vertical travel dominates its horizontal travel
- **THEN** the gesture SHALL lock to the vertical axis
- **AND** no day step SHALL occur regardless of total horizontal distance

#### Scenario: Locked axis holds for the whole gesture
- **WHEN** a gesture has locked to the vertical axis and subsequently moves
  predominantly horizontally
- **THEN** the gesture SHALL remain locked to the vertical axis

#### Scenario: Below-threshold horizontal movement is ignored
- **WHEN** a horizontally-locked gesture ends having travelled less than the
  swipe distance threshold
- **THEN** no day step SHALL occur

#### Scenario: Multi-touch is not a swipe
- **WHEN** a gesture involves more than one simultaneous touch point
- **THEN** the system SHALL NOT interpret it as a swipe

#### Scenario: Horizontal gesture does not trigger pull-to-refresh
- **WHEN** a gesture begins at the top of the agenda list and locks to the
  horizontal axis
- **THEN** pull-to-refresh SHALL NOT fire, regardless of the gesture's vertical
  distance

### Requirement: Agenda scroll position drives the header
The week strip SHALL reflect the day currently at the top of the agenda
viewport, not only the day the user last tapped.

#### Scenario: Scrolling into a later day updates the strip
- **WHEN** the user scrolls the agenda list until a later day's section reaches
  the top of the viewport
- **THEN** the week strip SHALL highlight that day

#### Scenario: Scrolling into the following week advances the strip
- **WHEN** scrolling brings a day from the following week to the top of the
  viewport
- **THEN** the week strip SHALL display that week
- **AND** the month label SHALL reflect the displayed week

#### Scenario: Scroll observation does not move the fetch window
- **WHEN** the visible day changes through scrolling alone
- **THEN** the loaded event range and the rendered day list SHALL NOT change

#### Scenario: Tapping a day highlights it immediately
- **WHEN** the user taps a day in the week strip
- **THEN** that day SHALL be highlighted before the agenda's scroll animation
  completes

#### Scenario: Intervening days do not flash during a programmatic scroll
- **WHEN** a tap or swipe triggers a smooth scroll spanning several day
  sections
- **THEN** the week strip SHALL NOT step through the intervening days
- **AND** the strip SHALL settle on the target day

#### Scenario: Three-day grid has no scroll observation
- **WHEN** the user scrolls vertically in the 3-day grid
- **THEN** the focused day SHALL NOT change, because the vertical axis
  represents hours

### Requirement: Existing navigation affordances are preserved
Adding gesture navigation SHALL NOT remove or alter any existing navigation
control.

#### Scenario: Week chevrons still step a week
- **WHEN** the user taps the week strip's previous or next chevron
- **THEN** the calendar SHALL move by one week, as before

#### Scenario: Keyboard and screen reader path unchanged
- **WHEN** a user navigates without touch gestures
- **THEN** the week strip's day buttons, week chevrons, date picker, and Today
  button SHALL remain the full navigation surface

