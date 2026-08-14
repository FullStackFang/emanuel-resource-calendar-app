# Tasks: pwa-install-prompt

Verification-first per CLAUDE.md: each implementation task is preceded by the
test that fails without it.

**Baseline first.** Main is red (10 frontend failures / 3 files). Before
starting, record the baseline with `npm run test:run` so the final comparison
is against a measured number, not the one written down here.

## 1. Pure detection and persistence

- [x] 1.1 Write `src/__tests__/unit/utils/pwaInstall.test.js`: standalone
      detection via `display-mode: standalone` and via legacy
      `navigator.standalone`; the platform resolution table (`prompt`,
      `ios-safari`, `ios-other` for `CriOS`/`FxiOS`/`EdgiOS`/`OPiOS`,
      `manual`); iPadOS 13+ `MacIntel` + `maxTouchPoints > 1` resolving as
      iOS; **a captured event resolving to `prompt` even when the UA carries
      an iOS third-party marker** (capability outranks UA); the
      `shouldShowNudge` truth table; and storage-throws degrading to
      entry-shown / nudge-hidden
- [x] 1.2 Create `src/utils/pwaInstall.js` exporting `isRunningStandalone()`,
      `detectPlatform({ hasDeferredPrompt, userAgent, platform,
      maxTouchPoints })`, `shouldShowNudge({ isAvailable, isAuthenticated,
      visitCount, nudgeDone })`, `recordVisit()`, `retireNudge()`,
      `readInstalledFlag()` / `setInstalledFlag()` / `clearInstalledFlag()`.
      Every storage access wrapped; no React import. Run 1.1 until green

## 2. Event capture and the hook

- [x] 2.1 Write `src/__tests__/unit/hooks/usePwaInstall.test.jsx`: **an event
      dispatched before mount is still reported as available** (the primary
      regression guard for D2); an event dispatched after mount is picked up;
      `appinstalled` sets the flag and drops `isAvailable`;
      `beforeinstallprompt` clears a pre-existing installed flag (D6
      self-heal); `promptInstall` calls `prompt()` and clears the slot so a
      second call does not re-prompt; a `dismissed` outcome records nothing
- [x] 2.2 Add `initInstallCapture()` to `src/utils/pwaInstall.js` — it owns the
      module-scoped event slot, registers the `beforeinstallprompt` listener
      (`preventDefault()`, store the event, clear the installed flag) and the
      `appinstalled` listener (set the flag), and exposes
      `getDeferredPrompt()`, `consumeDeferredPrompt()`, and
      `subscribeToInstallState(cb)`. Call it once at module scope from
      `src/main.jsx`, beside the existing `vite:preloadError` handler, so
      `main.jsx` gains a single import and a single call and all the logic
      stays unit-testable
- [x] 2.3 Create `src/hooks/usePwaInstall.js` returning `{ isAvailable,
      canPrompt, platform, promptInstall }`. `promptInstall` calls
      `event.prompt()` with **no preceding `await`** (D10), then awaits
      `userChoice`. Run 2.1 until green

## 3. The shared sheet

- [x] 3.1 Write `src/__tests__/unit/components/mobile/InstallAppSheet.test.jsx`:
      each of the four platforms renders its own subtitle, steps, and primary
      label; the title `Install Temple Events`, the app mark, and the
      two-button row are identical across all four (assert the shared chrome
      explicitly, so a future per-platform divergence fails a test); the
      `prompt` primary calls `promptInstall`; the `ios-other` primary writes
      the page URL to the clipboard; dismiss closes without side effects
- [x] 3.2 Create `src/components/mobile/InstallAppSheet.jsx` + `.css` per the
      rev-2 mockup — scrim, grabber, 44px app mark, numbered step pills, ghost
      + primary row. Use `--font-semibold` / `--font-medium`, **not** the
      undefined `--weight-*` names. Scope every class under a component root
      per the global modal CSS leak hazard. Run 3.1 until green

## 4. The one-time nudge

- [x] 4.1 Write `src/__tests__/unit/components/mobile/InstallAppNudge.test.jsx`:
      hidden on session 1, shown on session 2 when authenticated and not
      retired; either button retires it so a subsequent session shows nothing;
      hidden when unauthenticated; hidden when storage reads throw
- [x] 4.2 Create `src/components/mobile/InstallAppNudge.jsx` + `.css`,
      positioned above the tab bar without covering agenda content. Run 4.1
      until green

## 5. Wiring

- [x] 5.1 Extend `src/__tests__/unit/components/mobile/MobileHeader.test.jsx`:
      the `Install App` entry renders when available and is absent when not;
      activating it invokes the passed handler
- [x] 5.2 Add the entry to `src/components/mobile/MobileHeader.jsx` behind new
      `showInstall` / `onInstall` props, matching the existing menu-item
      markup; close the menu on activation
- [x] 5.3 Wire `src/components/mobile/MobileApp.jsx` as the single owner (D9):
      hold `usePwaInstall()` and the sheet's open state, pass `showInstall` /
      `onInstall` to the header, render the nudge and the sheet. Run 5.1 until
      green
- [x] 5.4 Increment the visit count once per session from the mobile shell,
      guarded by `sessionStorage`, only while authenticated

## 6. Verification

- [x] 6.1 Run the four new suites plus `MobileHeader.test.jsx` green
- [x] 6.2 Run the full frontend suite and confirm the failure count and file
      list are identical to the baseline recorded above; if they differ,
      measure with `git stash push -u` → run → `git stash pop` → run before
      concluding anything
- [x] 6.3 Mutation-check the two load-bearing behaviours: removing the
      module-scope capture in `main.jsx` MUST fail the before-mount case in
      2.1; removing the `clearInstalledFlag()` call from the
      `beforeinstallprompt` handler MUST fail the self-heal case in 2.1
- [x] 6.4 `npm run lint` — confirm no new warnings on touched files
- [ ] 6.5 **Manual, on real devices** (cannot be faked in jsdom): on an Android
      phone, install through the sheet end to end and confirm the entry
      disappears afterwards, then uninstall and confirm it returns; on an
      iPhone, confirm the Safari sheet's steps match what Safari actually
      shows and that launching from the home screen hides the entry and the
      nudge; confirm the nudge appears on the second signed-in session and
      never again
