## Context

The Emanuel Resource Calendar app is a React 19 + Vite SPA with MSAL (Azure AD) authentication. It currently uses `loginPopup()` exclusively, which fails silently on mobile browsers where popup blockers are enabled by default (iOS Safari, Android Chrome). There is no PWA manifest or service worker, so the app cannot be installed to a phone's home screen. There is no device detection infrastructure to serve different layouts based on viewport size.

The app is deployed to Azure Web Apps. The backend (Express + MongoDB) requires zero changes for this work. The frontend uses `sessionStorage` for MSAL token caching, custom CSS with design tokens, and Vite's code-splitting with manual chunks.

Key existing files:
- `src/components/Authentication.jsx` — popup-only login/logout
- `src/config/authConfig.js` — MSAL config with `sessionStorage` cache, `redirectUri: window.location.origin`
- `src/main.jsx` — `PublicClientApplication` init, `MsalProvider` wrapping
- `vite.config.js` — React + Sentry plugins, manual chunk splitting
- `public/emanuel_logo.png` — existing logo for PWA icon generation

## Goals / Non-Goals

**Goals:**
- Login works on mobile browsers (iOS Safari, Android Chrome, Samsung Internet)
- Users can "Add to Home Screen" and get a full-screen, app-like experience
- `useDeviceType()` hook exists for components to branch on phone/tablet/desktop
- Routing fork in `App.jsx` renders a placeholder for phones that future mobile views will replace
- Zero impact on existing desktop behavior

**Non-Goals:**
- Building actual mobile view components (follow-up change)
- Offline data caching or background sync
- Push notifications
- Tablet-specific layout changes
- App Store or Play Store distribution
- Changes to backend API

## Decisions

### 1. Auth Strategy: Popup-First with Redirect Fallback

**Decision:** Wrap `loginPopup()` in try/catch with `loginRedirect()` fallback. On known mobile user agents, skip popup and go straight to redirect.

**Rationale:** The popup flow works well on desktop (no page navigation, preserves app state). Redirect is more reliable on mobile but causes a full page reload. Using popup-first with fallback gives the best experience on both platforms.

**Alternatives considered:**
- *Redirect-only everywhere:* Simpler but degrades desktop UX with unnecessary page reloads
- *Popup-only with user instructions:* Fragile — relies on users disabling popup blockers
- *Conditional based on user agent only:* UA strings are unreliable; try/catch is more robust

**Implementation approach:**
- `Authentication.jsx`: `handleLogin` wraps `loginPopup()` in try/catch, falls back to `loginRedirect()`
- `Authentication.jsx`: `handleLogout` wraps `logoutPopup()` in try/catch, falls back to `logoutRedirect()`
- `main.jsx`: Call `msalInstance.handleRedirectPromise()` before rendering the React tree. This is required to process the token returned in the URL hash after a redirect login. Must happen before `ReactDOM.createRoot()`.
- `authConfig.js`: No changes needed — `redirectUri: window.location.origin` already works for both flows
- Deep-link preservation in `main.jsx` (the existing `sessionStorage` eventId logic) already handles redirect returns

### 2. PWA: vite-plugin-pwa with GenerateSW Strategy

**Decision:** Use `vite-plugin-pwa` with Workbox `generateSW` mode for automatic service worker generation. Cache static assets only (no runtime API caching).

**Rationale:** `generateSW` requires zero custom service worker code — Workbox auto-generates precaching for Vite's build output. This is the right starting point: cache the app shell (JS/CSS/HTML/images) so the app loads quickly on repeat visits, but don't cache API responses (which need to be fresh).

**Alternatives considered:**
- *injectManifest mode:* More control but requires writing a custom service worker — overkill for static-only caching
- *No service worker, manifest only:* Would enable "Add to Home Screen" but no asset caching benefit
- *Workbox runtime caching for API calls:* Premature — offline data support is out of scope

**Configuration:**
- `manifest.json` fields: name, short_name, start_url, display (standalone), theme_color, background_color, icons (192px + 512px)
- Service worker: precache Vite build output, `networkFirst` for navigation requests
- Icons: Generate 192x192 and 512x512 PNG from existing `public/emanuel_logo.png`
- Add to `vite.config.js` plugins array

### 3. Device Detection: matchMedia-Based Hook

**Decision:** Create `useDeviceType()` using `window.matchMedia` with breakpoints at 480px (phone/tablet) and 1024px (tablet/desktop). Returns `'phone' | 'tablet' | 'desktop'`.

**Rationale:** `matchMedia` is more reliable than `window.innerWidth` because it uses the same engine as CSS media queries, fires change events (no resize listener needed), and is SSR-safe with a sensible default.

**Alternatives considered:**
- *User agent detection:* Unreliable, doesn't account for browser resize or responsive testing
- *window.innerWidth with resize listener:* Works but requires debouncing and manual cleanup; matchMedia is cleaner
- *CSS-only with `display: none`:* Can't branch React component trees from CSS alone

**Breakpoints:**
- Phone: `(max-width: 480px)`
- Tablet: `(min-width: 481px) and (max-width: 1024px)`
- Desktop: `(min-width: 1025px)`

### 4. Routing Fork: Conditional Rendering in App.jsx

**Decision:** Add `useDeviceType()` call in `App.jsx`. When `deviceType === 'phone'`, render a `<MobileLayout>` placeholder instead of the existing desktop layout. Tablet and desktop render the existing layout unchanged.

**Rationale:** Keeps the fork at the top level where routing decisions belong. The placeholder is a simple "Mobile experience coming soon" message — real mobile components replace it in the follow-up change. Desktop code path is completely untouched.

**The fork pattern:**
```
App.jsx
  const deviceType = useDeviceType()
  if (deviceType === 'phone') return <MobileLayout />
  return <existing desktop JSX>
```

## Risks / Trade-offs

**[Risk] Redirect flow loses in-memory state** → Mitigation: The existing `sessionStorage` deep-link preservation in `main.jsx` already handles this. Redirect login navigates away and back, but `handleRedirectPromise()` restores the MSAL session. App state rehydrates from sessionStorage and API calls.

**[Risk] Service worker caching stale assets after deploy** → Mitigation: `vite-plugin-pwa` uses content-hashed filenames by default. New deploys generate new hashes, and the service worker's precache manifest updates automatically. The `skipWaiting` + `clientsClaim` options ensure immediate activation.

**[Risk] PWA install prompt not shown on iOS** → Mitigation: iOS does not show automatic install banners. Users must manually tap Share -> Add to Home Screen. We can add a dismissible in-app prompt that detects iOS Safari standalone mode and guides users. This is a UX enhancement, not a blocker.

**[Risk] matchMedia breakpoints don't match CSS breakpoints** → Mitigation: The existing CSS uses 768px and 480px breakpoints. Our hook uses 480px and 1024px. This is intentional — the hook controls React component tree branching, not CSS styling. The two systems are independent and complementary.

**[Trade-off] sessionStorage vs localStorage for MSAL cache** → The existing `sessionStorage` config means PWA users must re-authenticate when they close and reopen the app. This is acceptable security behavior for a shared-device scenario (temple staff may share devices). If this becomes a friction point, switching to `localStorage` is a one-line change in `authConfig.js`.
