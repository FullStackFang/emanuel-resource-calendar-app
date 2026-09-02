/**
 * sheetCells.js — pure helpers for Scheduling Sheet day-doc cells.
 *
 * A cell is { segments: [...], note: null | { text, authorName, at } }.
 * Segment kinds:
 *   { type: 'text', text }
 *   { type: 'person', userId|null, name, email|null, placeholder, callTimeOverride|null }
 *   { type: 'location', locationId|null, name }
 *
 * Deliberately dependency-free (same stance as concurrencyRules.js /
 * conflictDelta.js) so it is unit-testable without a server. The server MUST
 * pass every client-supplied cell through validateCell() and recompute
 * taggedEmails via extractTaggedEmails() — client-supplied taggedEmails are
 * always ignored (they gate the my-assignments query, so a spoofed or stale
 * array either leaks cells into someone's view or hides real assignments).
 */

const SEGMENT_TYPES = ['text', 'person', 'location'];
const MAX_SEGMENTS_PER_CELL = 50;
const MAX_TEXT_LENGTH = 2000;
const MAX_NOTE_LENGTH = 2000;
const MAX_NAME_LENGTH = 200;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Canonical map key for one cell. */
function cellKey(rowId, colId) {
  return `${rowId}:${colId}`;
}

function fail(error) {
  return { valid: false, error };
}

/**
 * Validate and normalize one client-supplied cell.
 * Returns { valid: true, cell } with a NEW normalized cell object, or
 * { valid: false, error }. Unknown segment fields are dropped; person emails
 * are lowercased; empty-segment cells are allowed (an empty cell is a valid
 * write — it is how content gets cleared).
 */
function validateCell(rawCell) {
  if (!rawCell || typeof rawCell !== 'object' || Array.isArray(rawCell)) {
    return fail('cell must be an object');
  }
  const segments = rawCell.segments;
  if (!Array.isArray(segments)) {
    return fail('cell.segments must be an array');
  }
  if (segments.length > MAX_SEGMENTS_PER_CELL) {
    return fail(`cell.segments exceeds the maximum of ${MAX_SEGMENTS_PER_CELL}`);
  }

  const clean = [];
  for (const seg of segments) {
    if (!seg || typeof seg !== 'object') return fail('segment must be an object');
    if (!SEGMENT_TYPES.includes(seg.type)) {
      return fail(`unknown segment type '${String(seg.type)}'`);
    }

    if (seg.type === 'text') {
      if (typeof seg.text !== 'string') return fail('text segment requires a string text');
      if (seg.text.length > MAX_TEXT_LENGTH) return fail('text segment too long');
      clean.push({ type: 'text', text: seg.text });
      continue;
    }

    if (typeof seg.name !== 'string' || !seg.name.trim()) {
      return fail(`${seg.type} segment requires a non-empty name`);
    }
    if (seg.name.length > MAX_NAME_LENGTH) return fail(`${seg.type} segment name too long`);

    if (seg.type === 'person') {
      const placeholder = seg.placeholder === true;
      let email = null;
      if (!placeholder) {
        if (seg.email != null) {
          if (typeof seg.email !== 'string' || !seg.email.includes('@')) {
            return fail('person segment email must be a valid address or null');
          }
          email = seg.email.trim().toLowerCase();
        }
      }
      let callTimeOverride = null;
      if (seg.callTimeOverride != null) {
        if (typeof seg.callTimeOverride !== 'string' || !HHMM_RE.test(seg.callTimeOverride)) {
          return fail('callTimeOverride must be HH:MM');
        }
        callTimeOverride = seg.callTimeOverride;
      }
      clean.push({
        type: 'person',
        userId: typeof seg.userId === 'string' && seg.userId ? seg.userId : null,
        name: seg.name.trim(),
        email,
        placeholder,
        callTimeOverride
      });
      continue;
    }

    // location
    clean.push({
      type: 'location',
      locationId: typeof seg.locationId === 'string' && seg.locationId ? seg.locationId : null,
      name: seg.name.trim()
    });
  }

  let note = null;
  if (rawCell.note != null) {
    const n = rawCell.note;
    if (typeof n !== 'object' || typeof n.text !== 'string' || !n.text.trim()) {
      return fail('note must be null or { text, authorName, at }');
    }
    if (n.text.length > MAX_NOTE_LENGTH) return fail('note too long');
    note = {
      text: n.text,
      authorName: typeof n.authorName === 'string' ? n.authorName : null,
      at: typeof n.at === 'string' ? n.at : new Date().toISOString()
    };
  }

  return { valid: true, cell: { segments: clean, note } };
}

/**
 * Distinct lowercased person-chip emails across a day's cells map, sorted for
 * deterministic storage. Placeholders (no email) contribute nothing.
 * ALWAYS derived from stored cell content — never from client input.
 */
function extractTaggedEmails(cells) {
  const emails = new Set();
  for (const key of Object.keys(cells || {})) {
    const cell = cells[key];
    for (const seg of (cell && cell.segments) || []) {
      if (seg && seg.type === 'person' && typeof seg.email === 'string' && seg.email) {
        emails.add(seg.email.toLowerCase());
      }
    }
  }
  return [...emails].sort();
}

module.exports = {
  SEGMENT_TYPES,
  MAX_SEGMENTS_PER_CELL,
  MAX_TEXT_LENGTH,
  MAX_NOTE_LENGTH,
  cellKey,
  validateCell,
  extractTaggedEmails
};
