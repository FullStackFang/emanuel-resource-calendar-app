# Spec: pwa-install-affordance

## ADDED Requirements

### Requirement: A permanent install entry lives in the mobile avatar menu

The mobile header's avatar menu SHALL contain an `Install App` entry,
alongside the existing `Switch to Desktop View` and `Sign Out` entries. The
entry SHALL be present on every mobile browser regardless of whether a
programmatic install is possible, SHALL never be dismissable, and SHALL NOT
expire, so that a user who declines the nudge or arrives long afterwards can
still find it.

The entry SHALL be hidden only when the app is determined to be installed, per
the installed-state requirement below.

#### Scenario: Entry present on a browser that can install

- **WHEN** a signed-in phone user on Android Chrome opens the avatar menu
- **THEN** an `Install App` entry is shown

#### Scenario: Entry present on a browser that cannot install

- **WHEN** a signed-in phone user on Chrome for iPhone opens the avatar menu
- **THEN** an `Install App` entry is still shown

#### Scenario: Entry survives nudge dismissal

- **WHEN** a user dismisses the one-time nudge and later opens the avatar menu
- **THEN** the `Install App` entry is still present

#### Scenario: Entry absent when running installed

- **WHEN** the app is launched from the home screen in standalone display mode
- **THEN** no `Install App` entry is rendered

### Requirement: One install sheet is shared by every platform

Activating the install entry SHALL open a single bottom sheet component whose
chrome is identical on every platform: the same app mark, the title
`Install Temple Events`, numbered step pills, and a two-button row of a
secondary dismiss and a primary action. Only the subtitle, the step text, and
the primary button's label SHALL vary by platform.

The sheet SHALL resolve one of four platforms and SHALL NOT leave any browser
without instructions:

| platform | condition | primary action |
|---|---|---|
| `prompt` | a `beforeinstallprompt` event has been captured | fires the browser's install dialog |
| `ios-safari` | iOS, no third-party browser marker in the user agent | dismisses |
| `ios-other` | iOS with `CriOS`, `FxiOS`, `EdgiOS`, or `OPiOS` | copies the page link |
| `manual` | anything else | dismisses |

Platform resolution SHALL check for a captured install event *before*
consulting the user agent, so that a browser which can genuinely install
always receives the real dialog irrespective of what its user agent claims.

iOS detection SHALL include iPadOS 13+, which reports as a Mac
(`navigator.platform === 'MacIntel'` with `navigator.maxTouchPoints > 1`).

#### Scenario: Android shows the shared sheet, not the OS dialog directly

- **WHEN** a user on Android Chrome activates the install entry
- **THEN** the shared sheet opens with the `prompt` content, and the browser's
  own install dialog is not shown until the sheet's primary button is pressed

#### Scenario: Android sheet hands off to the browser

- **WHEN** the user presses the sheet's primary `Install` button on Android
- **THEN** the captured install event is prompted and the browser's install
  dialog appears

#### Scenario: iPhone Safari receives instructions

- **WHEN** a user on Safari for iPhone activates the install entry
- **THEN** the sheet opens with steps directing them to Share → Add to Home
  Screen → Add, and no install event is prompted

#### Scenario: iPhone third-party browser is told what is possible

- **WHEN** a user on Chrome for iPhone activates the install entry
- **THEN** the sheet explains that Safari is required on iPhone and offers to
  copy the page link

#### Scenario: Unknown browser still gets guidance

- **WHEN** a user on a browser matching none of the specific cases activates
  the install entry
- **THEN** the sheet opens with generic browser-menu instructions rather than
  an empty state or an error

#### Scenario: Capability outranks the user agent

- **WHEN** an install event has been captured on a browser whose user agent
  contains an iOS third-party marker
- **THEN** the platform resolves to `prompt` and the primary button prompts
  the install event

### Requirement: The install event is captured before React mounts

The `beforeinstallprompt` handler SHALL be registered at module scope during
application bootstrap, before React renders, and SHALL store the event for
later retrieval. A handler registered only from a component effect would miss
the event, because browsers dispatch it during initial page load.

The stored event SHALL be prompted synchronously from the user's gesture with
no intervening `await`, since awaiting before `prompt()` voids the gesture and
suppresses the dialog. The event SHALL be treated as single-use and cleared
after prompting; a subsequently dispatched event SHALL replace it.

A user choice of `dismissed` SHALL NOT record any state, so the install entry
remains available.

#### Scenario: Event dispatched before mount is still usable

- **WHEN** `beforeinstallprompt` is dispatched before the mobile shell mounts
- **THEN** the install entry reports that a programmatic install is available

#### Scenario: Event dispatched after mount is picked up

- **WHEN** `beforeinstallprompt` is dispatched after the mobile shell has
  mounted
- **THEN** the install entry reports that a programmatic install is available

#### Scenario: The event is consumed once

- **WHEN** the install event has been prompted and no new event has been
  dispatched
