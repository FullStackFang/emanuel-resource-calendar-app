## 1. MSAL Auth Mobile Fix

- [ ] 1.1 Add `handleRedirectPromise()` call in `main.jsx` before `ReactDOM.createRoot()` — await the promise and pass the resolved account to the MSAL instance initialization
- [ ] 1.2 Update `handleLogin` in `Authentication.jsx` — wrap `loginPopup()` in try/catch, fallback to `loginRedirect()` on error
- [ ] 1.3 Update `handleLogout` in `Authentication.jsx` — wrap `logoutPopup()` in try/catch, fallback to `logoutRedirect()` on error
- [ ] 1.4 Verify deep-link preservation works with redirect flow — confirm the existing `sessionStorage` eventId logic in `main.jsx` fires before `handleRedirectPromise()`
- [ ] 1.5 Test login flow in Chrome DevTools mobile emulation (iPhone SE, Pixel 7) — verify popup fallback triggers redirect

## 2. PWA Setup

- [ ] 2.1 Install `vite-plugin-pwa` as a devDependency
- [ ] 2.2 Generate PWA icons (192x192 and 512x512 PNG) from `public/emanuel_logo.png` — place in `public/`
- [ ] 2.3 Add PWA plugin configuration to `vite.config.js` — manifest metadata (name, short_name, display, theme_color, icons), generateSW strategy, navigation fallback, exclude auth and SSE routes from service worker interception
- [ ] 2.4 Verify `npm run build` produces `dist/sw.js` and `dist/manifest.webmanifest` in build output
- [ ] 2.5 Test "Add to Home Screen" in Chrome DevTools Application panel — verify manifest is valid, service worker registers, installability criteria pass

## 3. Device Detection Hook

- [ ] 3.1 Create `src/hooks/useDeviceType.js` — `matchMedia`-based hook returning `'phone' | 'tablet' | 'desktop'` with breakpoints at 480px and 1024px, reactive to viewport changes
- [ ] 3.2 Create `src/components/mobile/MobileLayout.jsx` — placeholder component with app branding, "Mobile experience coming soon" message, and sign-out button
- [ ] 3.3 Create `src/components/mobile/MobileLayout.css` — basic mobile-friendly styling for the placeholder

## 4. App Routing Fork

- [ ] 4.1 Add `useDeviceType()` to `App.jsx` — conditionally render `MobileLayout` for phone, existing layout for tablet and desktop
- [ ] 4.2 Verify desktop app is completely unchanged — all existing routes, modals, and features work identically at viewport > 1024px
- [ ] 4.3 Verify phone viewport (<=480px) shows MobileLayout placeholder with working auth (sign in / sign out)

## 5. Verification & Cleanup

- [ ] 5.1 Run full frontend test suite (`npm run test:run`) — verify no regressions from auth or App.jsx changes
- [ ] 5.2 Run `npm run build` — verify clean production build with PWA assets
- [ ] 5.3 Test service worker does not cache API calls or SSE connections — verify in Network tab that `/api/*` requests bypass cache
