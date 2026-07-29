## MODIFIED Requirements

### Requirement: Agenda scroll position drives the header
The week strip SHALL reflect the day currently at the top of the agenda
viewport, not only the day the user last tapped. Scrolling SHALL NOT change the
focused day (`selectedDate`), because the focused day drives the agenda's
scroll-into-view and a scroll-driven write to it would close a feedback loop.
Scrolling MAY grow the agenda's rendered day range, which drives no scroll and
therefore closes no loop.

#### Scenario: Scrolling into a later day updates the strip
- **WHEN** the user scrolls the agenda list until a later day's section reaches
  the top of the viewport
- **THEN** the week strip SHALL highlight that day

#### Scenario: Scrolling into the following week advances the strip
- **WHEN** scrolling brings a day from the following week to the top of the
  viewport
- **THEN** the week strip SHALL display that week
- **AND** the month label SHALL reflect the displayed week

#### Scenario: Scroll observation does not move the focused day
- **WHEN** the visible day changes through scrolling alone
- **THEN** the focused day SHALL NOT change
- **AND** the agenda SHALL NOT scroll itself in response

#### Scenario: Scrolling toward an end of the list grows the rendered range
- **WHEN** the reader scrolls close enough to either end of the agenda list to
  trigger an extension
- **THEN** the rendered day range SHALL grow at that end
- **AND** the focused day SHALL still NOT change

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
