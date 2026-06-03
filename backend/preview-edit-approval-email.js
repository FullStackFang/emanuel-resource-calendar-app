/**
 * One-off preview for the edit-request approval email.
 *
 * Renders the "Your Edit Request Has Been Approved" email to standalone HTML
 * files so you can eyeball the "Changes Applied" table in a browser — no
 * database, no Graph API, no EMAIL_CLIENT_SECRET, nothing sent.
 *
 * It reproduces the exact Streicker scenario from the bug report (an edit that
 * adds a room) and writes TWO files:
 *
 *   email-approval-BEFORE.html  — the old buggy path (raw ObjectIds + raw keys)
 *   email-approval-AFTER.html   — the fixed path (friendly labels + room names)
 *
 * Run:  cd backend && node preview-edit-approval-email.js
 * Then open the printed file paths in your browser.
 */

const fs = require('fs');
const path = require('path');

const { detectEventChanges, formatChangesForEmail } = require('./utils/changeDetection');
const emailTemplates = require('./services/emailTemplates');

// --- Fixture: mirrors the real "Streicker: Israel on our Minds" event -------
// Two rooms, identified by ObjectId hex strings exactly like production.
const GREENWALD_ID = '6943891f41de6ea7045ca0c1'; // original room
const STREICKER_ID = '690b9e3a4af9e235dbeeab76'; // room added by the edit

// Stand-in for the templeEvents__Locations lookup the real endpoint performs.
// The rendered result is identical to a Cosmos query — only the source differs.
const LOCATION_NAMES = {
  [GREENWALD_ID]: 'Greenwald Hall',
  [STREICKER_ID]: 'Streicker Center',
};

// The event BEFORE the edit: Greenwald Hall only.
const event = {
  _id: 'preview-event-id',
  eventId: 'rssched--1999849332',
  calendarData: {
    eventTitle: 'Streicker: Israel on our Minds',
    startDateTime: '2026-05-28T09:00:00',
    endDateTime: '2026-05-28T13:00:00',
    locations: [GREENWALD_ID],
    locationDisplayNames: 'Greenwald Hall',
    attendeeCount: 1,
  },
};

const editRequest = {
  requestedBy: { name: 'Erika Resnick', email: 'erika@emanuelstreickernyc.org' },
};

// What the requester (+ any approver overrides) proposed. Note the redundant
// requestedRooms key alongside locations — exactly as in the bug report.
const finalChanges = {
  requestedRooms: [STREICKER_ID, GREENWALD_ID],
  locations: [STREICKER_ID, GREENWALD_ID],
};

// --- BEFORE: the old hand-rolled array (the bug) ----------------------------
function buildBuggyChanges() {
  const cd = event.calendarData || {};
  const changesArray = [];
  for (const [field, newValue] of Object.entries(finalChanges)) {
    changesArray.push({ field, oldValue: cd[field] ?? '', newValue });
  }
  return changesArray;
}

// --- AFTER: the fixed pipeline (matches the endpoint exactly) ---------------
function buildFixedChanges() {
  const detected = detectEventChanges(event, finalChanges);
  const locationMap = {};
  const locationIds = new Set();
  for (const c of detected.filter((ch) => ch.field === 'locations')) {
    (Array.isArray(c.oldValue) ? c.oldValue : []).forEach((lid) => lid && locationIds.add(String(lid)));
    (Array.isArray(c.newValue) ? c.newValue : []).forEach((lid) => lid && locationIds.add(String(lid)));
  }
  for (const id of locationIds) {
    locationMap[id] = LOCATION_NAMES[id] || id;
  }
  return formatChangesForEmail(detected, { locationMap });
}

// The email-payload builder (buildEditRequestEmailPayload in api-server.js)
// resolves locationDisplayNames to the FINAL room names for the header block.
function emailPayload() {
  return {
    _id: event._id,
    eventId: event.eventId,
    eventTitle: event.calendarData.eventTitle,
    startDateTime: event.calendarData.startDateTime,
    endDateTime: event.calendarData.endDateTime,
    requesterName: editRequest.requestedBy.name,
    requesterEmail: editRequest.requestedBy.email,
    startTime: event.calendarData.startDateTime,
    endTime: event.calendarData.endDateTime,
    // Final rooms, resolved to names (Streicker Center + Greenwald Hall).
    locationDisplayNames: finalChanges.locations.map((id) => LOCATION_NAMES[id] || id).join(', '),
  };
}

async function main() {
  const notes = 'Approved — added the Streicker Center per your request.';

  const before = await emailTemplates.generateEditRequestApprovedNotification(
    emailPayload(), notes, buildBuggyChanges()
  );
  const after = await emailTemplates.generateEditRequestApprovedNotification(
    emailPayload(), notes, buildFixedChanges()
  );

  const beforePath = path.join(__dirname, 'email-approval-BEFORE.html');
  const afterPath = path.join(__dirname, 'email-approval-AFTER.html');
  fs.writeFileSync(beforePath, before.html, 'utf8');
  fs.writeFileSync(afterPath, after.html, 'utf8');

  console.log('\nRendered approval-email previews (no DB / no email sent):\n');
  console.log('  Subject:', after.subject);
  console.log('  BEFORE (buggy):', beforePath);
  console.log('  AFTER  (fixed):', afterPath);
  console.log('\nOpen both in a browser to compare the "Changes Applied" table.\n');
}

main().catch((err) => {
  console.error('Preview failed:', err);
  process.exit(1);
});
