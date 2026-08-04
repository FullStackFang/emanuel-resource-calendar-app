# Spec: modal-return-navigation

## ADDED Requirements

### Requirement: A conflict-driven navigation records where it came from
`useReviewModal` SHALL record a single navigation origin when the review modal
navigates to an event from the conflict panel. The origin SHALL carry enough to
return and to explain the return: the originating event, its title, the
occurrence date being resolved, and the number of conflicts still outstanding.

The origin SHALL be a single entry, not a stack. A subsequent navigation SHALL
replace it. Closing the modal SHALL clear it.

#### Scenario: Origin recorded on conflict navigation
- **WHEN** the modal navigates to a blocking event from the conflict panel
- **THEN** the originating series, its title, the occurrence date, and the
  outstanding conflict count are recorded as the navigation origin

#### Scenario: A second navigation replaces the origin
- **WHEN** the user navigates from the blocking event to a third event
- **THEN** the recorded origin is replaced, not stacked

#### Scenario: Closing clears the origin
- **WHEN** the modal is closed
- **THEN** no navigation origin remains recorded

#### Scenario: Ordinary navigation records nothing
- **WHEN** the modal navigates for any reason other than conflict resolution
- **THEN** no navigation origin is recorded and no return bar renders

### Requirement: A return bar offers the way back
`ReviewModal` SHALL render a return bar at the top of the modal whenever a
navigation origin is recorded. The bar SHALL name the event being returned to
and SHALL state what is being resolved and how many conflicts remain.

Activating the bar SHALL navigate back to the originating event and clear the
origin. When the current form has unsaved changes, returning SHALL route
through the existing discard-changes guard.

#### Scenario: Return bar renders after navigating to a blocker
- **WHEN** the modal has navigated to a blocking event from the conflict panel
- **THEN** a return bar renders naming the originating series and the
  outstanding conflict count

#### Scenario: Returning restores the series
- **WHEN** the user activates the return bar
- **THEN** the modal navigates back to the originating event and the return bar
  is no longer rendered

#### Scenario: Unsaved changes guard the return
- **WHEN** the blocking event's form has unsaved changes and the user activates
  the return bar
- **THEN** the discard-changes guard is shown before any navigation

#### Scenario: No origin, no bar
- **WHEN** the modal is opened directly on an event
- **THEN** no return bar renders

### Requirement: Navigation resolves events that are not reservations
`navigateToEvent` SHALL fetch a target given by id from
`/api/room-reservations/:id`, and SHALL fall back to `GET /api/events/:id` when
that request returns 404, adapting the result to the shape the modal consumes.
Callers and downstream consumers SHALL be unaffected by which source resolved
the event.

This fallback is required because conflict detection matches published events
synced from Outlook, which carry no reservation data and are therefore absent
from the reservations endpoint.

#### Scenario: Reservation resolves from the primary source
- **WHEN** the target event has reservation data
- **THEN** it is fetched from the reservations endpoint and no fallback occurs

#### Scenario: Outlook-synced event resolves from the fallback
- **WHEN** the target event has no reservation data and the reservations
  endpoint returns 404
- **THEN** the event is fetched from the events endpoint and opened in the
  modal

#### Scenario: Both sources fail
- **WHEN** neither source resolves the event
- **THEN** the modal reports that the event could not be loaded and does not
  navigate

#### Scenario: Consumers see one shape
- **WHEN** an event is resolved through the fallback
- **THEN** it is adapted to the same shape the primary source returns before
  any consumer receives it