- **THEN** a further activation does not prompt the same event again

#### Scenario: Declining leaves the entry available

- **WHEN** the user dismisses the browser's install dialog
- **THEN** no installed state is recorded and the install entry remains in the
  menu

### Requirement: Installed state is detected and self-heals

The affordance SHALL be suppressed entirely when the app is determined to be
installed, determined in this order:

1. the page is running in standalone display mode — `display-mode: standalone`
   or the legacy `navigator.standalone` — which SHALL be treated as installed;
2. a persisted installed flag is set;
3. otherwise, not installed.

The persisted flag SHALL be maintained from the browser's own signals rather
than by expiry: `appinstalled` SHALL set it, and `beforeinstallprompt` SHALL
clear it. Because a browser only dispatches `beforeinstallprompt` for an
origin that is not currently installed, this restores the affordance after an
uninstall without any timer or version check.

On platforms that dispatch neither event, the flag SHALL never be set and the
affordance SHALL remain available, since an existing installation cannot be
detected there.

#### Scenario: Launching from the home screen suppresses everything

- **WHEN** the app runs in standalone display mode
- **THEN** neither the install entry nor the nudge is rendered

#### Scenario: Legacy iOS standalone signal is honoured

- **WHEN** the app runs with `navigator.standalone` true and no `display-mode`
  match
- **THEN** neither the install entry nor the nudge is rendered

#### Scenario: Completing an install hides the affordance

- **WHEN** the browser dispatches `appinstalled`
- **THEN** the install entry is no longer rendered

#### Scenario: Uninstalling restores the affordance

- **WHEN** the installed flag is set and the browser subsequently dispatches
  `beforeinstallprompt`
- **THEN** the flag is cleared and the install entry is rendered again

#### Scenario: iOS keeps the entry because it cannot know

- **WHEN** a user browses in Safari for iPhone having previously added the app
  to their home screen
- **THEN** the install entry is still shown, because no signal distinguishes
  this from a user who has not installed it

### Requirement: A single nudge is shown once per device and never returns

A nudge banner SHALL be rendered above the mobile tab bar when, and only when,
all of the following hold: the affordance is available, the user is
authenticated, this is at least their second signed-in session, and no nudge
has previously been retired on this device.

Activating either of the nudge's buttons — dismiss or install — SHALL retire
the nudge permanently on that device. There SHALL be no snooze interval, no
dismissal counter, and no second showing.

The session count SHALL increment at most once per browsing session and only
while authenticated, so that a page refresh does not advance it and an
unauthenticated visitor never does.

#### Scenario: Not shown on the first session

- **WHEN** an authenticated phone user is in their first signed-in session
- **THEN** no nudge is rendered

#### Scenario: Shown on the second session

- **WHEN** an authenticated phone user begins their second signed-in session
  and no nudge has been retired
- **THEN** the nudge is rendered

#### Scenario: Dismissing retires it permanently

- **WHEN** the user dismisses the nudge and later begins a further session
- **THEN** no nudge is rendered

#### Scenario: Installing from the nudge retires it permanently

- **WHEN** the user presses the nudge's install button and later begins a
  further session
- **THEN** no nudge is rendered

#### Scenario: Refreshing does not advance the count

- **WHEN** an authenticated user reloads the page during their first session
- **THEN** the session count is unchanged and no nudge is rendered

#### Scenario: Unauthenticated visits never count

- **WHEN** an unauthenticated visitor loads the app repeatedly
- **THEN** the session count is unchanged and no nudge is rendered

### Requirement: Storage failure degrades toward the permanent entry

All persisted-state reads and writes SHALL tolerate a storage backend that
throws, as happens in private browsing and under quota pressure. When
persisted state cannot be read or written, the affordance SHALL degrade
asymmetrically: the install entry SHALL be shown, and the nudge SHALL NOT be
shown.

A storage failure SHALL therefore never remove the only route to installing,
and SHALL never convert the one-time nudge into a banner that reappears every
session.

#### Scenario: Entry survives unreadable storage

- **WHEN** reading persisted state throws
- **THEN** the install entry is rendered

#### Scenario: Nudge suppressed under unreadable storage

- **WHEN** reading persisted state throws
- **THEN** no nudge is rendered

#### Scenario: Retiring the nudge tolerates unwritable storage

- **WHEN** the user dismisses the nudge and writing persisted state throws
- **THEN** the dismissal is honoured for the remainder of the session and no
  error surfaces to the user

### Requirement: The affordance is scoped to the mobile shell

The install entry, nudge, and sheet SHALL render only within the mobile
application shell. Desktop navigation SHALL be unchanged, and tablets — which
render the desktop interface — SHALL NOT receive the affordance.

Because the sheet only ever mounts on phones, its iOS instructions MAY assume
the phone placement of Safari's Share control.

#### Scenario: Desktop is untouched

- **WHEN** a user loads the app on a desktop viewport
- **THEN** no install entry, nudge, or sheet is rendered
