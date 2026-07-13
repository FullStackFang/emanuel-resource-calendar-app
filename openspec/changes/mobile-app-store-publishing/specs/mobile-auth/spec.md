## ADDED Requirements

### Requirement: Native shell authentication
When the app runs inside the Capacitor native shell, the system SHALL authenticate through the platform's native auth mechanism (a native MSAL SDK bridge plugin, or an equivalent system-browser PKCE flow with explicit token-state reconciliation), selected through a platform adapter. Browser (web/PWA) authentication behavior SHALL remain unchanged. `@azure/msal-browser`'s popup/redirect machinery SHALL NOT be assumed to work across the system-browser boundary (its PKCE state lives in the WebView's own storage and cannot complete a redirect that returns via a custom URL scheme from a separate browsing context).

#### Scenario: Platform adapter selects strategy
- **WHEN** an authentication interaction is initiated (login, logout, interactive token acquisition)
- **THEN** a single platform adapter SHALL choose the native strategy when `Capacitor.isNativePlatform()` is true, and the existing popup/redirect strategy otherwise
- **AND** `Authentication.jsx`, `useTokenRefresh`, `SessionExpiredDialog`, and `App.jsx`'s token acquisition SHALL consume auth state through the adapter, not through direct `instance.*` / `useMsal()` calls that assume msal-browser's cache

#### Scenario: Native login completes via system browser
- **WHEN** a user signs in inside the native app
- **THEN** Azure AD SHALL open in the system browser (Custom Tabs on Android, ASWebAuthenticationSession on iOS) and return via the app's registered redirect
- **AND** the app SHALL expose the resulting account and tokens through the same auth state consumed on web (adapter-level reconciliation), so downstream code sees one signed-in shape

#### Scenario: Native silent refresh and session expiry
- **WHEN** a token refresh is needed inside the native app
- **THEN** the adapter SHALL perform silent acquisition through the native token cache
- **AND** when interaction is required, the session-expired flow SHALL run the native interactive flow instead of `loginPopup()`
- **AND** the 45-minute proactive refresh behavior SHALL function on native (it MUST NOT silently no-op because `getAllAccounts()` is empty)

#### Scenario: Azure AD registration includes mobile redirect URIs
- **WHEN** the native auth flow is configured
- **THEN** the Azure AD app registration SHALL include the iOS and Android redirect URIs required by the chosen native mechanism
- **AND** no backend JWT validation changes SHALL be required

#### Scenario: On-device auth validation before store release
- **WHEN** a release candidate is distributed via TestFlight or Play Internal Testing
- **THEN** a documented manual checklist SHALL verify: cold-start login, token refresh past the 45-minute mark, session-expired re-auth, and sign-out/sign-in cycling on both platforms
