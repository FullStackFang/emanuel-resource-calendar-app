## ADDED Requirements

### Requirement: Login works on mobile browsers
The system SHALL authenticate users on mobile browsers (iOS Safari, Android Chrome, Samsung Internet) where popup windows may be blocked by default. The login flow SHALL attempt popup-based authentication first, and fall back to redirect-based authentication if the popup fails or is blocked.

#### Scenario: Successful login via popup (desktop)
- **WHEN** a user clicks "Sign in with Microsoft" on a desktop browser
- **THEN** the system opens an MSAL login popup
- **AND** upon successful authentication, the user is signed in with an access token
- **AND** the page does not navigate away

#### Scenario: Popup blocked, fallback to redirect (mobile)
- **WHEN** a user clicks "Sign in with Microsoft" on a mobile browser that blocks popups
- **AND** `loginPopup()` throws an error
- **THEN** the system SHALL call `loginRedirect()` to navigate to the Microsoft login page
- **AND** upon returning to the app, `handleRedirectPromise()` SHALL process the authentication response
- **AND** the user is signed in with an access token

#### Scenario: Redirect return processing on app load
- **WHEN** the app loads after a redirect-based login (URL contains auth response hash)
- **THEN** `msalInstance.handleRedirectPromise()` SHALL be called before the React tree renders
- **AND** the MSAL session SHALL be restored from the redirect response
- **AND** the user sees the authenticated app state

### Requirement: Logout works on mobile browsers
The system SHALL sign out users on mobile browsers where popup windows may be blocked. The logout flow SHALL attempt popup-based logout first, and fall back to redirect-based logout if the popup fails.

#### Scenario: Successful logout via popup (desktop)
- **WHEN** an authenticated user clicks "Sign Out" on a desktop browser
- **THEN** the system performs an MSAL logout popup
- **AND** the user is signed out and sees the login screen

#### Scenario: Popup blocked, fallback to redirect (mobile)
- **WHEN** an authenticated user clicks "Sign Out" on a mobile browser that blocks popups
- **AND** `logoutPopup()` throws an error
- **THEN** the system SHALL call `logoutRedirect()` to navigate to the Microsoft logout page
- **AND** upon returning to the app, the user sees the login screen

### Requirement: Deep-link preservation across redirect flow
The system SHALL preserve deep-link parameters (e.g., `?eventId=`) across redirect-based authentication flows where the page navigates away and returns.

#### Scenario: eventId preserved after redirect login
- **WHEN** a user visits the app with `?eventId=abc123` in the URL
- **AND** authentication requires a redirect flow
- **THEN** the eventId SHALL be saved to sessionStorage before the redirect
- **AND** after returning from authentication, the app SHALL restore the eventId from sessionStorage
- **AND** the calendar SHALL open to the referenced event

### Requirement: Existing token refresh flow unchanged
The system SHALL NOT modify the existing token refresh strategy (silent refresh every 45 minutes with popup fallback for `InteractionRequiredAuthError`).

#### Scenario: Token refresh continues working on desktop
- **WHEN** a user's access token approaches expiration (45-minute interval)
- **THEN** the system SHALL call `acquireTokenSilent()` to refresh the token
- **AND** the existing fallback behavior in `useTokenRefresh.js` SHALL remain unchanged
