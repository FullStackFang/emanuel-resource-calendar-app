# Design: pwa-install-prompt

Approved mockup: `public/mockups/install-app-prompt.html` (rev 2, reviewed
2026-08-14) — seven panels covering the menu entry, the nudge, and all four
sheet variants plus the Android OS handoff, built on the real design tokens.

## Context

The PWA foundation already exists and is not in scope:

- `vite.config.js` — `VitePWA({ registerType: 'autoUpdate', manifest: {...} })`
  with `display: 'standalone'`, `/icon-192.png`, `/icon-512.png`.
- `main.jsx` — `registerSW({ immediate: true })` plus
  `watchForServiceWorkerUpdates` for foreground update checks.

What is missing is only the affordance. This change adds no PWA plumbing.

## The platform asymmetry

Everything here follows from one fact:

| | Android / Chromium | iOS Safari |
|---|---|---|
| Install API | `beforeinstallprompt` → `prompt()` | none |
| Fires when already installed? | **no** | n/a |
| Can page detect an existing install? | yes, via events | **no** |
| Install path | one OS dialog | Share → Add to Home Screen, by hand |

The middle row is the useful one: on Android the *absence* of
`beforeinstallprompt` is itself evidence of installation, so detection is
exact and free. On iOS there is no equivalent signal, and none can be
synthesised — Safari deliberately does not expose home-screen contents.

Consequence, accepted rather than worked around: **on iOS the menu entry is
always shown while browsing.** We cannot know it is redundant. Per the product
call, findable beats clever.

## Decisions

### D1 — The permanent menu entry is the feature; the nudge is secondary

The original request was a popup. It resolved, on discussion, to "as long as
there's a clear option to install that you can open when on mobile, the prompt
doesn't matter as much."

So the menu entry is unconditional, un-dismissable, and never expires. The
nudge exists only to drive discovery of it, fires at most once per device, and
is the first thing sacrificed under failure (see D7).

The entry belongs in the `MobileHeader` avatar menu because that menu is
already the home of **device-scoped, non-calendar actions**: `Switch to
Desktop View` writes a `localStorage` layout preference and is about *this
phone*, not about temple data. "Install App" is the same category. A bottom
tab would mix a one-time device setup action into content navigation.

### D2 — `beforeinstallprompt` is captured at module scope in `main.jsx`

Chrome dispatches `beforeinstallprompt` during initial page load, typically
before `ReactDOM.createRoot()` completes and always before a `useEffect`
inside the lazily-loaded mobile tree runs. A hook that only subscribes on
mount misses it — and misses it *only in production*, because dev hot-reload
re-fires listeners after mount. This is the single most likely way for the
feature to ship broken.

The listener is therefore registered at module scope during bootstrap, beside
the existing `vite:preloadError` handler, storing the event in a module-scoped
slot. `usePwaInstall` reads the slot on mount and subscribes for later
firings. This mirrors the deep-link capture already at the top of `main.jsx`,
which exists for exactly the same "must run before React" reason.

The slot and both listeners live in `pwaInstall.js` behind
`initInstallCapture()`, which `main.jsx` calls once. `main.jsx` gains an import
and a call; every branch stays unit-testable without loading the app entry
point.

Rejected: subscribing inside the hook only (misses the event); a global
`window.__deferredPrompt` (untestable, and invisible to module mocking);
putting the listener bodies directly in `main.jsx` (they would only be
reachable through an integration test of bootstrap).

### D3 — Android opens our sheet too, rather than firing the OS dialog directly

The technically optimal Android flow is: tap menu entry → `prompt()` → Chrome's
dialog. It has one fewer step and lets a recognised native dialog do the work.

We are not doing that. The product requirement is that iPhone and Android look
the same, and a flow that shows a styled sheet on one platform and nothing on
the other does not. Android therefore opens the same sheet, whose primary
button calls `promptInstall()`.

