// src/components/scheduling/sheetEventUtils.js
//
// Pure helpers shared by the Scheduling Sheets components.

/**
 * Event location names arrive in two shapes: an array (modern) or a
 * comma-separated string (legacy string-stored locations — same shape the
 * backend's conflict checker special-cases). Always hand back a clean array.
 */
export function toLocationNameArray(value) {
  if (Array.isArray(value)) {
    return value.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim());
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

// ── Reorder helpers (scheduling-sheet-drag-reorder) ─────────────────────────
//
// Small pure array-move primitives. Never mutate the input; return the SAME
// array reference when there is nothing to do (unknown id, no-op move) so
// callers can cheaply skip a structure write.

/** Move the item with `.id === id` to `toIndex` (clamped to the array bounds). */
export function moveArrayItem(array, id, toIndex) {
  const fromIndex = array.findIndex((item) => item.id === id);
  if (fromIndex === -1) return array;
  const clamped = Math.max(0, Math.min(toIndex, array.length - 1));
  if (clamped === fromIndex) return array;
  const next = array.slice();
  const [item] = next.splice(fromIndex, 1);
  next.splice(clamped, 0, item);
  return next;
}

/** Move the item with `.id === id` by a relative number of positions. */
export function moveArrayItemBy(array, id, delta) {
  const fromIndex = array.findIndex((item) => item.id === id);
  if (fromIndex === -1) return array;
  return moveArrayItem(array, id, fromIndex + delta);
}

/** Move the item with `.id === draggedId` to the position currently held by `targetId`. */
export function reorderArrayItem(array, draggedId, targetId) {
  if (draggedId === targetId) return array;
  const toIndex = array.findIndex((item) => item.id === targetId);
  if (toIndex === -1) return array;
  return moveArrayItem(array, draggedId, toIndex);
}

/** The user-created rows of a scheduling sheet day, starter rows excluded. */
export function customRowsOf(rows) {
  return (rows || []).filter((r) => r.kind !== 'starter');
}

/**
 * Rebuild `day.rows` with starter rows locked as a fixed prefix in their
 * existing order, followed by `reorderedCustomRows`.
 */
function withCustomRows(rows, reorderedCustomRows) {
  return [...rows.filter((r) => r.kind === 'starter'), ...reorderedCustomRows];
}

/**
 * Reorder custom rows by dragging one onto another's position. Starter rows
 * are never movable — a starter `draggedId` is a no-op, matching the
 * component only rendering drag handles on custom row labels.
 */
export function reorderCustomRows(rows, draggedId, targetId) {
  const custom = customRowsOf(rows);
  const reordered = reorderArrayItem(custom, draggedId, targetId);
  if (reordered === custom) return rows;
  return withCustomRows(rows, reordered);
}

/** Move a custom row by a relative number of positions within the custom group. */
export function moveCustomRowBy(rows, id, delta) {
  const custom = customRowsOf(rows);
  const reordered = moveArrayItemBy(custom, id, delta);
  if (reordered === custom) return rows;
  return withCustomRows(rows, reordered);
}

/** Move a custom row to an absolute index within the custom group (e.g. top/bottom). */
export function moveCustomRowTo(rows, id, toIndex) {
  const custom = customRowsOf(rows);
  const reordered = moveArrayItem(custom, id, toIndex);
  if (reordered === custom) return rows;
  return withCustomRows(rows, reordered);
}

// ── Time parsing ────────────────────────────────────────────────────────────
//
// ONE definition of "what is a time" for scheduling sheets, shared by the cell
// commit path, the '@event' starter-row prefill, and the double-booking
// overlap check below. Consistency is structural rather than a convention
// people have to follow: only this function produces a sheet time string.
//
// Returns { value: 'HH:MM' (24h, sortable), display: '6:00 PM' } or null when
// the input is not a time at all — 'after kiddush' must stay ordinary free
// text, never a silently mangled clock value.

const MERIDIEM_RE = /^(\d{1,2})(?::?(\d{2}))?\s*([ap])m?$/;
const COLON_RE = /^(\d{1,2}):(\d{2})$/;
const COMPACT_RE = /^(\d{3,4})$/;
const BARE_HOUR_RE = /^(\d{1,2})$/;

/** 24h hour for a bare hour with no meridiem: 7-12 read as AM, 1-6 as PM. */
function disambiguateBareHour(hour) {
  if (hour === 0 || hour >= 13) return hour;   // already unambiguous 24h
  return hour <= 6 ? hour + 12 : hour;         // 1-6 -> evening, 7-12 literal
}

function buildTime(hour24, minute) {
  if (!Number.isInteger(hour24) || !Number.isInteger(minute)) return null;
  if (hour24 < 0 || hour24 > 23 || minute < 0 || minute > 59) return null;
  const value = `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return { value, display: `${hour12}:${String(minute).padStart(2, '0')} ${suffix}` };
}

/**
 * Parse a loosely-typed time. Accepts 6, 6p, 6pm, 6 PM, 630pm, 6:00pm,
 * 6:30 p.m., 18:00 and 1800. Returns null for anything that is not a time.
 */
export function parseTimeToken(input) {
  if (typeof input !== 'string') return null;
  // Lowercase and drop the dots in 'p.m.' so one regex covers every spelling.
  const raw = input.trim().toLowerCase().replace(/\./g, '');
  if (!raw) return null;

  const meridiem = raw.match(MERIDIEM_RE);
  if (meridiem) {
    const hour = Number(meridiem[1]);
    const minute = meridiem[2] ? Number(meridiem[2]) : 0;
    // A meridiem forces a 12-hour reading, so '13pm' and '0pm' are not times.
    if (hour < 1 || hour > 12) return null;
    const isPm = meridiem[3] === 'p';
    const hour24 = isPm ? (hour === 12 ? 12 : hour + 12) : (hour === 12 ? 0 : hour);
    return buildTime(hour24, minute);
  }

  const colon = raw.match(COLON_RE);
  if (colon) {
    const hour = Number(colon[1]);
    if (hour > 23) return null;
    return buildTime(disambiguateBareHour(hour), Number(colon[2]));
  }

  const compact = raw.match(COMPACT_RE);
  if (compact) {
    const digits = compact[1];
    const hour = Number(digits.slice(0, digits.length - 2));
    if (hour > 23) return null;
    return buildTime(disambiguateBareHour(hour), Number(digits.slice(-2)));
  }

  const bare = raw.match(BARE_HOUR_RE);
  if (bare) {
    const hour = Number(bare[1]);
    if (hour > 23) return null;
    return buildTime(disambiguateBareHour(hour), 0);
  }

  return null;
}

/** Minutes since midnight for a sheet time string, or null if it is not one. */
function timeToMinutes(text) {
  const parsed = parseTimeToken(text);
  if (!parsed) return null;
  const [h, m] = parsed.value.split(':');
  return Number(h) * 60 + Number(m);
}

const cellKeyOf = (rowId, colId) => `${rowId}:${colId}`;

function textOfCell(cell) {
  return ((cell && cell.segments) || [])
    .filter((s) => s.type === 'text')
    .map((s) => s.text)
    .join(' ')
    .trim() || null;
}

/**
 * Same person tagged in two columns whose Begins-Ends windows overlap ->
 * a soft warning on those chips (never a block; a floater covering two posts
 * is legitimate).
 *
 * Shared by SchedulingSheetGrid (on-screen chips) and schedulingSheetPdf (the
 * printed sheet) so both surface the same warnings from one definition.
 */
export function computeDoubleBookedEmails(day) {
  const rowIdByLabel = {};
  for (const r of day.rows || []) rowIdByLabel[(r.label || '').toLowerCase()] = r.id;
  const beginsRow = rowIdByLabel['begins'];
  const endsRow = rowIdByLabel['ends'];
  if (!beginsRow || !endsRow) return new Set();

  const windows = {}; // email -> [{begins, ends, colId}]
  for (const col of day.columns || []) {
    // Compare on parsed minutes, never on the raw strings: a sheet legitimately
    // mixes '6:00 PM' with a legacy '18:00', and lexical order gets that wrong
    // ('6:00 PM' < '18:00' is false), silently missing a real double-booking.
    const begins = timeToMinutes(textOfCell((day.cells || {})[cellKeyOf(beginsRow, col.id)]));
    const ends = timeToMinutes(textOfCell((day.cells || {})[cellKeyOf(endsRow, col.id)]));
    if (begins === null || ends === null) continue;
    for (const key of Object.keys(day.cells || {})) {
      const [, colId] = key.split(':');
      if (colId !== col.id) continue;
      for (const seg of (day.cells[key].segments || [])) {
        if (seg.type === 'person' && seg.email) {
          (windows[seg.email] = windows[seg.email] || []).push({ begins, ends, colId: col.id });
        }
      }
    }
  }

  const flagged = new Set();
  for (const email of Object.keys(windows)) {
    const list = windows[email];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (list[i].colId === list[j].colId) continue;
        if (list[i].begins < list[j].ends && list[j].begins < list[i].ends) flagged.add(email);
      }
    }
  }
  return flagged;
}
