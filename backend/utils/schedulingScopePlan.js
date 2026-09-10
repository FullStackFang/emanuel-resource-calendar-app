// backend/utils/schedulingScopePlan.js
//
// The pure half of schedule distribution: resolve a send request's SCOPE (which
// days), its RECIPIENTS, and whether the client's view of the sheet is current.
// Pure and dependency-free, the same stance as sheetCells.js / icsBuilder.js /
// localDate.js — no database, no mail service, no server imports — so every
// rejection path is testable without the possibility of delivering mail.
//
// It exists because the endpoint's old scope was a two-way branch (`dayId` or
// `wholeSheet`) that needed no validation worth the name. Arbitrary day
// selection changes that: the request can now be internally inconsistent, and
// the cost of getting it wrong is a mass-mailing to the wrong people. So every
// question that can be answered without I/O is answered here, first.
//
// Two rules are load-bearing:
//   - An EXPLICIT empty selection is an error, never "so send to everyone".
//     `dayIds: []` and `recipients: []` are both 400s. `wholeSheet: true` on a
//     workbook with no days is a different statement and stays legal.
//   - An unknown day and a day in someone else's workbook produce the IDENTICAL
//     404. The endpoint only ever hands us days from the addressed workbook, so
//     a foreign id simply is not found — and that must not become a probe for
//     what exists elsewhere.

// `perDay` is specified (design.md §5) but not implemented in this slice.
// Listing only what is real means a client asking for perDay gets an error
// rather than one silently combined email.
const SUPPORTED_GROUPINGS = ['combined'];
const DEFAULT_GROUPING = 'combined';

const reject = (status, code, message, extra = {}) => ({ ok: false, status, code, message, ...extra });

/** Day ids arrive as strings over HTTP but are ObjectIds in Mongo. */
const idOf = (day) => String(day && day._id);

/**
 * Resolve a send request into an ordered day plan.
 *
 * @param {object} body - `{ dayIds?, dayId?, wholeSheet?, grouping? }`
 * @param {Array<{_id:any,date:string,_version:number}>} sheetDays - every day in
 *   the addressed workbook. The caller guarantees the ownership filter, which is
 *   what makes a foreign day indistinguishable from a missing one.
 * @returns {{ok:true,plan:object}|{ok:false,status:number,code:string,message:string}}
 */
function planScope(body, sheetDays) {
  const { dayIds, dayId, wholeSheet, grouping } = body || {};
  const days = Array.isArray(sheetDays) ? sheetDays : [];

  const hasNewScope = dayIds !== undefined && dayIds !== null;
  const hasLegacyDay = dayId !== undefined && dayId !== null;
  // `false` is not a request for the whole sheet, so it does not count as scope
  // — but any other non-empty value is an ATTEMPT at it, and an attempt is
  // enough to make a request ambiguous.
  const hasLegacyWhole = wholeSheet !== undefined && wholeSheet !== null && wholeSheet !== false;

  if ((hasNewScope && (hasLegacyDay || hasLegacyWhole)) || (hasLegacyDay && hasLegacyWhole)) {
    return reject(400, 'MIXED_SCOPE',
      'Provide exactly one of dayIds, dayId, or wholeSheet — not a combination.');
  }

  const groupingName = grouping === undefined || grouping === null ? DEFAULT_GROUPING : grouping;
  if (!SUPPORTED_GROUPINGS.includes(groupingName)) {
    return reject(400, 'UNSUPPORTED_GROUPING',
      `Unsupported grouping '${groupingName}'. Supported: ${SUPPORTED_GROUPINGS.join(', ')}.`);
  }

  let selected;
  let legacy;
  // 'sheet' means "the whole workbook", 'days' means "these named days". The
  // distinction outlives the day COUNT and callers must not re-derive it from
  // `dayIds.length`: a whole-sheet send at a one-day workbook is still a
  // statement about the sheet, and is labelled by the workbook name.
  let scopeKind;

  if (hasNewScope) {
    if (!Array.isArray(dayIds)) {
      return reject(400, 'INVALID_SCOPE', 'dayIds must be an array of day ids.');
    }
    if (dayIds.length === 0) {
      // Deliberately NOT "then send everything".
      return reject(400, 'EMPTY_SCOPE', 'Select at least one day to send.');
    }
    if (dayIds.some((id) => typeof id !== 'string' || id.trim() === '')) {
      return reject(400, 'INVALID_SCOPE', 'Every entry in dayIds must be a non-empty day id.');
    }
    if (new Set(dayIds).size !== dayIds.length) {
      return reject(400, 'DUPLICATE_DAYS', 'dayIds contains the same day more than once.');
    }

    const byId = new Map(days.map((d) => [idOf(d), d]));
    const missing = dayIds.filter((id) => !byId.has(id));
    if (missing.length) {
      // One message for unknown AND foreign ids. See the header note.
      return reject(404, 'DAY_NOT_FOUND', `Day not found: ${missing.join(', ')}`);
    }
    selected = dayIds.map((id) => byId.get(id));
    legacy = false;
    scopeKind = 'days';
  } else if (hasLegacyDay) {
    if (typeof dayId !== 'string' || dayId.trim() === '') {
      return reject(400, 'INVALID_SCOPE', 'dayId must be a day id.');
    }
    const found = days.find((d) => idOf(d) === dayId);
    if (!found) return reject(404, 'DAY_NOT_FOUND', `Day not found: ${dayId}`);
    selected = [found];
    legacy = true;
    scopeKind = 'days';
  } else if (hasLegacyWhole) {
    if (wholeSheet !== true) {
      return reject(400, 'INVALID_SCOPE', 'wholeSheet must be true when supplied.');
    }
    // An empty workbook yields an empty plan rather than the EMPTY_SCOPE error:
    // the caller did not name zero days, the workbook simply has none.
    selected = [...days];
    legacy = true;
    scopeKind = 'sheet';
  } else {
    return reject(400, 'MISSING_SCOPE', 'Provide dayIds, dayId, or wholeSheet: true.');
  }

  // Chronological, with the id as a tiebreak so two days sharing a date cannot
  // reorder between the preview and the send.
  const ordered = [...selected].sort(
    (a, b) => String(a.date || '').localeCompare(String(b.date || '')) || idOf(a).localeCompare(idOf(b))
  );
  const orderedIds = ordered.map(idOf);

  return {
    ok: true,
    plan: {
      dayIds: orderedIds,
      days: ordered,
      grouping: groupingName,
      scopeKind,
      // One group per message-set. Combined is a single group covering every
      // selected day; perDay would be one group per day, which is why the shape
      // is a list rather than a bare day array.
      groups: [{ groupId: 'combined', dayIds: orderedIds }],
      legacy,
    },
  };
}

