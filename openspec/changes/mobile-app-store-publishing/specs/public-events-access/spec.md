## ADDED Requirements

### Requirement: Public published-events endpoint
The system SHALL expose a public, unauthenticated endpoint under `/api/public/` that returns published events for a requested date range, shaped for the mobile agenda view.

#### Scenario: Published events returned for date range
- **WHEN** an unauthenticated client requests public events for a date range
- **THEN** the endpoint SHALL return events with `status: 'published'` whose date range overlaps the request
- **AND** the response SHALL include only display fields: title, start/end datetimes, location display names, categories, all-day flag, and event id

#### Scenario: Non-public data excluded
- **WHEN** the public endpoint builds its response
- **THEN** it SHALL exclude events with status draft, pending, rejected, or deleted
- **AND** it SHALL exclude exception/addition child documents (`eventType: { $nin: ['exception', 'addition'] }` consistent with list endpoints)
- **AND** it SHALL NOT include `roomReservationData` (requester PII), `graphData`, internal notes, or audit fields

#### Scenario: Rate limiting sized for mobile guest traffic
- **WHEN** a client exceeds the endpoint's rate limit
- **THEN** the endpoint SHALL respond with HTTP 429
- **AND** the limit SHALL be sized deliberately for a mobile guest audience (carrier CGNAT shares IPs across many users), not defaulted to the generic `publicLimiter` (100 req/15 min/IP)

#### Scenario: Server-side projection is the PII boundary
- **WHEN** the public endpoint responds
- **THEN** field exclusion SHALL be enforced by a server-side projection (never by frontend omission), because the shared `transformEventToFlatStructure()` surfaces whatever fields the backend sends

### Requirement: Guest mode on phone viewports
The system SHALL render the mobile app shell in guest mode for unauthenticated users on phone viewports and inside the native app, instead of the sign-in landing page.

#### Scenario: Unauthenticated phone user sees public calendar
- **WHEN** an unauthenticated user opens the app on a phone viewport
- **THEN** the system SHALL render the mobile shell with the Calendar tab showing published events from the public endpoint
- **AND** no authenticated-only data SHALL be requested
- **AND** the agenda SHALL resolve its loading state (the current `MobileAgenda` fetch guard, which early-returns without a token and leaves the skeleton up forever, SHALL be replaced with an explicit guest fetch branch)

#### Scenario: Sign-in upgrade in place
- **WHEN** a guest taps "Staff Sign In" and completes authentication
- **THEN** the same mobile shell SHALL re-render in authenticated mode with full event data and workflow tabs
- **AND** the user SHALL NOT be navigated to a separate desktop layout

#### Scenario: Guest taps a workflow tab
- **WHEN** a guest taps My Events or Request
- **THEN** the system SHALL show a sign-in prompt explaining the feature requires a staff account

#### Scenario: Guest offline or empty state
- **WHEN** the public events request fails or returns no events
- **THEN** the system SHALL show a friendly empty/error state with a retry affordance (reusing the EmptyStateRefreshButton pattern)