Costs, stated plainly: one extra tap on Android, and some install conversion
with it. Accepted because the audience is a small set of temple staff who
support each other in person, where one describable flow ("tap Install App,
then Install") beats two shorter divergent ones.

The handoff remains honest: the Android sheet's step 2 reads "Confirm in your
phone's dialog", so Chrome's dialog arrives as an announced step rather than a
surprise. Chrome's dialog is the one screen in the flow that cannot be made to
match, and no attempt is made to reimplement it.

### D4 — One sheet, four contents

`InstallAppSheet` renders identical chrome in every case — grabber, 44px app
mark, title "Install Temple Events", numbered step pills, ghost + primary
button row. The platform varies only:

| `platform` | subtitle | steps | primary |
|---|---|---|---|
| `prompt` | Two taps | tap Install → confirm in phone's dialog | Install |
| `ios-safari` | Three taps in Safari | Share → Add to Home Screen → Add | Got it |
| `ios-other` | Safari required on iPhone | Copy link → open Safari → Share → Add | Copy link |
| `manual` | From your browser menu | open ⋮ menu → Install / Add to Home screen | Got it |

The iOS Safari step 1 renders the Share glyph inline so users match it against
the toolbar icon they are hunting for. "in the bar below" is accurate because
this component only ever mounts on phones — `useDeviceType` classifies
≤480px as `phone`, and tablets render the desktop UI, so the iPad case (Share
in the top bar) cannot arise.

Rejected: per-platform icons (rev 1 used a globe for `ios-other` and a ⋮ glyph
for `manual`) — they made one feature read as four unrelated screens.

### D5 — Platform resolution order

```
deferred prompt event present     → 'prompt'
iOS and no third-party UA marker  → 'ios-safari'
iOS and CriOS|FxiOS|EdgiOS|OPiOS  → 'ios-other'
otherwise                         → 'manual'
```

iOS detection covers iPadOS 13+, which reports as a Mac:
`/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' &&
navigator.maxTouchPoints > 1)`.

The deferred event is checked *first*, so a Chromium browser that can really
install always gets the real dialog regardless of what its UA says. UA
sniffing only decides which set of instructions to print — it never gates
capability. That ordering is what keeps the UA table from becoming a
correctness dependency as browsers change.

Known imprecision, accepted: iOS 17.4+ in the EU permits alternative engines,
so a `CriOS` build could in principle install. Such a browser would fire
`beforeinstallprompt` and resolve to `prompt` before the UA branch is reached.
If it does not, the `ios-other` advice ("open in Safari") is harmless.

### D6 — Installed state self-heals

```
running in display-mode: standalone (or navigator.standalone)  → installed
localStorage installed flag set                                → installed
otherwise                                                      → show entry
```

A persisted "they installed it" flag normally rots: uninstall the app and the
entry stays hidden forever with no route back. The fix falls out of what the
events mean rather than from an expiry heuristic:

- `beforeinstallprompt` firing is the browser stating *this origin is not
  currently installed* — receiving it **clears** the flag.
- `appinstalled` **sets** it.

Uninstall on Android and the next load fires `beforeinstallprompt`, wiping the
stale flag and restoring the entry. No timers, no versioning.

On iOS neither event ever fires, so the flag is never set and Safari always
shows the entry — the honest outcome per the asymmetry above.

`display-mode: standalone` covers Android and iOS 16.4+; `navigator.standalone`
covers older iOS. Both are checked.

### D7 — Storage failure degrades toward the permanent entry

`localStorage` throws in iOS private browsing and under quota pressure. Every
read and write is wrapped, and the degraded default is deliberate and
asymmetric:

- **menu entry: shown** (assume not installed)
- **nudge: never shown** (cannot prove it hasn't already been seen)

The entry is the feature; the nudge is expendable. A storage failure must
never remove the only way to install, and must never turn the one-time nudge
into a nag that reappears every session.

### D8 — The nudge's eligibility is one pure predicate

```js
shouldShowNudge = isAvailable && isAuthenticated && visitCount >= 2 && !nudgeDone
```

No timers and no scheduling. `visitCount` increments once per browsing session
and only while signed in (a `sessionStorage` guard stops a refresh counting),
so "visit 2" means the second genuine signed-in session — matching the product
call to skip one-time guests following a public reservation link. Either nudge
button sets `nudgeDone` permanently.

### D9 — `MobileApp` is the single owner

Two triggers (menu entry, nudge) resolve to one action, and under D3 that
action is the same on every platform — open the sheet:

```js
const handleInstall = () => setSheetOpen(true);
```

`promptInstall()` is called by the *sheet's* primary button, not by
`handleInstall`. `canPrompt` is what the sheet branches on to choose its
content and wire that button; nothing upstream of the sheet branches on
platform at all. This is the whole mechanism by which the platforms look
identical: there is exactly one decision point, and it is inside the sheet.

`MobileApp` holds `usePwaInstall()` and the sheet's open state, passes
`onInstall` / `showInstall` to `MobileHeader`, and renders the nudge and
sheet. No context, no prop drilling deeper than one level.

`usePwaInstall()` returns `{ isAvailable, canPrompt, platform, promptInstall }`
and hides every platform detail behind that surface.

### D10 — `promptInstall` must not await before `prompt()`

Browsers require `prompt()` inside the user-gesture window; an intervening
`await` silently voids it and the dialog never appears. `promptInstall` calls
`event.prompt()` synchronously and only then awaits `userChoice`.

The event is single-use: after `prompt()` the slot is cleared. Chrome re-fires
a fresh event later if the user declined, which the subscription picks up. An
outcome of `dismissed` writes nothing — the user may install later, and there
is no reason to suppress the entry.

## Follow-up notes (not built here)

- **Capacitor**: when `mobile-app-store-publishing` lands, its native shell
  must suppress this affordance — a store-installed app offering to install
  itself is a bug. The guard is a `window.Capacitor` check inside
  `isRunningStandalone()`. Not built now: Capacitor is not a dependency, and a
  guard against a package that does not exist cannot be tested.
- **`--weight-*` token bug** (pre-existing, out of scope): `MobileHeader.css`
  uses `--weight-semibold` / `--weight-medium`, which are undefined — the real
  tokens are `--font-semibold` / `--font-medium` (`design-tokens.css:155-159`).
  Those declarations resolve to nothing and render at 400. ~47 usages exist
  repo-wide. New CSS in this change uses the correct names; the existing
  usages are left alone as an unrelated fix.