/**
 * Compare the client's snapshot of each planned day against the server's.
 * Absent map = a legacy client, which never had a snapshot to be stale.
 *
 * @param {Array<{_id:any,_version:number}>} plannedDays
 * @param {Object<string,number>|undefined} expectedDayVersions
 */
function checkDayVersions(plannedDays, expectedDayVersions) {
  if (expectedDayVersions === undefined || expectedDayVersions === null) return { ok: true };

  const has = (id) => Object.prototype.hasOwnProperty.call(expectedDayVersions, id);
  const missing = [];
  const stale = [];

  for (const day of plannedDays) {
    const id = idOf(day);
    // A non-object map has no own properties, so it lands here as "incomplete"
    // without needing its own branch.
    if (!has(id) || !Number.isFinite(Number(expectedDayVersions[id]))) {
      missing.push(id);
      continue;
    }
    if (Number(expectedDayVersions[id]) !== Number(day._version)) stale.push(id);
  }

  if (missing.length) {
    return reject(400, 'INCOMPLETE_VERSIONS',
      'expectedDayVersions must contain a numeric version for every selected day.',
      { missingDayIds: missing });
  }
  if (stale.length) {
    return reject(409, 'STALE_SHEET',
      'The sheet changed since this send was prepared. Nothing was sent — review the refreshed selection.',
      { staleDayIds: stale });
  }
  return { ok: true };
}

/**
 * Resolve the requested recipients against those actually assigned in scope.
 * Omission means all eligible; an explicit empty list is an error; an address
 * that is not eligible is refused rather than quietly dropped, because dropping
 * it would send a schedule that silently excludes somebody the sender named.
 *
 * @param {string[]|undefined} requested
 * @param {string[]} eligible - emails as the assignment extractor grouped them
 */
function normalizeRecipients(requested, eligible) {
  if (requested === undefined || requested === null) return { ok: true, emails: eligible };
  if (!Array.isArray(requested)) {
    return reject(400, 'INVALID_RECIPIENTS', 'recipients must be an array of email addresses.');
  }
  if (requested.length === 0) {
    return reject(400, 'EMPTY_RECIPIENTS', 'Select at least one recipient to send to.');
  }

  // Chip emails are free text, so a caller may not reproduce the stored casing.
  // Match case-insensitively but return the ELIGIBLE spelling: that string is
  // the key the assignment extractor grouped entries under.
  const byLower = new Map(eligible.map((e) => [String(e).toLowerCase(), e]));
  const resolved = [];
  const ineligible = [];
  for (const raw of requested) {
    const key = String(raw == null ? '' : raw).toLowerCase();
    if (byLower.has(key)) resolved.push(byLower.get(key));
    else ineligible.push(raw);
  }

  if (ineligible.length) {
    return reject(400, 'INELIGIBLE_RECIPIENT',
      `Not assigned on the selected days: ${ineligible.join(', ')}`,
      { ineligibleRecipients: ineligible });
  }
  return { ok: true, emails: resolved };
}

module.exports = {
  planScope,
  checkDayVersions,
  normalizeRecipients,
  SUPPORTED_GROUPINGS,
};
