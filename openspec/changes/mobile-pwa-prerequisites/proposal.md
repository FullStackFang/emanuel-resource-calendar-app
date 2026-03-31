## Why

Temple Emanuel staff and requesters want to access the calendar from their phones — browsing events, checking reservation status, and managing requests on the go. Currently, the app is desktop-only: MSAL authentication uses popup-only login which fails silently on mobile browsers (Safari and Chrome block popups by default), there is no "Add to Home Screen" capability, and no infrastructure to serve mobile-optimized views. This change adds the three prerequisites that unblock all future mobile work.

## What Changes

- **MSAL auth mobile fix**: Add popup-to-redirect fallback in `Authentication.jsx` and `handleRedirectPromise()` in the MSAL initialization so login works on mobile browsers. Detect mobile devices and go straight to redirect flow.
- **PWA setup**: Add `vite-plugin-pwa`, create `manifest.json` with Temple Emanuel branding, and configure a service worker for static asset caching. Users can "Add to Home Screen" on iOS/Android and get a full-screen app experience with no browser chrome.
- **Device detection hook**: Create `useDeviceType()` hook returning `'phone' | 'tablet' | 'desktop'` based on viewport width via `window.matchMedia`. Add a routing fork in `App.jsx` that renders a placeholder `MobileLayout` for phones (to be replaced by real mobile views in a follow-up change).

## Capabilities

### New Capabilities
- `pwa-support`: Progressive Web App configuration — manifest, service worker, installability, asset caching
- `mobile-auth`: MSAL authentication flow that works on mobile browsers via redirect fallback
- `device-detection`: Viewport-based device type detection and layout routing infrastructure

### Modified Capabilities

None. All changes are additive. Existing desktop behavior is unchanged.

## Impact

- **Frontend dependencies**: Adds `vite-plugin-pwa` to devDependencies
- **Vite config**: PWA plugin registration in `vite.config.js`
- **Auth flow**: `src/components/Authentication.jsx` and `src/main.jsx` gain redirect handling (existing popup flow preserved for desktop)
- **App routing**: `src/App.jsx` gains device-type conditional rendering (desktop path unchanged)
- **New files**: `useDeviceType.js` hook, `MobileLayout.jsx` placeholder component, PWA icons in `public/`
- **Backend**: No changes
- **Deployment**: Service worker added to Azure Web Apps output — no infra changes needed
