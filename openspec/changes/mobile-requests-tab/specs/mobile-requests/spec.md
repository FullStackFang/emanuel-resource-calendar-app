## ADDED Requirements

### Requirement: Requests tab lists the user's own reservation requests
The Requests tab SHALL display the authenticated user's own reservation requests as a scrollable card list, scoped server-side by `roomReservationData.requestedBy.email` using the same ownership query as the desktop My Reservations view.

#### Scenario: Own requests listed
- **WHEN** an authenticated user opens the Requests tab
- **THEN** the system SHALL fetch `GET /api/events/list?view=my-events&limit=1000&includeDeleted=true`
- **AND** SHALL render one card per returned event showing time, title, location, and a status badge

#### Scenario: Child documents excluded
- **WHEN** the user's requests include recurring events with overrides
- **THEN** exception and addition child documents SHALL NOT appear as separate cards

#### Scenario: Documents pass through the shared transform
- **WHEN** the system renders any request card or detail
- **THEN** every event document SHALL be transformed via `transformEventToFlatStructure()`
- **AND** the system SHALL NOT read `graphData` for display

### Requirement: Status filtering
The Requests list SHALL offer status filters and SHALL show only requests matching the selected filter.

#### Scenario: Filter selection narrows the list
- **WHEN** the user selects a status filter of All, Pending, Published, Rejected, or Draft
- **THEN** the list SHALL show only requests whose status matches the selection
- **AND** the selected filter SHALL be visually highlighted

#### Scenario: Filter counts reflect the user's own requests
- **WHEN** the Requests tab renders its filters
- **THEN** each filter SHALL display a count sourced from `GET /api/events/list/counts?view=my-events`

### Requirement: Card status colors match the application status vocabulary
Request cards SHALL indicate status using the color mapping already defined in `STATUS_MAP`, so mobile and desktop teach the same vocabulary.

#### Scenario: Status colors
- **WHEN** a request card renders its status indicator
- **THEN** published SHALL be green, pending SHALL be yellow, draft SHALL be gray, and rejected SHALL be red

### Requirement: Loading and empty states follow shared conventions
The Requests list SHALL derive its loading primitives from `deriveListLoadingState()` so that no empty state renders before the first fetch resolves.

#### Scenario: First load shows a loading indicator, never an empty state
- **WHEN** the list query is in its first load, including the tick where the query is pending and idle
- **THEN** the system SHALL render a loading indicator
- **AND** SHALL NOT render the empty state

#### Scenario: Background refresh does not blank the list
- **WHEN** a refetch is in progress and prior data has already resolved
- **THEN** the system SHALL continue rendering the existing cards
- **AND** SHALL NOT render the empty state

#### Scenario: True empty result offers recovery
- **WHEN** the query has resolved, returned zero requests, and no silent refresh is in progress
- **THEN** the system SHALL render an empty state
- **AND** the empty state SHALL include an `EmptyStateRefreshButton` that re-runs the query

### Requirement: Tapping a request opens its detail
Tapping a request card SHALL open the mobile event detail bottom sheet for that request.

#### Scenario: Detail opens on tap
- **WHEN** the user taps a request card
- **THEN** the event detail bottom sheet SHALL open showing that request's details
