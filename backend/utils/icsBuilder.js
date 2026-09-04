/**
 * icsBuilder.js — RFC 5545 generator for scheduling-sheet assignments.
 *
 * Turns the entries `extractDayAssignments()` already produces into ONE
 * VCALENDAR per recipient, carrying one VEVENT per assignment in scope.
 *
 * Deliberately dependency-free and free of server imports (same stance as
 * sheetCells.js / concurrencyRules.js / conflictDelta.js) so format
 * conformance is unit-testable with no database and no mail service.
 *
 * Two properties shape everything here:
 *
 *   1. Begins / Ends / Call Time are FREE TEXT cells. '5:30', '6:00 PM',
 *      '17:30', 'TBD', 'after Mincha' and empty are all legal, real content.
 *      A cell nobody can parse becomes an ALL-DAY event (design D5) — never a
 *      silent omission. Reporting the gap beats withholding the shift, the
 *      same call already made for placeholder chips on the send endpoint.
 *   2. METHOD:PUBLISH, never METHOD:REQUEST, and no ATTENDEE anywhere
 *      (design D2). REQUEST would make Exchange treat the sending mailbox as
 *      the organizer of a 31-attendee meeting and accrue RSVP tracking on
 *      every send.
 */

const DEFAULT_TIME_ZONE = 'America/New_York';
const DEFAULT_PRODID = '-//Temple Emanu-El//Scheduling Sheets//EN';
const DEFAULT_UID_DOMAIN = 'emanuelnyc.org';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;
const CRLF = '\r\n';
const FOLD_LIMIT_OCTETS = 75;

// H, H:MM or HH:MM with an OPTIONAL meridiem in either case, with or without
// periods, with or without a space. Anchored: anything else is prose, and
// prose is not a time (design D4).
const TIME_RE = /^(\d{1,2})(?::([0-5]\d))?\s*(?:([ap])\.?\s*m?\.?)?$/i;

/**
 * Parse one free-text cell into { hour, minute } local wall-clock, or null.
 *
 * The ambiguity rule for a bare time with no meridiem: hour 12 and hours 1
 * through 6 resolve PM, hours 7 through 11 resolve AM. That is the reading a
 * human already applies to a temple schedule, and refusing bare times would
 * push the common case ('5:30', which is what people actually type) into the
 * all-day fallback and gut the feature. A wrong guess stays VISIBLE because
 * the literal cell text rides along in DESCRIPTION.
 */
function parseCellTime(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return null;
  const m = TIME_RE.exec(raw);
  if (!m) return null;

  const meridiem = m[3] ? m[3].toLowerCase() : null;
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);

  if (meridiem) {
    // A meridiem only makes sense on a 12-hour clock face.
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'a') hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
    return { hour, minute };
  }

  if (hour > 23) return null;
  // 0 and 13-23 can only be a 24-hour reading; 12 and 1-6 read PM, 7-11 AM.
  if (hour >= 1 && hour <= 6) hour += 12;
  // hour 12 already means noon; 7-11, 13-23 and 0 stand as written.
  return { hour, minute };
}

/**
 * The offset of `timeZone` at the instant `date`, in milliseconds east of UTC.
 * Node ships full ICU, so the zone resolves with no dependency.
 */
function zoneOffsetMs(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  // en-US under hourCycle h23 can render midnight as '24'.
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second)
  );
  return asIfUtc - date.getTime();
}

/**
 * A YYYY-MM-DD sheet date plus a local wall-clock time, as a UTC instant
 * (design D7). Guess with the offset at the naive instant, then refine once
 * with the offset at the guess — one pass is enough for any DST boundary.
 *
 * UTC instants rather than TZID + a hand-written VTIMEZONE: a TZID without an
 * accompanying VTIMEZONE is technically invalid, and hand-maintaining DST
 * rules to keep one valid is a liability with no payoff for events whose
 * instants are fixed.
 */
function zonedWallClockToUtc(dateStr, hour, minute, timeZone = DEFAULT_TIME_ZONE) {
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  if (!y || !mo || !d) return null;
  const naive = Date.UTC(y, mo - 1, d, hour, minute, 0);
  const guess = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
  return new Date(naive - zoneOffsetMs(guess, timeZone));
}

/** The day after a YYYY-MM-DD date, still as YYYY-MM-DD. */
function nextDateString(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + DAY_MS).toISOString().slice(0, 10);
}

