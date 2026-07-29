# device-detection Specification

## Purpose

Defines which layout the app renders for a given viewport, and the boundary
between them: phones (<= 480px) get `MobileApp`, tablets and desktops keep the
existing desktop layout unchanged. Fixes the provider tree the mobile layout is
mounted inside — SSEProvider, TimezoneProvider, RoomProvider, and the
authentication providers — so that mobile views have the same hooks and contexts
available as desktop and login/logout works identically. The mobile views
themselves are specified by `mobile-app-shell`, `mobile-agenda`,
`mobile-three-day`, and `mobile-event-detail`.

## Requirements

### Requirement: Phone users see mobile layout placeholder
The system SHALL render a `MobileApp` component when the device type is `'phone'`, instead of the existing desktop layout. The mobile app SHALL be wrapped inside the same context providers (SSEProvider, TimezoneProvider, RoomProvider) as the desktop layout so that all existing hooks and contexts are available to mobile views.

#### Scenario: Phone viewport renders mobile app inside providers
- **WHEN** a user visits the app on a phone (viewport <= 480px)
- **AND** the user is authenticated
- **THEN** the app SHALL render the `MobileApp` component
- **AND** `MobileApp` SHALL be wrapped inside SSEProvider, TimezoneProvider, and RoomProvider
- **AND** mobile views SHALL have access to `useTimezone()`, `useLocations()`, and SSE events

#### Scenario: Desktop viewport renders existing layout
- **WHEN** a user visits the app on a desktop browser (viewport > 1024px)
- **THEN** the app SHALL render the existing desktop layout unchanged
- **AND** the `MobileApp` component SHALL NOT render

#### Scenario: Tablet viewport renders existing layout
- **WHEN** a user visits the app on a tablet (viewport 481px-1024px)
- **THEN** the app SHALL render the existing desktop layout unchanged
- **AND** the `MobileApp` component SHALL NOT render

### Requirement: Mobile layout includes authentication
The `MobileApp` component SHALL be wrapped in the same authentication providers as the desktop layout, so that login/logout works on mobile.

#### Scenario: Unauthenticated phone user can sign in
- **WHEN** a user visits the app on a phone and is not authenticated
- **THEN** the app SHALL display a sign-in button
- **AND** tapping the button SHALL trigger the MSAL authentication flow (redirect on mobile)
- **AND** upon successful authentication, the user SHALL see the mobile app shell

#### Scenario: Authenticated phone user can sign out
- **WHEN** an authenticated user is viewing the mobile app
- **THEN** the app SHALL provide a sign-out mechanism via the header avatar menu
- **AND** tapping sign out SHALL trigger the MSAL logout flow
