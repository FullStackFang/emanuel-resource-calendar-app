## ADDED Requirements

### Requirement: Mobile app shell with bottom tab navigation
The system SHALL render a mobile app shell on phone viewports (<=480px) consisting of a compact header, an active view area, and a fixed bottom tab bar with three tabs: Calendar, My Events, and Chat.

#### Scenario: Authenticated phone user sees app shell
- **WHEN** an authenticated user visits the app on a phone viewport
- **THEN** the system SHALL render the MobileApp shell with a compact header, the Calendar tab active by default, and the bottom tab bar visible

#### Scenario: Tab switching
- **WHEN** the user taps a tab in the bottom navigation bar
- **THEN** the system SHALL switch the active view to the selected tab's content
- **AND** the selected tab SHALL be visually highlighted
- **AND** the URL SHALL NOT change (state-based navigation, not router-based)

#### Scenario: My Events and Chat tabs show placeholders
- **WHEN** the user taps the My Events or Chat tab
- **THEN** the system SHALL render a placeholder view indicating the feature is coming soon

### Requirement: Bottom tab bar is fixed and always visible
The bottom tab bar SHALL remain fixed at the bottom of the viewport, visible at all times regardless of scroll position in the active view.

#### Scenario: Tab bar visible during scroll
- **WHEN** the user scrolls the agenda event list
- **THEN** the bottom tab bar SHALL remain fixed at the bottom of the screen
- **AND** the tab bar SHALL not scroll with the content

#### Scenario: Tab bar respects safe area
- **WHEN** the app is running on a device with a home indicator (e.g., iPhone with notch)
- **THEN** the tab bar SHALL include bottom safe area padding so tabs are not obscured

### Requirement: Mobile header with user avatar menu
The system SHALL render a compact header with the app title and a user avatar circle showing the user's initials. Tapping the avatar SHALL open a dropdown menu.

#### Scenario: Header displays user avatar
- **WHEN** the mobile app shell renders
- **THEN** the header SHALL display "Temple Events" as the title
- **AND** a circular avatar with the user's initials on the right side

#### Scenario: Avatar menu opens on tap
- **WHEN** the user taps the avatar circle
- **THEN** a dropdown menu SHALL appear with "Sign Out" and "Open Desktop Version" options

#### Scenario: Sign out from avatar menu
- **WHEN** the user taps "Sign Out" in the avatar menu
- **THEN** the system SHALL trigger the MSAL logout redirect flow

#### Scenario: Open desktop version
- **WHEN** the user taps "Open Desktop Version" in the avatar menu
- **THEN** the system SHALL provide a way to view the full desktop app (e.g., open in new tab with desktop user agent hint or instructions)

### Requirement: Touch targets meet minimum size
All interactive elements in the mobile app shell (tabs, buttons, avatar) SHALL have a minimum touch target size of 44x44 CSS pixels.

#### Scenario: Tab touch targets
- **WHEN** the bottom tab bar renders
- **THEN** each tab SHALL have a minimum height of 44px and occupy equal width