/** An ISO string from a stored snapshot, read as UTC when it carries no zone. */
function parseSnapshotInstant(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}Z`;
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The window one assignment occupies (design D3).
 *
 * A staff member called at 4:30 for a 6:00 service needs 4:30 blocked, not
 * 6:00 — which is the whole reason `callTimeOverride` is per-person.
 *
 *   DTSTART: effective call time, then Begins, then the linked snapshot start.
 *   DTEND:   Ends, then the linked snapshot end, then start + 2h.
 *
 * An end earlier than the start crosses midnight and rolls to the next day;
 * without that rule a 10:00 PM call ending at 1:00 AM produces a
 * negative-duration event that clients reject outright.
 *
 * Returns { allDay: true } when no start resolves at all.
 */
function resolveEventWindow(entry, timeZone = DEFAULT_TIME_ZONE) {
  const date = entry && entry.date;
  if (!date) return { allDay: true };
  const snap = (entry && entry.linkedSnapshot) || null;

  const startParts = parseCellTime(entry.callTime) || parseCellTime(entry.begins);
  let start = startParts ? zonedWallClockToUtc(date, startParts.hour, startParts.minute, timeZone) : null;
  if (!start && snap) start = parseSnapshotInstant(snap.startDateTime);
  if (!start) return { allDay: true };

  const endParts = parseCellTime(entry.ends);
  let end = endParts ? zonedWallClockToUtc(date, endParts.hour, endParts.minute, timeZone) : null;
  const endFromCell = !!end;
  if (!end && snap) end = parseSnapshotInstant(snap.endDateTime);

  if (!end) {
    end = new Date(start.getTime() + DEFAULT_DURATION_MS);
  } else if (end.getTime() < start.getTime()) {
    // The FOLLOWING CALENDAR DAY, not start + 24h. On the night the clocks go
    // back, a 10:00 PM to 1:00 AM shift is three hours long, and adding a flat
    // 24h of absolute time to the 1:00 AM instant lands on midnight instead.
    // Re-resolving the wall clock on the next date is the only reading that
    // survives a DST boundary.
    end = endFromCell
      ? zonedWallClockToUtc(nextDateString(date), endParts.hour, endParts.minute, timeZone)
      : new Date(end.getTime() + DAY_MS);
  } else if (end.getTime() === start.getTime()) {
    // Zero duration is not a shift. Fall back to the stated default rather
    // than rolling a whole day forward.
    end = new Date(start.getTime() + DEFAULT_DURATION_MS);
  }

  return { allDay: false, start, end };
}

/** RFC 5545 TEXT escaping. Backslash FIRST or the others double-escape. */
function escapeText(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold a content line at 75 OCTETS — measured in UTF-8 bytes, not characters.
 * A name with an accent is two bytes, and folding on character count produces
 * files that fail validation only for the people whose names have accents.
 * Continuation lines begin with one space, which counts toward the limit.
 */
function foldLine(line) {
  const text = String(line == null ? '' : line);
  const out = [];
  let current = '';
  let bytes = 0;
  for (const ch of text) {
    const chBytes = Buffer.byteLength(ch, 'utf8');
    if (bytes + chBytes > FOLD_LIMIT_OCTETS) {
      out.push(current);
      current = ' ';
      bytes = 1;
    }
    current += ch;
    bytes += chBytes;
  }
  out.push(current);
  return out.join(CRLF);
}

/**
 * A UID stable across every edit that is not a deletion (design D6).
 *
 * dayId is a Mongo ObjectId; rowId and colId are UUIDs assigned at creation —
 * and crucially the drag-reorder feature moves array POSITIONS, never ids, so
 * reordering columns or custom rows does not re-identify anybody's entries.
 * The email is included because one cell can hold several person chips.
 */
function buildUid(entry, email, domain = DEFAULT_UID_DOMAIN) {
  const person = String(email == null ? '' : email)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-');
  const parts = [entry && entry.dayId, entry && entry.rowId, entry && entry.colId, person].map((p) =>
    String(p == null ? '' : p)
  );
  return `${parts.join('-')}@${domain}`;
}

/** 20260911T203000Z */
function formatUtcStamp(date) {
  const iso = new Date(date).toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

/** 2026-09-11 -> 20260911 */
function formatDateValue(dateStr) {
  return String(dateStr || '').replace(/-/g, '');
}

/** The day after a YYYY-MM-DD date, as YYYYMMDD — an all-day DTEND is EXCLUSIVE. */
function nextDateValue(dateStr) {
  return formatDateValue(nextDateString(dateStr));
}

/** 'Ushers — Erev Service' — the role and the column it belongs to. */
function buildSummary(entry) {
  const parts = [entry.rowLabel, entry.columnName].map((p) => (p == null ? '' : String(p).trim())).filter(Boolean);
  if (parts.length) return parts.join(' — ');
  return entry.dayTitle ? String(entry.dayTitle) : 'Assignment';
}

/**
 * The literal cell text, as written on the sheet, plus any note. A time this
 * builder guessed wrong stays visible to the recipient rather than silent —
 * the email body remains authoritative.
 */
function buildDescription(entry) {
  const lines = [];
  if (entry.callTime) lines.push(`Call time: ${entry.callTime}`);
  if (entry.begins) lines.push(`Begins: ${entry.begins}`);
  if (entry.ends) lines.push(`Ends: ${entry.ends}`);
  if (entry.note) lines.push(`Note: ${entry.note}`);
  if (entry.dayTitle) lines.push(`Day: ${entry.dayTitle}`);
  return lines.join('\n');
}

/**
 * LOCATION passes prose through untouched: offsite venues are typed as plain
 * text in the Location row rather than selected as chips, so this field must
 * not expect chips.
 */
function buildLocation(entry) {
  if (Array.isArray(entry.locationLines) && entry.locationLines.length) {
    return entry.locationLines.join(', ');
  }
  return entry.location ? String(entry.location) : '';
}

function buildEventLines(entry, email, { dtstamp, timeZone, uidDomain }) {
  const lines = ['BEGIN:VEVENT'];
  lines.push(`UID:${buildUid(entry, email, uidDomain)}`);
  lines.push(`DTSTAMP:${formatUtcStamp(dtstamp)}`);
  const sequence = Number.isFinite(Number(entry.sequence)) ? Math.max(0, Math.trunc(Number(entry.sequence))) : 0;
  lines.push(`SEQUENCE:${sequence}`);

  const window = resolveEventWindow(entry, timeZone);
  if (window.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatDateValue(entry.date)}`);
    lines.push(`DTEND;VALUE=DATE:${nextDateValue(entry.date)}`);
  } else {
    lines.push(`DTSTART:${formatUtcStamp(window.start)}`);
    lines.push(`DTEND:${formatUtcStamp(window.end)}`);
  }

  lines.push(`SUMMARY:${escapeText(buildSummary(entry))}`);
  const description = buildDescription(entry);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  const location = buildLocation(entry);
  if (location) lines.push(`LOCATION:${escapeText(location)}`);
  lines.push('TRANSP:OPAQUE');
  lines.push('END:VEVENT');
  return lines;
}

