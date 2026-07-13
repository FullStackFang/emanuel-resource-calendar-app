# Design: Mobile App Store Publishing

## Context

The mobile track is half-built: `MobileApp` shell + `MobileAgenda` + `MobileEventDetail` work for authenticated phone users; PWA support and mobile browser auth (popup-to-redirect fallback) are shipped. Two tabs are placeholders, no workflow runs on a phone, and there is no store packaging. Approved product design: `docs/superpowers/specs/2026-07-12-mobile-app-store-design.md`.

A code-architecture review (2026-07-12, run against the actual codebase) validated the direction but overturned four assumptions; its findings are baked into the Decisions and Risks below. Most important: the existing public endpoints are unusable and one leaks PII today; MSAL-in-Capacitor is a redesign, not an adapter shim; two claimed "reuse" targets are not currently extractable.

## Goals / Non-Goals

**Goals:**
- Phone users (web, PWA, and native app) can browse the calendar; signed-in staff can track/submit reservations and approvers can approve/reject.
- Unauthenticated guests get a public published-events calendar (required for App Store acceptance and congregant value).
- Both apps published to the Apple App Store and Google Play Store from this one codebase via Capacitor.
- Packaging keeps native push notifications possible later (deferred phase).

**Non-Goals:**
- Admin management screens on mobile.
- Chat/AI tab.
- Push notification implementation (Phase 3, separate design).
- Tablet layouts (tablet keeps desktop UI).
- Fixing the desktop UI's responsiveness — the mobile experience is a separate component tree by established convention.

## Decisions

### D1. Packaging: Capacitor for both platforms
One codebase, three surfaces (web, iOS, Android). Alternatives considered: TWA (PWABuilder) for Android + Capacitor for iOS (two packaging systems, two push stacks forever); React Native rebuild (duplicate codebase, unjustified for a calendar/forms app). Deciding factor: reliable iOS push later requires a native container.

### D2. New purpose-built public endpoint; existing public endpoints are quarantined
Review finding: `/api/public/internal-events` (backend/api-server.js:14048) returns raw unprojected documents — `roomReservationData.requestedBy` PII, draft/pending/rejected events, no child-doc filtering, sorts by `graphData` (violating the graphData isolation rule), `limit(1000)` with no date window. **It is not a foundation; it is a P0 leak to fix independently.**

New endpoint (e.g. `GET /api/public/events`):
- Query: top-level `startDateTime < end && endDateTime > start`, `status: 'published'`, `isDeleted: { $ne: true }`, `eventType: { $nin: ['exception','addition'] }`.
- **Server-side projection is the PII boundary**: include only display fields (id, title, start/end, location display names, categories, all-day flag). Never rely on the frontend to omit fields — `transformEventToFlatStructure()` surfaces whatever the backend sends, and `MobileEventDetail` renders `requesterName`/`requesterEmail` unconditionally when present.
- Dedicated rate limit sized for carrier CGNAT (many users per IP), not the generic `publicLimiter` (100 req/15 min/IP).

Alternative considered: extending `/api/public/internal-events` — rejected; it is legacy/export-oriented and every one of its behaviors is wrong for this use.

### D3. Guest mode is an explicit fetch branch, not a "data source swap"
Review finding: `MobileAgenda.fetchEvents` early-returns without a token, leaving the skeleton loader up forever, and POSTs to JWT-gated `/api/events/load`. Guest mode therefore gets an explicit unauthenticated path: when `apiToken` is falsy, the agenda fetches the public endpoint; loading state must resolve in both branches. `MobileHeader` gets a new guest variant ("Staff Sign In" instead of the avatar — this UI does not exist today). `SSEProvider` mounts safely unauthenticated (connects only with a token), so guests get **no live invalidation by design** — pull-to-refresh (already implemented in MobileAgenda) is the guest freshness mechanism.

### D4. Native auth: native MSAL bridge with reconciled auth state (NOT msal-browser through the system browser)
Review finding (P0): `@azure/msal-browser` cannot complete a redirect that returns from a separate browsing context — its PKCE state lives in the WebView's own storage, and there is no supported API to hand it an externally-obtained auth code or inject tokens into its cache. Microsoft's guidance for Capacitor-class apps is the native MSAL SDKs via a bridge plugin.

