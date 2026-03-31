## ADDED Requirements

### Requirement: App is installable to home screen
The system SHALL provide a valid PWA manifest that allows users to install the app to their device's home screen on both Android and iOS.

#### Scenario: Android install prompt
- **WHEN** a user visits the app in Chrome on Android
- **AND** the PWA installability criteria are met (manifest + service worker + HTTPS)
- **THEN** the browser MAY show an "Add to Home Screen" prompt
- **AND** tapping the installed icon SHALL launch the app in standalone mode (no browser chrome)

#### Scenario: iOS manual install
- **WHEN** a user visits the app in Safari on iOS
- **AND** taps Share -> "Add to Home Screen"
- **THEN** the app SHALL appear on the home screen with the Temple Emanuel icon
- **AND** tapping the installed icon SHALL launch the app in standalone mode (no URL bar)

#### Scenario: Standalone display mode
- **WHEN** the app is launched from a home screen icon
- **THEN** the app SHALL render in standalone mode with no browser navigation bar
- **AND** the status bar SHALL use the app's theme color
- **AND** a splash screen with the app icon SHALL display during load

### Requirement: PWA manifest contains correct metadata
The manifest SHALL include the app identity, icons, display preferences, and theme colors for the Temple Emanuel branding.

#### Scenario: Manifest fields are complete
- **WHEN** the browser reads the PWA manifest
- **THEN** the manifest SHALL include `name` set to "Temple Events Scheduler"
- **AND** `short_name` set to "Temple Events"
- **AND** `start_url` set to "/"
- **AND** `display` set to "standalone"
- **AND** `theme_color` and `background_color` set to appropriate brand colors
- **AND** `icons` array with at least 192x192 and 512x512 PNG icons

### Requirement: Static assets are cached by service worker
The system SHALL register a service worker that precaches the Vite build output (JS, CSS, HTML, images) for faster repeat loads.

#### Scenario: Repeat visit loads cached assets
- **WHEN** a user visits the app for the second time
- **THEN** static assets (JavaScript bundles, CSS files, images) SHALL be served from the service worker cache
- **AND** the app SHALL load faster than the first visit

#### Scenario: New deployment updates cached assets
- **WHEN** a new version of the app is deployed with updated content-hashed filenames
- **THEN** the service worker SHALL detect the new precache manifest
- **AND** the service worker SHALL activate the new cache and serve updated assets

#### Scenario: API requests are not cached
- **WHEN** the app makes API requests to the backend (e.g., `/api/events/list`)
- **THEN** the service worker SHALL NOT cache these requests
- **AND** API requests SHALL always go to the network

### Requirement: Service worker does not break existing functionality
The service worker SHALL not interfere with MSAL authentication flows, SSE connections, or any existing app functionality.

#### Scenario: MSAL redirect flow works with service worker
- **WHEN** the MSAL redirect flow navigates to Microsoft's login page and returns
- **THEN** the service worker SHALL not intercept or cache the authentication redirect
- **AND** `handleRedirectPromise()` SHALL process the response normally

#### Scenario: SSE connections are not intercepted
- **WHEN** the app establishes Server-Sent Events connections for real-time updates
- **THEN** the service worker SHALL not intercept SSE requests
