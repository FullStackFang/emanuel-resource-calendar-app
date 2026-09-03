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
    const begins = textOfCell((day.cells || {})[cellKeyOf(beginsRow, col.id)]);
    const ends = textOfCell((day.cells || {})[cellKeyOf(endsRow, col.id)]);
    if (!begins || !ends) continue;
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
