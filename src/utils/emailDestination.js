// src/utils/emailDestination.js
//
// Where an emailed link asks the app to go, and how that survives sign-in.
//
// WHY A QUERY PARAM AND NOT A PATH: the public URL in our emails
// (https://emanuelnyc.org/scheduler) is a vanity 301 REDIRECT to the app
// origin, not a sub-path mount. Measured 2026-09-03 it forwards the query
// string and 404s on any deeper path, so '/scheduler/my-assignments' dies at
// the vanity domain and never reaches us. See backend/utils/eventDeepLink.js,
// which builds the links and carries the same warning.
//
// WHY SESSIONSTORAGE: MSAL's loginRedirect navigates to Azure AD and returns to
// window.location.origin, discarding the query string. The capture therefore
// runs at module scope in main.jsx (before MSAL initializes) and parks the
// destination here; App.jsx consumes it once authentication resolves.
//
// The stored value arrives from an email and is UNTRUSTED. It is resolved
// through the allow-list below and is never used as a route path — otherwise
// '?view=' would be an arbitrary-navigation primitive.

export const EMAIL_DESTINATION_PARAM = 'view';
export const EMAIL_DESTINATION_STORAGE_KEY = 'deepLinkView';

// Map, not an object literal: a bare object would resolve inherited keys like
// '__proto__' or 'constructor' and hand back something that is not a route.
const DESTINATIONS = new Map([
  ['my-assignments', '/my-assignments'],
]);

/**
 * Resolve an emailed destination token to an in-app route.
 * @returns {string|null} the route, or null for anything not allow-listed
 */
export function resolveEmailDestination(value) {
  if (typeof value !== 'string') return null;
  return DESTINATIONS.get(value) || null;
}

/**
 * Capture the destination BEFORE MSAL can strip the query string.
 * Must be called at module scope — an effect runs far too late.
 * Only allow-listed values are stored, so nothing else can ever be read back.
 */
export function captureEmailDestination(search) {
  try {
    const params = new URLSearchParams(
      typeof search === 'string' ? search : window.location.search
    );
    const value = params.get(EMAIL_DESTINATION_PARAM);
    if (resolveEmailDestination(value)) {
      sessionStorage.setItem(EMAIL_DESTINATION_STORAGE_KEY, value);
    }
  } catch {
    // Storage unavailable (private mode, blocked site data). The link still
    // works for an already-signed-in visitor, whose URL is read directly; it
    // just cannot survive a full sign-in round trip. Never fatal.
  }
}

export function readStoredEmailDestination() {
  try {
    return sessionStorage.getItem(EMAIL_DESTINATION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearStoredEmailDestination() {
  try {
    sessionStorage.removeItem(EMAIL_DESTINATION_STORAGE_KEY);
  } catch {
    // Nothing to do: a value we cannot clear is one we also cannot read.
  }
}
