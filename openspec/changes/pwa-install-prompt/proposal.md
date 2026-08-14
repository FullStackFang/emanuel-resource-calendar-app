# Proposal: pwa-install-prompt

## Why

The app is already an installable PWA and has been for some time.
`vite.config.js` configures `VitePWA` with a complete manifest (`display:
standalone`, 192/512 icons, theme color) and `main.jsx` registers the service
worker with `registerType: 'autoUpdate'` plus a foreground update watcher. A
phone user *can* add it to their home screen today.

Nothing in the UI says so. Discovery depends entirely on the user knowing that
their browser's overflow menu hides an "Install" item — which, on iPhone, it
does not: Safari's only path is Share → Add to Home Screen, three taps deep in
a sheet most people scroll past. The result is a shipped capability with
approximately zero adoption.

The ask is a findable, permanent way to install, present on both platforms,
that never asks twice of someone who already has it.

## What Changes

- **A permanent `Install App` entry in the mobile avatar menu**
  (`MobileHeader`), alongside the existing `Switch to Desktop View` and
  `Sign Out`. This is the deliverable; everything else supports it. It never
  expires, is never dismissed away, and is present on every mobile browser.
- **One shared bottom sheet for every platform.** Same app mark, same title
  ("Install Temple Events"), same numbered-step layout, same two-button row.
  Only the step text and the primary button's label vary. Android does *not*
  bypass the sheet to fire the OS dialog directly — the matching look is worth
  the extra tap (design D3).
- **Four platform resolutions** behind that one sheet: a captured
  `beforeinstallprompt` (`prompt`), iOS Safari (`ios-safari`), iOS with a
  third-party browser that cannot install (`ios-other`), and everything else
  (`manual`). No browser reaches a dead end.
- **A single one-time nudge**: a banner above the tab bar, shown on the
  second signed-in session and never again once either button is pressed. No
  snooze windows, no dismissal counters, no recurrence.
- **Installed state is inferred, not guessed.** Running in `display-mode:
  standalone` hides everything. On Android, `appinstalled` sets a flag and
  `beforeinstallprompt` clears it, so the state self-heals after an uninstall.
  On iOS the flag is never set, because Safari genuinely cannot report it.

## Capabilities

### New Capabilities

- `pwa-install-affordance`: the permanent mobile install entry point, the
  shared platform-adaptive install sheet, the one-time nudge, and the
  installed-state detection that suppresses all of them.

### Modified Capabilities

None. `mobile-app-shell` gains a menu item, which the existing spec does not
enumerate; no documented requirement changes.

## Impact

- **Frontend only. Zero backend surface, no endpoint, no schema, no query
  key.** The manifest and service worker are consumed exactly as configured
  today; `vite.config.js` is not touched.
- **New**: `src/utils/pwaInstall.js` (pure detection + persistence),
  `src/hooks/usePwaInstall.js` (event capture + React state),
  `src/components/mobile/InstallAppSheet.jsx` / `.css`,
  `src/components/mobile/InstallAppNudge.jsx` / `.css`.
- **Modified**: `src/main.jsx` (module-scope `beforeinstallprompt` capture,
  ~4 lines beside the existing `vite:preloadError` handler);
  `src/components/mobile/MobileHeader.jsx` (menu item + props);
  `src/components/mobile/MobileApp.jsx` (owns the hook and both triggers).
- **Untouched**: desktop navigation, tablet (which renders the desktop UI),
  every calendar and reservation surface, MSAL, all backend code.
- **Tests**: new `pwaInstall.test.js`, `usePwaInstall.test.jsx`,
  `InstallAppSheet.test.jsx`, `InstallAppNudge.test.jsx`; extension of the
  existing `MobileHeader.test.jsx`.
- **Relationship to `mobile-app-store-publishing`**: that (unstarted) change
  packages native iOS/Android shells with Capacitor. It does not conflict, but
  when it lands, its shell must suppress this affordance — an app installed
  from a store must not offer to install itself. Recorded as a follow-up note
  in design.md rather than built speculatively here.
