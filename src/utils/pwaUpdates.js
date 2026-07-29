// src/utils/pwaUpdates.js
//
// Makes the installed PWA notice that a new version was deployed.
//
// The browser only looks for a new service worker on a navigation. An app
// launched from the home screen in standalone display mode usually *resumes*
// its existing page rather than navigating, and that shell has no URL bar and
// no reload button — so for many users the check never ran at all and they
// stayed on whatever bundle they first installed.
//
// This supplies the missing trigger. registerSW() in main.jsx supplies the
// other half: with registerType: 'autoUpdate' it reloads the page once the
// new worker activates.

/**
 * Minimum gap between checks. A phone foregrounds an app dozens of times a
 * day and every check is a network fetch of sw.js; 15 minutes still picks up
 * a deploy within one sitting without making the traffic noticeable.
 */
export const FOREGROUND_UPDATE_THROTTLE_MS = 15 * 60 * 1000;

/**
 * Ask the service worker to look for an update whenever the app comes back to
 * the foreground.
 *
 * @param {ServiceWorkerRegistration|undefined} registration
 *        as handed to registerSW's onRegisteredSW; undefined if registration failed
 * @param {Document} [doc]
 * @returns {() => void} removes the listener
 */
export function watchForServiceWorkerUpdates(registration, doc = document) {
  if (!registration) return () => {};

  // Registration has just run its own check, so start the clock rather than
  // firing again on the first foreground.
  let lastCheckedAt = Date.now();

  const check = () => {
    if (doc.visibilityState !== 'visible') return;

    const now = Date.now();
    if (now - lastCheckedAt < FOREGROUND_UPDATE_THROTTLE_MS) return;
    lastCheckedAt = now;

    // A resume is exactly when the network is least likely to be back yet.
    // A failed check is not worth reporting — the next foreground retries.
    Promise.resolve(registration.update?.()).catch(() => {});
  };

  doc.addEventListener('visibilitychange', check);
  return () => doc.removeEventListener('visibilitychange', check);
}
