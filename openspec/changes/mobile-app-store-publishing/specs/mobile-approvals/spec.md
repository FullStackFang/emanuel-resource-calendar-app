## ADDED Requirements

### Requirement: Approvals tab visible only to approvers
The mobile shell SHALL show an Approvals tab only when the authenticated user has the `canApproveReservations` permission.

#### Scenario: Approver sees the tab
- **WHEN** a user with `canApproveReservations` opens the mobile app
- **THEN** the bottom tab bar SHALL include the Approvals tab

#### Scenario: Non-approver does not see the tab
- **WHEN** a user without `canApproveReservations` opens the mobile app
- **THEN** the Approvals tab SHALL NOT render
- **AND** approval actions SHALL NOT be reachable through any mobile view

### Requirement: Mobile approval queue
The Approvals tab SHALL list pending reservation requests as cards, using the same query semantics as the desktop approval queue.

#### Scenario: Pending queue listed
- **WHEN** an approver opens the Approvals tab
- **THEN** pending requests SHALL be listed (excluding exception/addition child documents, consistent with desktop queue scoping)
- **AND** each card SHALL show title, requester name, date/time, and location

#### Scenario: Loading conventions
- **WHEN** the queue is loading or refreshing
- **THEN** loading and empty states SHALL follow the `deriveListLoadingState` + `EmptyStateRefreshButton` conventions

### Requirement: Approve and reject from mobile
The system SHALL allow approvers to approve (publish) or reject a pending request from the mobile detail view, with the same backend semantics as desktop. The mobile views SHALL reuse the `useEventReviewExperience` and `useCurrentUserGates` hooks (pure logic) — NEVER the `EventReviewExperience` component, which renders desktop `ReviewModal`/`RoomReservationReview` JSX.

#### Scenario: Approve with in-button confirm
- **WHEN** the approver taps Approve and confirms
- **THEN** the system SHALL call the existing publish endpoint with `expectedVersion`
- **AND** on success the request SHALL leave the queue and a success toast SHALL show

#### Scenario: Reject requires a reason
- **WHEN** the approver taps Reject
- **THEN** the system SHALL require a rejection reason before submitting (same forced-reason flow as desktop)

#### Scenario: Version conflict handling
- **WHEN** the publish or reject call returns HTTP 409 VERSION_CONFLICT
- **THEN** the system SHALL inform the approver of the conflict (status changed, data changed, or already actioned) and refresh the item

#### Scenario: Scheduling conflict on approve
- **WHEN** the publish call returns HTTP 409 SchedulingConflict
- **THEN** the system SHALL display the conflicting events and offer the same override options the approver would see on desktop
