## ADDED Requirements

### Requirement: My Events tab lists the user's reservations
The My Events tab SHALL display the authenticated user's own reservation requests as a scrollable card list with status filtering, replacing the current placeholder.

#### Scenario: Own requests listed
- **WHEN** an authenticated user opens the My Events tab
- **THEN** the system SHALL list events where `roomReservationData.requestedBy.email` matches the user (same ownership query as desktop My Reservations)
- **AND** each card SHALL show title, date/time, location, and a status badge

#### Scenario: Status filtering
- **WHEN** the user selects a status filter (All, Pending, Published, Rejected, Draft)
- **THEN** the list SHALL show only matching reservations
- **AND** exception/addition child documents SHALL NOT appear (consistent with desktop My Reservations)

#### Scenario: Loading and empty states follow shared conventions
- **WHEN** the list query is in its first load
- **THEN** a loading indicator SHALL display, derived via `deriveListLoadingState` (no empty-state flash)
- **AND** a true empty result SHALL render an empty state with `EmptyStateRefreshButton`

### Requirement: Reservation detail from My Events
Tapping a reservation card SHALL open the mobile event detail view showing the reservation's full information including its current status and review notes.

#### Scenario: Detail opens on tap
- **WHEN** the user taps a reservation card
- **THEN** the MobileEventDetail view SHALL open with the reservation's details, status, and (if rejected) the rejection reason

### Requirement: Withdraw a pending request
The system SHALL allow the user to withdraw their own pending reservation request from the mobile detail view, using the standard in-button confirmation pattern.

#### Scenario: Withdraw with in-button confirm
- **WHEN** the user taps "Withdraw Request" on their own pending reservation
- **THEN** the button SHALL change to a confirm state ("Confirm?")
- **AND** a second tap SHALL call the existing delete endpoint with a required reason and show "Withdrawing..."
- **AND** on success a toast SHALL confirm and the list SHALL refresh

#### Scenario: Withdraw not offered for non-pending
- **WHEN** the user views their own published, rejected, or draft reservation
- **THEN** the Withdraw action SHALL NOT be shown (matching desktop permission scoping)

#### Scenario: Version conflict on withdraw
- **WHEN** the withdraw request returns HTTP 409 VERSION_CONFLICT
- **THEN** the system SHALL inform the user the request changed (e.g., already actioned) and refresh the detail view
