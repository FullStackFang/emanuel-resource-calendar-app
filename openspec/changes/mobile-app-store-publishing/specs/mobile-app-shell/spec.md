## MODIFIED Requirements

### Requirement: Mobile app shell with bottom tab navigation
The system SHALL render a mobile app shell on phone viewports (<=480px) and inside the native app, consisting of a compact header, an active view area, and a fixed bottom tab bar. For authenticated users the tabs SHALL be: Calendar, My Events, Request, and (for users with `canApproveReservations`) Approvals. For unauthenticated guests the shell SHALL render in guest mode with the Calendar tab active.

#### Scenario: Authenticated phone user sees app shell
- **WHEN** an authenticated user visits the app on a phone viewport
- **THEN** the system SHALL render the MobileApp shell with a compact header, the Calendar tab active by default, and the bottom tab bar visible
- **AND** the tab bar SHALL contain Calendar, My Events, and Request, plus Approvals when the user has `canApproveReservations`

#### Scenario: Unauthenticated phone user sees guest shell
- **WHEN** an unauthenticated user visits the app on a phone viewport or opens the native app
- **THEN** the system SHALL render the MobileApp shell in guest mode with the public calendar active
- **AND** the shell SHALL NOT render the sign-in landing page used on desktop

#### Scenario: Tab switching
- **WHEN** the user taps a tab in the bottom navigation bar
- **THEN** the system SHALL switch the active view to the selected tab's content
- **AND** the selected tab SHALL be visually highlighted
- **AND** the URL SHALL NOT change (state-based navigation, not router-based)

#### Scenario: No placeholder tabs remain
- **WHEN** an authenticated user taps any tab in the bottom navigation bar
- **THEN** the system SHALL render a functional view (no "coming soon" placeholders)
- **AND** the Chat tab SHALL no longer be present

### Requirement: Mobile header with user avatar menu
The system SHALL render a compact header with the app title. For authenticated users it SHALL show a user avatar circle with the user's initials that opens a dropdown menu; for guests it SHALL show a "Staff Sign In" action instead.

#### Scenario: Header displays user avatar
- **WHEN** the mobile app shell renders for an authenticated user
- **THEN** the header SHALL display "Temple Events" as the title
- **AND** a circular avatar with the user's initials on the right side

#### Scenario: Guest header shows sign-in action
- **WHEN** the mobile app shell renders in guest mode
- **THEN** the header SHALL display "Temple Events" as the title
- **AND** a "Staff Sign In" button in place of the avatar

#### Scenario: Avatar menu opens on tap
- **WHEN** the authenticated user taps the avatar circle
- **THEN** a dropdown menu SHALL appear with "Sign Out" and "Open Desktop Version" options

#### Scenario: Sign out from avatar menu
- **WHEN** the user taps "Sign Out" in the avatar menu
- **THEN** the system SHALL trigger the MSAL logout redirect flow
- **AND** the shell SHALL return to guest mode (public calendar), not a blank landing page

#### Scenario: Open desktop version
- **WHEN** the user taps "Open Desktop Version" in the avatar menu
- **THEN** the system SHALL provide a way to view the full desktop app (e.g., open in new tab with desktop user agent hint or instructions)