/**
 * One VCALENDAR carrying every entry as its own VEVENT.
 *
 * A VCALENDAR holds 1..N VEVENT components, so one file covering a person's
 * whole season is ordinary iCalendar (design D1). Entries must already be the
 * ONE recipient's — this is built inside the per-recipient fan-out precisely
 * because its contents differ per person, unlike the workbook PDF.
 */
function buildAssignmentsCalendar(entries, options = {}) {
  const list = Array.isArray(entries) ? entries.filter((e) => e && !e.placeholder) : [];
  if (!list.length) return null;

  const dtstamp = options.dtstamp ? new Date(options.dtstamp) : new Date();
  const timeZone = options.timeZone || DEFAULT_TIME_ZONE;
  const uidDomain = options.uidDomain || DEFAULT_UID_DOMAIN;
  const prodId = options.prodId || DEFAULT_PRODID;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId}`,
    'CALSCALE:GREGORIAN',
    // PUBLISH, never REQUEST: 'here is an event, add it if you like' — no
    // RSVP, no organizer relationship, no server-side meeting object.
    'METHOD:PUBLISH'
  ];
  for (const entry of list) {
    lines.push(...buildEventLines(entry, options.email || entry.email, { dtstamp, timeZone, uidDomain }));
  }
  lines.push('END:VCALENDAR');

  // CRLF throughout, including the final line.
  return `${lines.map(foldLine).join(CRLF)}${CRLF}`;
}

module.exports = {
  parseCellTime,
  zonedWallClockToUtc,
  zoneOffsetMs,
  resolveEventWindow,
  escapeText,
  foldLine,
  buildUid,
  buildAssignmentsCalendar,
  DEFAULT_TIME_ZONE
};
