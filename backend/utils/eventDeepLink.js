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
// The default URL targets the canonical public domain (custom domain mounted
// at the /scheduler sub-path). For local development, set FRONTEND_URL in
// backend/.env to your local frontend (e.g. https://localhost:5173); for
// production, set it on the Azure App Service config to the canonical URL
// below so the email links match the user's expected origin and the MSAL
// localStorage cache is shared across tabs of the production app.
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

module.exports = { buildEventDeepLinkUrl, DEFAULT_FRONTEND_URL };
