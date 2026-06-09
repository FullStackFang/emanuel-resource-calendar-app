## ADDED Requirements

### Requirement: Marker entity and storage
The system SHALL store calendar markers in a dedicated `templeEvents__CalendarMarkers` collection, separate from events. Each marker SHALL have: `type` (`holiday` or `officeClosed`), `name`, optional `note`, `startDate` and `endDate` as inclusive `YYYY-MM-DD` date-only strings, `warnOnReservation` (boolean), optional `color`, `pushToOutlook` (boolean), `active` (boolean), an optional `graphData` linkage object, and audit fields (`createdAt`, `createdBy`, `updatedAt`, `updatedBy`).

#### Scenario: Single-day marker
- **WHEN** an admin creates a marker for one day
- **THEN** the marker is stored with `startDate` equal to `endDate` and `active` set to true

#### Scenario: Multi-day marker
- **WHEN** an admin creates a marker spanning several days
- **THEN** the marker is stored with `endDate` later than `startDate`

### Requirement: Admin-only management
The system SHALL allow only admin users to create, update, or delete markers. Non-admin requests SHALL be rejected with HTTP 403 and make no change.

#### Scenario: Admin creates a marker
- **WHEN** an admin submits a valid marker
- **THEN** the system persists it and returns success

#### Scenario: Non-admin blocked
- **WHEN** a non-admin user attempts to create, update, or delete a marker
- **THEN** the system responds with 403 and stores nothing

### Requirement: Marker validation
The system SHALL validate marker input: `type` MUST be `holiday` or `officeClosed`, `name` MUST be non-empty, `startDate` and `endDate` MUST be valid `YYYY-MM-DD` strings, and `endDate` MUST be on or after `startDate`. Invalid input SHALL be rejected with HTTP 400.

#### Scenario: End before start
- **WHEN** a marker is submitted with `endDate` earlier than `startDate`
- **THEN** the system responds with 400 and stores nothing

#### Scenario: Invalid type
- **WHEN** a marker is submitted with a `type` other than `holiday` or `officeClosed`
- **THEN** the system responds with 400

### Requirement: Soft delete
Deleting a marker SHALL set `active` to false rather than removing the document, and the marker SHALL no longer be returned by active reads.

#### Scenario: Delete hides the marker
- **WHEN** an admin deletes an active marker
- **THEN** the marker's `active` becomes false and it is excluded from active-marker reads

### Requirement: Marker read API
The system SHALL expose a read endpoint that returns active markers, optionally filtered to those overlapping a given date window, for consumption by the calendar views and booking forms.

#### Scenario: Range query returns overlapping markers
- **WHEN** the calendar requests markers for a visible date window
- **THEN** the system returns every active marker whose inclusive `[startDate, endDate]` range overlaps that window

### Requirement: Markers excluded from event surfaces
Markers SHALL NOT appear in any event query, list, count, approval queue, search result, conflict check, or export, and SHALL NOT participate in the event approval workflow.

#### Scenario: Markers do not affect event counts
- **WHEN** a marker exists on a day that also has events
- **THEN** the event list and count endpoints for that day return the same results as if the marker did not exist
