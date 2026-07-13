# Mobile-Friendly App + App Store Publishing — Design

**Date:** 2026-07-12
**Status:** Approved by user (all four sections) 2026-07-12; superseded by `openspec/changes/mobile-app-store-publishing/` after architecture review

> **Amendments (2026-07-12 architecture review):** a code-architecture review against the actual codebase overturned four assumptions in this document. The authoritative, corrected design lives in `openspec/changes/mobile-app-store-publishing/design.md`. Key corrections: (1) the existing `/api/public/internal-events` endpoint is unusable and leaks requester PII today — a new projected endpoint is required and the old one must be locked down (P0); (2) MSAL cannot ride `@azure/msal-browser` through the system browser in Capacitor — native auth needs a native MSAL bridge and a real refactor of `useTokenRefresh`/`SessionExpiredDialog`/`App.jsx` token acquisition, not a "small adapter"; (3) `getProcessedFormData` is a component-local closure, not a reusable utility — it must be extracted first; Approvals reuse is at the `useEventReviewExperience`/`useCurrentUserGates` hook level, never the desktop component; (4) the PWA service worker must be disabled inside the native shell (Apple 3.3.1 / version-skew risk).

## Goal

Make the Temple Emanuel Resource Calendar app fully usable on phones and publish it to both the Apple App Store and Google Play Store, with a public (unauthenticated) event calendar for congregants and the full reservation workflow for signed-in staff.

## Requirements (confirmed with user)

1. **Mobile scope:** View + core workflows on phones — agenda calendar, My Reservations, submit a room reservation request, approve/reject (for approvers). Admin management screens (categories, locations, users, markers, etc.) remain desktop-only.
2. **Store presence:** Real listings on both the Apple App Store and Google Play Store, discoverable by congregants.
3. **Public access:** Unauthenticated users see a public calendar of published events. Staff sign in with M365 for reservations/approvals. (Required for Apple guideline 4.2/3.2 compliance — login-walled employee-only apps get rejected.)
4. **Push notifications:** Designed-for but shipped in a later phase. Email notifications (existing) remain the v1 channel.
5. **Tablet:** Continues to receive the desktop UI. Phone breakpoint gets the mobile experience.

## Current State (assets already on main)

- **PWA foundation:** `vite-plugin-pwa` configured in `vite.config.js` — manifest, service worker (`autoUpdate`), API/auth routes excluded from caching, 192/512px icons.
- **Mobile auth:** MSAL popup-to-redirect fallback for mobile browsers; `handleRedirectPromise()` processed in `main.jsx` before React render.
- **Device detection:** `useDeviceType()` hook (matchMedia; phone/tablet/desktop).
- **Mobile shell:** `src/components/mobile/` — `MobileApp` (bottom-tab shell), `MobileHeader`, `MobileBottomTabs`, `MobileAgenda` (working agenda view), `MobileEventCard`, `MobileEventDetail` (with floor-plan zoom), `MobileWeekStrip`, `MobileDatePicker` (tiered). Tests exist for WeekStrip, DatePicker, EventDetail.
- **Gaps:** "My Events" and "Chat" tabs are placeholders. `MobileApp` renders only inside the authenticated tree (`App.jsx` ~line 318–330). No store packaging. Public API exists but limited (`/api/public/internal-events`, `/api/public/mec-categories`, rate-limited via `publicLimiter`).

## Chosen Approach

**Capacitor wrapping the existing React/Vite app, for both platforms** (Approach A). One codebase produces three surfaces: the Azure-hosted web app (unchanged), an Android app, and an iOS app.

Rejected alternatives:
- **TWA (PWABuilder) for Android + Capacitor for iOS:** faster Android bring-up but two packaging systems and two push stacks forever.
- **React Native rebuild:** duplicate codebase, re-solves auth/data/transforms; unjustified for a calendar/forms app.

Deciding factor: reliable push notifications on iOS later require a native container (APNs via `@capacitor/push-notifications`); web push in iOS wrappers is unreliable.

## Section 1 — Architecture

- Capacitor added as a build-time layer: `npx cap add ios android` generates native projects committed to the repo (`ios/`, `android/`). `npm run build` + `npx cap sync` copies the web bundle into the shells.
- `useDeviceType()` stays the phone/tablet/desktop switch. New: `Capacitor.isNativePlatform()` distinguishes store-app from mobile-browser where behavior differs (auth strategy, safe-area insets, future push registration).
- **Guest mode (new architectural piece):** `App.jsx` gets an unauthenticated branch — when there is no `apiToken` and the device is a phone (or running natively), render `MobileApp` in guest mode instead of the sign-in landing page. Guest mode fetches published events from `/api/public/*` (extended with a proper published-events query shaped for the agenda view). Header shows "Staff Sign In"; signing in upgrades the same shell in place.
- Tablet: desktop UI, unchanged.

