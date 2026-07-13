## ADDED Requirements

### Requirement: Capacitor native shells for iOS and Android
The repository SHALL contain Capacitor-generated iOS and Android projects that load the production web bundle, buildable into store-submittable artifacts.

#### Scenario: Web bundle syncs into native shells
- **WHEN** a release is prepared
- **THEN** `npm run build` followed by `npx cap sync` SHALL copy the current web bundle into both native projects
- **AND** the native apps SHALL render the same mobile experience as the phone web app

#### Scenario: Native platform detection
- **WHEN** the app runs inside a Capacitor shell
- **THEN** `Capacitor.isNativePlatform()` SHALL report true
- **AND** platform-dependent behavior (auth strategy, safe areas) SHALL switch accordingly

### Requirement: No service worker inside the native shell
The Capacitor-bundled build SHALL NOT register the vite-plugin-pwa service worker. The store-distributed app updates only through store releases; out-of-band code delivery via an auto-updating service worker risks Apple App Review rejection (guideline 3.3.1) and native/web version skew.

#### Scenario: Service worker skipped on native
- **WHEN** the app boots inside the Capacitor shell
- **THEN** no service worker SHALL be registered (gated by `Capacitor.isNativePlatform()` or a Capacitor-specific build target)

#### Scenario: Web/PWA service worker unchanged
- **WHEN** the app runs in a browser or as an installed PWA
- **THEN** the existing vite-plugin-pwa `autoUpdate` service worker SHALL continue to register and update as today

### Requirement: Native authentication via system browser
When running natively, sign-in SHALL use the device's system browser with a custom URL scheme redirect, not an embedded WebView login.

#### Scenario: Native login round-trip
- **WHEN** a user taps "Staff Sign In" inside the native app
- **THEN** Azure AD login SHALL open in the system browser (Custom Tabs on Android, ASWebAuthenticationSession/SFSafariViewController on iOS)
- **AND** after authentication Azure AD SHALL redirect to the app's registered custom URL scheme
- **AND** the app SHALL complete the token exchange and render the authenticated shell

#### Scenario: Browser behavior unchanged
- **WHEN** the app runs in any web browser (including installed PWA)
- **THEN** the existing popup-with-redirect-fallback flow SHALL be used unchanged

### Requirement: Store-ready packaging assets
Both apps SHALL ship with complete store metadata: adaptive icons, splash screens, listing screenshots, and a hosted privacy policy URL.

#### Scenario: Assets generated from a single source
- **WHEN** app icons and splash screens are produced
- **THEN** they SHALL be generated from a single 1024px source image via `@capacitor/assets` for all required sizes on both platforms

#### Scenario: Privacy policy available
- **WHEN** a store reviewer or user opens the privacy policy link from either store listing
- **THEN** a publicly accessible privacy policy page SHALL load

### Requirement: Reproducible release builds
Release builds SHALL be produced by a manually triggered CI workflow, including iOS builds on macOS runners, so no local Mac is required.

#### Scenario: iOS release build in CI
- **WHEN** the release workflow is triggered
- **THEN** a signed iOS build SHALL be produced on a macOS runner and uploadable to TestFlight

#### Scenario: Android release build in CI
- **WHEN** the release workflow is triggered
- **THEN** a signed Android App Bundle SHALL be produced and uploadable to the Play Console

#### Scenario: Pre-release validation channel
- **WHEN** a release candidate is built
- **THEN** it SHALL be distributed through TestFlight (iOS) and the Play Internal Testing track (Android) before store publication