Design: a platform adapter (`authPlatform`) exposes one auth-state interface (account, acquireToken, login, logout). Web implementation wraps the existing msal-browser flows unchanged. Native implementation wraps a native MSAL bridge plugin (candidate: `capacitor-msal-auth` or equivalent — final selection is an implementation task with a spike). Consequence the spec must own: `useTokenRefresh`, `SessionExpiredDialog`, `App.jsx#acquireTokens`, and `MobileHeader` currently call `instance.*`/`useMsal()` directly and silently no-op when msal-browser's cache is empty — all four consume the adapter instead. This is a **medium-sized auth refactor**, not a shim; it is sequenced first in Phase 2 and validated on-device before any store work proceeds.

### D5. Reuse happens at the hook/utility level; desktop JSX never renders on phones
- Request wizard: `getProcessedFormData` is a component-local closure in `RoomReservationReview.jsx` bound to `RoomReservationFormBase` refs (2,795-line component). The payload-shaping logic is **extracted first** into a shared utility alongside `eventPayloadBuilder.js`, desktop migrated to it, then the wizard consumes it. `SchedulingAssistant` and `ReservationMarkerAdvisory` are already standalone and genuinely reusable.
- Approvals: reuse `useEventReviewExperience` + `useCurrentUserGates` (pure hooks, verified no JSX) — never the `EventReviewExperience` component, which renders desktop `ReviewModal`/`RoomReservationReview`.

### D6. No service worker inside the native shell
Review finding: `vite-plugin-pwa` `registerType: 'autoUpdate'` would silently pull newer JS from the production origin into the store-distributed binary — out-of-band code delivery (Apple guideline 3.3.1 rejection risk) and native/web version skew. SW registration is gated off when `Capacitor.isNativePlatform()` (or a separate Capacitor build target omits VitePWA). Web/PWA behavior unchanged.

### D7. Data-fetching consistency
New tabs (My Events, Approvals) use React Query + `deriveListLoadingState` per repo convention. The existing `MobileAgenda` uses manual `useState`/`fetch`; it is NOT migrated in this change (surgical-change rule) — the inconsistency is accepted and documented. A follow-up migration can unify later.

### D8. CI release builds
Manually triggered GitHub Actions workflow; macOS runner for iOS (no local Mac required), signed AAB for Android. TestFlight + Play Internal Testing before store publication.

## Risks / Trade-offs

- [Existing `/api/public/internal-events` leaks PII today] → Fix immediately as the first backend task (project fields or lock down), independent of feature progress; its only consumer is an admin CSV export (`EventSearchExport.jsx`).
- [Native MSAL bridge plugin quality/abandonment] → Time-boxed spike task selects the plugin and proves the round-trip on both platforms before the rest of Phase 2; fallback is a from-scratch system-browser PKCE flow with our own token store behind the same adapter.
- [`getProcessedFormData` extraction destabilizes the desktop form] → Extraction is its own task with characterization tests on the desktop submission payload before the wizard consumes it.
- [Apple review rejects the app (minimum functionality / login wall)] → Guest public calendar is real functionality; demo staff account provided to reviewers; tabbed native shell avoids "website in a box".
- [SSE lifecycle inside Capacitor (visibilitychange vs native app-state)] → On-device test checklist includes SSE reconnect after background/foreground on both platforms; if flaky, switch the reconnect signal to `@capacitor/app` `appStateChange` for native.
- [Guest rate limit too tight for shared carrier IPs] → Dedicated limiter with deliberate sizing + client-side caching of the guest agenda range.
- [Store re-submission latency for JS fixes] → Accepted: native releases are versioned store submissions; the web/PWA surface still updates instantly.

## Migration Plan

Phased; each phase shippable:
1. **Phase 1 — Mobile web completeness**: PII fix + new public endpoint → guest mode → My Events → payload extraction → Request wizard → Approvals. Ships as an improved PWA with no packaging dependency.
2. **Phase 2 — Native packaging**: auth spike → adapter refactor → Capacitor shells + SW gating → assets/CI → TestFlight/Internal validation → store submission.
3. **Phase 3 — Push notifications** (separate design later).

Rollback: Phase 1 is additive frontend + one new endpoint (feature-flag-free; guest branch keyed off existing auth state). Phase 2 artifacts live in `ios/`/`android/` and CI; the web app is unaffected if store work stalls.

## Open Questions

- Which native MSAL bridge plugin (or from-scratch PKCE) — resolved by the Phase 2 spike task.
- Exact guest rate-limit numbers — set during backend implementation with realistic usage estimates.
- Store listing ownership: who owns the Apple Developer / Play Console accounts and signing keys (org accounts recommended over personal).