## Section 2 — Mobile Screens (Phase 1 scope)

Bottom-tab set (replaces current Calendar / My Events / Chat):

1. **Calendar** (exists) — gains guest mode: same `MobileAgenda` fed by public data when unauthenticated; full data when signed in.
2. **My Events** (placeholder → real) — mobile My Reservations: status-filtered list of the user's requests using `MobileEventCard`; detail via `MobileEventDetail`; withdraw-pending with the standard in-button confirm pattern (`Confirm?` → `Withdrawing...`). Same React Query hooks + `deriveListLoadingState` conventions as desktop. Empty states use `EmptyStateRefreshButton`.
3. **Request** (new; replaces the Chat placeholder) — mobile-first reservation request form as a step wizard: What (title/description/category) → When (date/time, setup/teardown) → Where (room selection with capacity/feature filtering) → Details (attendees, services) → Review & Submit. Reuses `getProcessedFormData`, availability checking, and holiday/closure marker advisory + blocking logic. Guest users see a sign-in prompt.
4. **Approvals** (new; visible only when `canApproveReservations`) — approval queue as a card list; approve/reject with the forced-reason flow; same endpoints, OCC `expectedVersion`, and 409 conflict handling as `EventReviewExperience`.

**Reuse rule:** business logic is shared (hooks, `transformEventToFlatStructure`, permission gates from `usePermissions()`, React Query keys); presentation JSX is mobile-specific. No desktop component is rendered on the phone breakpoint.

## Section 3 — Auth in the Native Shell

- **Web (browsers + PWA):** unchanged — current popup-with-redirect-fallback.
- **Native (Capacitor):** MSAL redirect cannot return into a WebView at `capacitor://localhost`. Instead: login opens Azure AD in the system browser via `@capacitor/browser` (Custom Tabs on Android; `ASWebAuthenticationSession`/`SFSafariViewController` on iOS). Azure AD redirects to a custom URL scheme (e.g. `msauth.org.emanuelnyc.events://auth`) registered in both native projects; the app completes the token exchange through MSAL redirect handling.
- A small `authPlatform.js` adapter selects the strategy so `Authentication.jsx`, `useTokenRefresh`, and `SessionExpiredDialog` call one interface.
- Azure AD app registration gains the two mobile redirect URIs (portal-only change).
- Backend JWT validation, token caching, JWKS: untouched.

## Section 4 — Store Pipeline, Testing, Phasing

**Packaging & store submission (Phase 2):**
- Assets: adaptive icons + splash screens generated from one 1024px source via `@capacitor/assets`; store screenshots; privacy policy page hosted on the existing site.
- Accounts: Apple Developer Program ($99/yr), Google Play Console ($25 one-time).
- Apple review prep: demo staff account for reviewers; the tabbed native-feeling shell addresses "minimum functionality" scrutiny.
- iOS builds require macOS: use GitHub Actions macOS runners (manual-trigger release workflow), no physical Mac needed. Android builds anywhere.
- Update model: web/PWA surface updates on web deploy; store apps bundle their JS, so meaningful releases go through store re-submission (Apple review typically 1–2 days).
- Pre-release distribution: TestFlight (iOS) and Play Internal Testing track for on-device validation, especially the auth flow.

**Error handling:**
- Guest mode: friendly offline/empty states reusing `EmptyStateRefreshButton`.
- Native shell: network-unreachable banner.
- Sentry: already covers all surfaces (same bundle).

**Testing:**
- Vitest unit tests per new mobile component (patterns per `MobileWeekStrip.test.jsx`).
- Backend Jest coverage for the extended public published-events endpoint (shape, rate limiting, no leakage of non-published or child exception docs).
- Auth adapter: manual on-device validation via TestFlight/Internal track (documented checklist), since it cannot be unit-tested meaningfully.

**Phases:**
1. **Mobile web completeness** — guest mode + the four tabs above. Shippable alone; immediately improves the PWA.
2. **Capacitor packaging + store submission** — native shells, auth adapter, assets, accounts, review cycles.
3. **Push notifications** (placeholder, not designed here) — device-token storage, APNs/FCM alongside `emailService`, triggered from the same notification points.

## Out of Scope

- Admin management screens on mobile.
- Chat/AI assistant tab (dropped from the tab set for now).
- Push notification implementation detail (Phase 3 gets its own design).
- Tablet-specific layouts.
