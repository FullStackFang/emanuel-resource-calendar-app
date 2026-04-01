## ADDED Requirements

### Requirement: Device type detection via viewport width
The system SHALL provide a `useDeviceType()` React hook that returns the current device type based on viewport width. The hook SHALL update reactively when the viewport changes (e.g., browser resize, orientation change).

#### Scenario: Phone detection
- **WHEN** the viewport width is 480px or less
- **THEN** `useDeviceType()` SHALL return `'phone'`

#### Scenario: Tablet detection
- **WHEN** the viewport width is between 481px and 1024px (inclusive)
- **THEN** `useDeviceType()` SHALL return `'tablet'`

#### Scenario: Desktop detection
- **WHEN** the viewport width is 1025px or greater
- **THEN** `useDeviceType()` SHALL return `'desktop'`

#### Scenario: Orientation change updates device type
- **WHEN** a tablet user rotates from portrait (e.g., 768px wide) to landscape (e.g., 1024px wide)
- **THEN** `useDeviceType()` SHALL reactively update to reflect the new viewport width
- **AND** the component tree SHALL re-render with the updated device type

#### Scenario: Default value before hydration
- **WHEN** the hook initializes and `window.matchMedia` is not yet available (SSR or initial render)
- **THEN** `useDeviceType()` SHALL return `'desktop'` as the default

### Requirement: Phone users see mobile layout placeholder
The system SHALL render a `MobileLayout` placeholder component when the device type is `'phone'`, instead of the existing desktop layout.

#### Scenario: Phone viewport renders mobile placeholder
- **WHEN** a user visits the app on a phone (viewport <= 480px)
- **AND** the user is authenticated
- **THEN** the app SHALL render the `MobileLayout` placeholder component
- **AND** the placeholder SHALL display a message indicating that mobile views are coming soon
- **AND** the existing desktop layout SHALL NOT render

#### Scenario: Desktop viewport renders existing layout
- **WHEN** a user visits the app on a desktop browser (viewport > 1024px)
- **THEN** the app SHALL render the existing desktop layout unchanged
- **AND** the `MobileLayout` component SHALL NOT render

#### Scenario: Tablet viewport renders existing layout
- **WHEN** a user visits the app on a tablet (viewport 481px-1024px)
- **THEN** the app SHALL render the existing desktop layout unchanged
- **AND** the `MobileLayout` component SHALL NOT render

### Requirement: Mobile layout includes authentication
The `MobileLayout` placeholder SHALL be wrapped in the same authentication providers as the desktop layout, so that login/logout works on mobile.

#### Scenario: Unauthenticated phone user can sign in
- **WHEN** a user visits the app on a phone and is not authenticated
- **THEN** the app SHALL display a sign-in button
- **AND** tapping the button SHALL trigger the MSAL authentication flow (redirect on mobile)
- **AND** upon successful authentication, the user SHALL see the mobile layout placeholder

#### Scenario: Authenticated phone user can sign out
- **WHEN** an authenticated user is viewing the mobile layout placeholder
- **THEN** the app SHALL provide a sign-out mechanism
- **AND** tapping sign out SHALL trigger the MSAL logout flow
