// Builds an absolute URL that opens a specific event's review modal in the
// production app. Used by email templates (every transactional email referencing
// an event includes a "Review Request" / "View Reservation" button that targets
// this URL).
//
// The frontend handles the rest: src/main.jsx captures ?eventId= into
// sessionStorage before MSAL initializes, then src/components/Calendar.jsx
// reads it on mount, fetches the event via GET /api/events/:id, and opens
// the review modal.
//
// FRONTEND_URL IS A VANITY REDIRECT, NOT A MOUNT POINT. Read this before
// adding any link builder here.
//
// The default targets the canonical public domain. That URL does not host the
// app: it is a 301 that forwards to the Azure app root. Measured 2026-09-03:
//
//   emanuelnyc.org/scheduler                  -> 301 <app-origin>/
//   emanuelnyc.org/scheduler?eventId=abc123   -> 301 <app-origin>/?eventId=abc123
//   emanuelnyc.org/scheduler/my-assignments   -> 404   (never reaches the app)
//
// So the redirect preserves the QUERY STRING and drops any deeper PATH. Every
// builder in this file must therefore express its destination as a query
// parameter and must never append a path segment — a path produces a link that
// 404s at the vanity domain before the app is ever reached. This is asserted by
// the guard in eventDeepLink.test.js, because a comment saying the opposite is
// exactly what once shipped a dead CTA in every schedule email.
//
// For local development, set FRONTEND_URL in backend/.env to your local
// frontend (e.g. https://localhost:5173); for production, set it on the Azure
// App Service config to the canonical URL below so the email links match the
// user's expected origin and the MSAL localStorage cache is shared across tabs
// of the production app.
const DEFAULT_FRONTEND_URL = 'https://emanuelnyc.org/scheduler';

function buildEventDeepLinkUrl(eventId) {
  if (!eventId) return '';
  const base = process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL;
  // Use URL constructor so a base with a sub-path (e.g. /scheduler) is handled
  // cleanly — string concatenation would produce '/scheduler/?eventId=' which
  // doubles the slash on some bases and confuses some email clients' link
  // detection. URL.searchParams.set normalizes the result.
  try {
    const url = new URL(base);
    url.searchParams.set('eventId', String(eventId));
    return url.toString();
  } catch {
    // Malformed FRONTEND_URL — fall back to the safe default rather than
    // producing a broken link.
    const fallback = new URL(DEFAULT_FRONTEND_URL);
    fallback.searchParams.set('eventId', String(eventId));
    return fallback.toString();
  }
}

// Absolute URL for the My Assignments screen. Used by the ASSIGNMENT_SCHEDULE
// email's CTA — a deliberate deviation from the per-event ?eventId= deep link
// convention: schedule emails go to external recipients with no account whose
// full schedule is in the email body, and to staff whose destination is their
// assignments list, not a single event's review modal.
//
// The destination is a QUERY PARAM, not a path, for the reason documented at
// the top of this file: this used to append '/my-assignments' and every CTA
// 404'd at the vanity domain. src/main.jsx captures ?view= before MSAL can
// strip it, and App.jsx routes on it once auth resolves.
const MY_ASSIGNMENTS_VIEW = 'my-assignments';

function buildMyAssignmentsUrl() {
  const base = process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL;
  try {
    const url = new URL(base);
    url.searchParams.set('view', MY_ASSIGNMENTS_VIEW);
    return url.toString();
  } catch {
    // Malformed FRONTEND_URL — fall back to the safe default rather than
    // producing a broken link.
    const fallback = new URL(DEFAULT_FRONTEND_URL);
    fallback.searchParams.set('view', MY_ASSIGNMENTS_VIEW);
    return fallback.toString();
  }
}

module.exports = {
  buildEventDeepLinkUrl,
  buildMyAssignmentsUrl,
  DEFAULT_FRONTEND_URL,
  MY_ASSIGNMENTS_VIEW
};
