# Mobile App Store Publishing

## Why

The mobile experience is half-built: the phone app shell, agenda view, and PWA foundation exist, but two of three tabs are placeholders and no core workflow (submit, track, approve reservations) works on a phone. The temple also wants a real presence on the Apple App Store and Google Play Store so congregants can find the app, which additionally requires a public (unauthenticated) calendar — Apple rejects login-walled employee-only apps.

Approved design: `docs/superpowers/specs/2026-07-12-mobile-app-store-design.md`.

## What Changes

- **Guest mode**: unauthenticated phone users (and native app users) see a public calendar of published events instead of the sign-in landing page, with a "Staff Sign In" path that upgrades the shell in place.
- **Public events endpoint**: extend `/api/public/*` with a published-events query shaped for the mobile agenda (published only, no deleted/child docs, no requester PII).
- **My Events tab**: placeholder becomes a real mobile My Reservations view (status-filtered list, detail, withdraw-pending with in-button confirm).
- **Request tab**: replaces the Chat placeholder with a mobile-first step-wizard reservation request form (What → When → Where → Details → Review), reusing desktop business logic (form processing, availability, marker advisory/blocking).
- **Approvals tab**: new, visible only to users with `canApproveReservations`; card-list approval queue with approve/reject, reusing the `useEventReviewExperience`/`useCurrentUserGates` hooks (not the desktop `EventReviewExperience` component) for OCC and conflict handling.
- **Native packaging**: Capacitor iOS + Android shells committed to the repo; MSAL auth via system browser + custom URL scheme on native; store assets, GitHub Actions macOS release builds, TestFlight/Play Internal testing, then store submission.
- Push notifications explicitly deferred (design placeholder only).
- Chat/AI tab dropped from the mobile tab set for now.

## Capabilities

### New Capabilities

- `public-events-access`: unauthenticated guest mode on phones/native — public published-events API and guest rendering of the mobile agenda with sign-in upgrade path.
- `mobile-my-events`: mobile My Reservations — the user's own requests with status filtering, detail view, and withdraw-pending.
- `mobile-reservation-request`: step-wizard room reservation request form on mobile, sharing desktop form-processing/availability/marker logic.
- `mobile-approvals`: permission-gated mobile approval queue with approve/reject including forced-reason and OCC conflict handling.
- `native-app-packaging`: Capacitor iOS/Android shells, native auth integration, store assets, CI release builds, and store submission pipeline.

### Modified Capabilities

- `mobile-app-shell`: tab set changes from Calendar/My Events/Chat to Calendar/My Events/Request/Approvals (Approvals conditional); shell must render for unauthenticated guests, not only authenticated users.
- `mobile-auth`: adds native-shell authentication requirement — system-browser MSAL flow with custom URL scheme when running inside Capacitor, selected via a platform adapter; browser popup/redirect behavior unchanged.
- `mobile-agenda`: agenda must render from the public data source when unauthenticated (guest mode), with full data when signed in.

## Impact

- **Frontend**: `src/App.jsx` (unauthenticated guest branch), `src/components/mobile/*` (new tab views, wizard), `Authentication.jsx`/`useTokenRefresh`/`SessionExpiredDialog` (behind new `authPlatform.js` adapter), new shared-logic extractions from `RoomReservationForm`/`EventReviewExperience` where currently tangled.
- **Backend**: new/extended public published-events endpoint under `/api/public/` with `publicLimiter`; no auth or data-model changes.
- **New top-level dirs**: `ios/`, `android/` (Capacitor projects), CI workflow for iOS/Android release builds.
- **Dependencies**: `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android`, `@capacitor/browser`, `@capacitor/assets` (dev).
- **External**: Azure AD app registration gains two mobile redirect URIs; Apple Developer ($99/yr) and Google Play ($25) accounts; privacy policy page.
- **Unchanged**: desktop UI, backend auth/JWT validation, Graph API integration, email notifications, tablet (keeps desktop UI).
