## MODIFIED Requirements

### Requirement: Mobile app shell with bottom tab navigation
The system SHALL render a mobile app shell on phone viewports (<=480px) consisting of a compact header, an active view area, and a fixed bottom tab bar. The tab set SHALL be Calendar and Requests, plus an Approvals tab shown only to users with `canApproveReservations`. No tab SHALL render a placeholder.

#### Scenario: Authenticated phone user sees app shell
- **WHEN** an authenticated user visits the app on a phone viewport
- **THEN** the system SHALL render the MobileApp shell with a compact header, the Calendar tab active by default, and the bottom tab bar visible

#### Scenario: Tab switching
- **WHEN** the user taps a tab in the bottom navigation bar
- **THEN** the system SHALL switch the active view to the selected tab's content
- **AND** the selected tab SHALL be visually highlighted
- **AND** the URL SHALL NOT change (state-based navigation, not router-based)

#### Scenario: Requests tab renders real content
- **WHEN** the user taps the Requests tab
- **THEN** the system SHALL render the user's own reservation requests
- **AND** SHALL NOT render a placeholder or "coming soon" view

#### Scenario: Approvals tab hidden without permission
- **WHEN** a user without `canApproveReservations` views the tab bar
- **THEN** the Approvals tab SHALL NOT be rendered
- **AND** the remaining tabs SHALL occupy equal width across the bar

#### Scenario: Chat tab retired
- **WHEN** the tab bar renders for any user
- **THEN** a Chat tab SHALL NOT be present

## ADDED Requirements

### Requirement: Tab identifiers are stable across relabeling
Renaming a tab's user-facing label SHALL NOT change its internal tab identifier, so that API view parameters and cache keys derived from those identifiers remain valid.

#### Scenario: Requests tab retains the my-events identifier
- **WHEN** the tab formerly labeled `My Events` is relabeled `Requests`
- **THEN** its tab identifier SHALL remain `my-events`
- **AND** the `view=my-events` API parameter and existing React Query keys SHALL be unaffected
