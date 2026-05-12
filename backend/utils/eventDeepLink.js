// Builds an absolute URL that opens a specific event's review modal in the
// production app. Used by email templates (every transactional email referencing
// an event includes a "Review Request" / "View Reservation" button that targets
// this URL).
//
// The frontend handles the rest: src/main.jsx captures ?eventId= into
// sessionStorage before MSAL initializes, then src/components/Calendar.jsx
// reads it on mount, fetches the event via GET /api/events/:id, and opens
// the review modal.
const DEFAULT_FRONTEND_URL = 'https://emanuel-resourcescheduler-d4echehehaf3dxfg.canadacentral-01.azurewebsites.net';

function buildEventDeepLinkUrl(eventId) {
  if (!eventId) return '';
  const base = process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL;
  return `${base}/?eventId=${eventId}`;
}

module.exports = { buildEventDeepLinkUrl, DEFAULT_FRONTEND_URL };
