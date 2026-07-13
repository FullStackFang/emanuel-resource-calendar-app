## 1. Backend: public events (Phase 1)

- [ ] 1.1 P0 fix: lock down `/api/public/internal-events` — add server-side projection excluding `roomReservationData`/`graphData`, filter to `status: 'published'` + `isDeleted: { $ne: true }`; verify `EventSearchExport.jsx` (its only consumer) still works. Jest tests for the projection.
- [ ] 1.2 New `GET /api/public/events` endpoint: date-range query on top-level `startDateTime`/`endDateTime`, published-only, excludes exception/addition children, strict display-field projection. Jest tests: shape, status filtering, child exclusion, no PII fields present.
- [ ] 1.3 Dedicated rate limiter for the guest endpoint sized for shared carrier IPs (not generic `publicLimiter`); test 429 behavior.

## 2. Guest mode (Phase 1)

- [ ] 2.1 `App.jsx`: unauthenticated branch — render `MobileApp` in guest mode on phone viewports (and native) instead of the sign-in landing page; providers mount safely without `apiToken`.
- [ ] 2.2 `MobileAgenda`: explicit guest fetch branch hitting `/api/public/events` when `apiToken` is falsy; loading state resolves in both branches (fix the token-less infinite-skeleton guard). Unit tests for both branches.
- [ ] 2.3 `MobileHeader` guest variant: "Staff Sign In" button replacing the avatar; sign-in upgrades the shell in place; sign-out returns to guest mode. Unit tests.
- [ ] 2.4 Guest-safe `MobileEventDetail`: public events render only display fields; workflow actions and requester info absent (server projection is the boundary; verify no undefined-field rendering). Unit test with a projected public event.
- [ ] 2.5 Guest taps on My Events/Request tabs show the sign-in prompt; guest empty/error states use `EmptyStateRefreshButton`.

## 3. My Events tab (Phase 1)

- [ ] 3.1 Mobile My Reservations list: React Query + `deriveListLoadingState`, ownership query via `roomReservationData.requestedBy.email`, status filter chips, excludes child docs. First-paint test per existing `*.firstPaint.test.jsx` pattern.
- [ ] 3.2 Reservation detail via `MobileEventDetail` incl. status, review notes, rejection reason.
- [ ] 3.3 Withdraw-pending: in-button confirm ("Confirm?" → "Withdrawing..."), required reason, `expectedVersion`, 409 handling, toasts. Unit tests for confirm flow and 409.

## 4. Request wizard (Phase 1)

- [ ] 4.1 Extract payload-shaping logic from `RoomReservationReview.jsx#getProcessedFormData` into a shared utility alongside `eventPayloadBuilder.js`; characterization tests locking the desktop submission payload before and after; migrate desktop to the extraction.
- [ ] 4.2 Wizard shell: What → When → Where → Details → Review steps with progress, back-preserves-state, per-step validation. Unit tests per step.
- [ ] 4.3 Where step: reservable-location filtering by capacity/features; availability/conflict check via existing logic (reuse `SchedulingAssistant` internals or its hooks).
- [ ] 4.4 When/Review steps: marker advisory (`ReservationMarkerAdvisory`) + blocking closure warning on submit, matching desktop behavior.
- [ ] 4.5 Submit through the extracted payload utility; verify created event matches a desktop-submitted one (status `pending`, `requestedBy` canonical). Integration-style test.

## 5. Approvals tab (Phase 1)

- [ ] 5.1 Permission-gated tab: render only with `canApproveReservations` from `usePermissions()`. Unit test both gates.
- [ ] 5.2 Queue list: pending requests, child docs excluded, React Query + `deriveListLoadingState` + `EmptyStateRefreshButton`.
- [ ] 5.3 Approve/reject actions via `useEventReviewExperience`/`useCurrentUserGates` hooks (never the `EventReviewExperience` component): in-button confirm, forced rejection reason, `expectedVersion`, VERSION_CONFLICT and SchedulingConflict 409 handling with mobile-appropriate dialogs. Unit tests.

## 6. Phase 1 verification

- [ ] 6.1 Run affected frontend test files + new backend test files; fix regressions.
- [ ] 6.2 On-device browser pass (real phone, PWA install): guest browse, sign-in upgrade, submit request, approve/reject, withdraw. Fix findings.

## 7. Native auth spike (Phase 2, gate for everything below)

- [ ] 7.1 Time-boxed spike: select native MSAL mechanism (evaluate `capacitor-msal-auth` / equivalent bridge plugins vs from-scratch system-browser PKCE); prove login round-trip + silent refresh on both platforms in a scratch Capacitor app; record decision in design.md.
- [ ] 7.2 Define `authPlatform` adapter interface (account, acquireToken, login, logout, session-expired signal); web implementation wraps existing msal-browser flows unchanged.
- [ ] 7.3 Refactor `useTokenRefresh`, `SessionExpiredDialog`, `App.jsx#acquireTokens`, `MobileHeader` to consume the adapter (no direct `instance.*`/`useMsal()` assumptions); 45-min proactive refresh must not no-op on native. Unit tests with a mocked adapter.
- [ ] 7.4 Azure AD app registration: add iOS/Android redirect URIs required by the chosen mechanism.

## 8. Capacitor packaging (Phase 2)

- [ ] 8.1 Add Capacitor deps; `npx cap add ios android`; commit `ios/`/`android/`; document the `build` + `cap sync` flow in CLAUDE.md.
- [ ] 8.2 Gate service-worker registration off on `Capacitor.isNativePlatform()` (or Capacitor build target without VitePWA); verify no SW registers in the native shell and web/PWA behavior is unchanged.
- [ ] 8.3 Safe-area and native polish: insets on header/tab bar, status-bar theming, network-unreachable banner.
- [ ] 8.4 Icons + splash screens from single 1024px source via `@capacitor/assets`.

## 9. Release pipeline + store submission (Phase 2)

- [ ] 9.1 GitHub Actions manual release workflow: Android signed AAB; iOS build+sign on macOS runner, upload to TestFlight.
- [ ] 9.2 Store prerequisites: Apple Developer + Play Console accounts (org-owned), signing keys, privacy policy page hosted on the existing site.
- [ ] 9.3 On-device validation via TestFlight/Play Internal: auth checklist (cold-start login, 45-min refresh, session-expired re-auth, sign-out/in), SSE reconnect after background/foreground, guest mode, all four tabs.
- [ ] 9.4 Store listings (descriptions, screenshots, demo staff account for Apple review); submit; handle review feedback.
