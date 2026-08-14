// src/utils/pwaInstall.js
//
// Everything the install affordance knows about the platform and the device,
// with no React in sight. Two reasons it lives here rather than in the hook:
//
//   1. `beforeinstallprompt` is dispatched during initial page load — before
//      React mounts, and always before an effect inside the lazily-imported
//      mobile tree can run. The listener has to be registered at module scope
//      during bootstrap (see initInstallCapture, called once from main.jsx).
//   2. Keeping the branches pure makes every platform reachable in a unit test
//      without loading the app entry point.
//
// Persistence degrades ASYMMETRICALLY when localStorage throws (private
// browsing, quota pressure): the permanent menu entry is shown, the one-time
// nudge is not. A storage failure must never remove the only route to
// installing, and must never turn a once-ever banner into a nag.

export const INSTALLED_FLAG_KEY = 'templeEvents:pwaInstalled';
export const NUDGE_DONE_KEY = 'templeEvents:pwaNudgeRetired';
export const VISIT_COUNT_KEY = 'templeEvents:pwaVisitCount';
export const VISIT_SESSION_KEY = 'templeEvents:pwaVisitCounted';

/** Browsers on iOS that are Safari in a costume and genuinely cannot install. */
const IOS_THIRD_PARTY = /CriOS|FxiOS|EdgiOS|OPiOS/;

/**
 * Is this page running as an installed app rather than in a browser tab?
 * `display-mode: standalone` covers Android and iOS 16.4+; the legacy
 * `navigator.standalone` covers older iOS.
 */
export function isRunningStandalone() {
  try {
    if (window.matchMedia?.('(display-mode: standalone)')?.matches) return true;
  } catch {
    // matchMedia unavailable — fall through to the legacy signal.
  }
  return window.navigator?.standalone === true;
}

/**
 * Which set of install instructions applies.
 *
 * The captured event is checked FIRST, deliberately: a browser that can really
 * install always gets the real dialog regardless of what its user agent claims.
 * The UA only decides which words to print — it never gates capability, which
 * is what keeps this table from becoming a correctness dependency as browsers
 * change.
 *
 * @returns {'prompt' | 'ios-safari' | 'ios-other' | 'manual'}
 */
export function detectPlatform({
  hasDeferredPrompt = false,
  userAgent,
  platform,
  maxTouchPoints,
} = {}) {
  if (hasDeferredPrompt) return 'prompt';

  const ua = userAgent ?? window.navigator?.userAgent ?? '';
  const plat = platform ?? window.navigator?.platform ?? '';
  const touchPoints = maxTouchPoints ?? window.navigator?.maxTouchPoints ?? 0;

  // iPadOS 13+ reports itself as a Mac; touch points are the only tell.
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) || (plat === 'MacIntel' && touchPoints > 1);

  if (!isIOS) return 'manual';
  return IOS_THIRD_PARTY.test(ua) ? 'ios-other' : 'ios-safari';
}

/** The nudge's entire eligibility rule. No timers, no scheduling. */
export function shouldShowNudge({
  isAvailable,
  isAuthenticated,
  visitCount,
  nudgeDone,
}) {
  return Boolean(isAvailable && isAuthenticated && visitCount >= 2 && !nudgeDone);
}

function readFlag(key, fallback) {
  try {
    return window.localStorage.getItem(key) === 'true';
  } catch {
    return fallback;
  }
}

function writeFlag(key, value) {
  try {
    if (value) window.localStorage.setItem(key, 'true');
    else window.localStorage.removeItem(key);
  } catch {
    // Unwritable storage: the current session still behaves correctly, the
    // choice just won't survive a reload.
  }
}

/** Unreadable storage reads as NOT installed, so the entry stays reachable. */
export function readInstalledFlag() {
  return readFlag(INSTALLED_FLAG_KEY, false);
}

export function setInstalledFlag() {
  writeFlag(INSTALLED_FLAG_KEY, true);
}

export function clearInstalledFlag() {
  writeFlag(INSTALLED_FLAG_KEY, false);
}

/** Unreadable storage reads as ALREADY retired, so the nudge stays hidden. */
export function readNudgeDone() {
  return readFlag(NUDGE_DONE_KEY, true);
}

export function retireNudge() {
  writeFlag(NUDGE_DONE_KEY, true);
}

export function readVisitCount() {
  try {
    const parsed = parseInt(window.localStorage.getItem(VISIT_COUNT_KEY), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

/**
 * Count this browsing session, at most once. The sessionStorage guard is what
 * makes "visit 2" mean a second genuine session rather than a second page load.
 * Callers are responsible for only calling it while signed in.
 *
 * @returns {number} the visit count after this call
 */
export function recordVisit() {
  let alreadyCounted;
  try {
    alreadyCounted = window.sessionStorage.getItem(VISIT_SESSION_KEY) === 'true';
  } catch {
    // Without the guard a refresh would inflate the count, so decline to count
    // at all — the nudge is the expendable half of this feature.
    alreadyCounted = true;
  }
  if (alreadyCounted) return readVisitCount();

  const next = readVisitCount() + 1;
  try {
    window.localStorage.setItem(VISIT_COUNT_KEY, String(next));
  } catch {
    // ignored — see writeFlag
  }
  try {
    window.sessionStorage.setItem(VISIT_SESSION_KEY, 'true');
  } catch {
    // ignored
  }
  return next;
}

// ---------------------------------------------------------------------------
// Bootstrap-time event capture
//
// Registered from main.jsx at module scope, beside the vite:preloadError
// handler, for the reason at the top of this file: the event arrives before
// React does. usePwaInstall reads the slot on mount and subscribes for later
// firings.
// ---------------------------------------------------------------------------

/** The most recent BeforeInstallPromptEvent, or null. Single-use. */
let deferredPrompt = null;
let captureInitialized = false;
const subscribers = new Set();

function notifySubscribers() {
  subscribers.forEach((callback) => {
    try {
      callback();
    } catch {
      // One bad subscriber must not stop the others being told.
    }
  });
}

function handleBeforeInstallPrompt(event) {
  // Suppress Chrome's own mini-infobar; the affordance is ours to place.
  event.preventDefault();
  deferredPrompt = event;
  // The browser only fires this for an origin that is NOT currently installed,
  // so receiving it retires any stale installed flag (D6). This is what makes
  // an uninstall restore the menu entry without an expiry heuristic.
  clearInstalledFlag();
  notifySubscribers();
}

function handleAppInstalled() {
  deferredPrompt = null;
  setInstalledFlag();
  notifySubscribers();
}

/** Idempotent. Called once from main.jsx during bootstrap. */
export function initInstallCapture() {
  if (captureInitialized) return;
  captureInitialized = true;
  window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  window.addEventListener('appinstalled', handleAppInstalled);
}

export function getDeferredPrompt() {
  return deferredPrompt;
}

/** Takes the event out of the slot — it may only be prompted once. */
export function consumeDeferredPrompt() {
  const event = deferredPrompt;
  deferredPrompt = null;
  if (event) notifySubscribers();
  return event;
}

/** @returns {() => void} unsubscribe */
export function subscribeToInstallState(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function __resetInstallCaptureForTests() {
  window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  window.removeEventListener('appinstalled', handleAppInstalled);
  captureInitialized = false;
  deferredPrompt = null;
  subscribers.clear();
}
