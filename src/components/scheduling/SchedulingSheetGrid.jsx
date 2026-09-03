// src/components/scheduling/SchedulingSheetGrid.jsx
//
// The day-sheet grid: events/posts as columns, freeform rows (the five seeded
// starter rows are ordinary rows with a tinted band), cells of text + chips.
// Frozen label column + sticky header row inside an overflow-x container —
// the page body never scrolls horizontally.
//
// Event-linked columns carry an immutable link-time snapshot; this component
// COMPARES live data against the snapshot and flags drift, but never applies
// it — 'Refresh from event' is the only path that updates the snapshot
// (design D6: call/door times are operational overrides; silent live-update
// is wrong, silence is worse).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import SheetCellEditor from './SheetCellEditor';
import InlineCellEditor from './InlineCellEditor';
import {
  toLocationNameArray,
  computeDoubleBookedEmails,
  customRowsOf,
  moveArrayItem,
  moveArrayItemBy,
  reorderArrayItem,
  moveCustomRowBy,
  moveCustomRowTo,
  reorderCustomRows,
  parseTimeToken,
} from './sheetEventUtils';

const newId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`;

const cellKeyOf = (rowId, colId) => `${rowId}:${colId}`;

const MATCH_CAP = 5;

/** "Thu, Sep 11 · 18:00–21:00" for an event-mention picker row. */
function formatEventWhen(event) {
  const parts = [];
  if (event.date) {
    try {
      parts.push(new Date(`${event.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }));
    } catch { /* unparseable date — omit */ }
  }
  if (event.startTime) parts.push(event.endTime ? `${event.startTime}–${event.endTime}` : event.startTime);
  return parts.join(' · ');
}

/** The immutable link-time snapshot stored on a column (server whitelists this shape). */
function snapshotOf(event) {
  return {
    eventId: String(event.id),
    linkedAt: new Date().toISOString(),
    snapshot: {
      title: event.title || null,
      startDateTime: event.startDateTime || null,
      endDateTime: event.endDateTime || null,
      locationNames: toLocationNameArray(event.locationNames),
    },
  };
}

// Starter rows an event link can prefill, matched by label (case-insensitive) so
// a renamed or deleted starter row simply opts out of prefill.
const STARTER_PREFILL = [
  { label: 'location', kind: 'locations' },
  { label: 'call time', field: 'setupTime' },
  { label: 'doors open', field: 'doorOpenTime' },
  { label: 'begins', field: 'startTime' },
  { label: 'ends', field: 'endTime' },
];

/**
 * Cell writes to prefill a column from a just-linked event. Only fills cells
 * that are currently EMPTY — linking never clobbers entered values (same
 * stance as the drift flag: event data is sugar, the sheet is the artifact).
 * Location names are matched against the locations list to carry real ids;
 * unmatched names still become chips with locationId null.
 */
function buildPrefillCells(event, colId, day, locations) {
  const rowIdByLabel = {};
  for (const r of day.rows || []) rowIdByLabel[(r.label || '').toLowerCase()] = r.id;
  const writes = [];
  for (const spec of STARTER_PREFILL) {
    const rowId = rowIdByLabel[spec.label];
    if (!rowId) continue;
    const existing = (day.cells || {})[cellKeyOf(rowId, colId)];
    if (existing && existing.segments && existing.segments.length) continue;
    if (spec.kind === 'locations') {
      const names = toLocationNameArray(event.locationNames);
      if (!names.length) continue;
      const segments = names.map((name) => {
        const match = (locations || []).find((l) => (l.displayName || '').toLowerCase() === name.toLowerCase());
        return { type: 'location', locationId: match ? String(match._id) : null, name };
      });
      writes.push({ rowId, colId, cell: { segments, note: null } });
    } else if (event[spec.field]) {
      // Event times arrive as 24h HH:MM. Normalize through the same parser the
      // cell editor uses so a prefilled row and a hand-typed one never disagree.
      const parsed = parseTimeToken(event[spec.field]);
      const text = parsed ? parsed.display : event[spec.field];
      writes.push({ rowId, colId, cell: { segments: [{ type: 'text', text }], note: null } });
    }
  }
  return writes;
}

/**
 * The dropdown behind '@' in a column-name input: published events near this
 * day, each with its date and time range so same-named services on adjacent
 * days are tellable apart. onMouseDown is swallowed so picking wins the race
 * against the input's blur.
 */
function EventMentionList({ term, events, onPick }) {
  const q = term.trim().toLowerCase();
  const matches = q ? (events || []).filter((e) => (e.title || '').toLowerCase().includes(q)) : (events || []);
  return (
    <div className="ss-picker ss-event-picker" data-testid="event-mention-picker" onMouseDown={(e) => e.preventDefault()}>
      {matches.slice(0, MATCH_CAP).map((e) => (
        <button key={e.id} type="button" className="ss-picker-row" data-testid={`event-option-${e.id}`} onClick={() => onPick(e)}>
          <span className="ss-picker-name">{e.title}</span>
          <span className="ss-picker-sub">{formatEventWhen(e)}</span>
        </button>
      ))}
      {matches.length > MATCH_CAP && (
        <div className="ss-picker-overflow">{matches.length - MATCH_CAP} more. Keep typing&hellip;</div>
      )}
      {matches.length === 0 && (
        <div className="ss-picker-overflow">No published events near this day match.</div>
      )}
    </div>
  );
}

function CellContent({ cell, doubleBooked }) {
  if (!cell || !cell.segments || cell.segments.length === 0) {
    return <span className="ss-cell-empty" aria-hidden="true" />;
  }
  return (
    <>
      {cell.segments.map((seg, i) => {
        if (seg.type === 'text') {
          return <span key={i} className="ss-chip ss-chip-text" data-testid="grid-chip-text">{seg.text}</span>;
        }
        if (seg.type === 'location') {
          return <span key={i} className="ss-chip ss-chip-location"><span aria-hidden="true">&#128205;</span> {seg.name}</span>;
        }
        const kind = seg.placeholder ? 'placeholder' : seg.userId ? 'user' : 'external';
        const warned = seg.email && doubleBooked.has(seg.email);
        return (
          <span key={i} className={`ss-chip ss-chip-${kind}`} data-testid={`grid-chip-${kind}`}>
            {kind === 'user' && <span className="ss-chip-glyph" aria-hidden="true">&#9673;</span>}
            {seg.name}
            {seg.callTimeOverride && <span className="ss-chip-calltime">{seg.callTimeOverride}</span>}
            {warned && (
              <span className="ss-chip-warn" data-testid="double-booking-warning"
                title="This person is also assigned to another post whose times overlap">
                &#9888;
              </span>
            )}
            {kind === 'placeholder' && <span className="ss-chip-sub">unassigned</span>}
          </span>
        );
      })}
    </>
  );
}

export default function SchedulingSheetGrid({
  day,
  canEdit,
  people,
  locations,
  publishedEvents,
  liveEventsById,
  onCellSave,
  onStructure,
  onRefreshPeople,
}) {
  // Two DISTINCT cell states. Collapsing them makes arrow-key navigation
  // impossible to express, because an editing cell needs its arrows for the
  // text caret. `focusedCell` is where the keyboard is; `editingCell` is the
  // one cell (if any) currently open for entry.
  const [focusedCell, setFocusedCell] = useState(null);   // { rowId, colId }
  const [editingCell, setEditingCell] = useState(null);   // { rowId, colId, initialInput }
  const [expandedCell, setExpandedCell] = useState(null); // { rowId, colId } — the modal
  const [openNoteKey, setOpenNoteKey] = useState(null);
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [addingColumnSubmitting, setAddingColumnSubmitting] = useState(false);
  const [newRowLabel, setNewRowLabel] = useState('');
  const [renaming, setRenaming] = useState(null); // { kind: 'row'|'column', id, value }
  const [confirmDelete, setConfirmDelete] = useState(null); // { kind, id }
  const [dragState, setDragState] = useState(null); // { kind: 'column'|'row', id }
  const [dropTarget, setDropTarget] = useState(null); // { kind: 'column'|'row', id }
  const [openMoveMenu, setOpenMoveMenu] = useState(null); // { kind: 'column'|'row', id }

  const doubleBooked = useMemo(() => computeDoubleBookedEmails(day), [day]);

  const starterRows = (day.rows || []).filter((r) => r.kind === 'starter');
  const customRows = customRowsOf(day.rows);
  const orderedRows = [...starterRows, ...customRows];

  // ── In-cell editing ──────────────────────────────────────────────────────

  const cellRefs = useRef({});
  const editingCellRef = useRef(null); // the anchor the suggestion list positions from

  const columnIds = (day.columns || []).map((c) => c.id);
  const rowIds = orderedRows.map((r) => r.id);

  /**
   * The neighbouring cell in one direction, or the same cell at an edge.
   * Enter at the last row and Tab at the last column deliberately STOP rather
   * than wrap — wrapping moves the user somewhere they did not ask to go.
   */
  const neighbourOf = ({ rowId, colId }, direction) => {
    const r = rowIds.indexOf(rowId);
    const c = columnIds.indexOf(colId);
    if (r === -1 || c === -1) return { rowId, colId };
    const dr = direction === 'down' ? 1 : direction === 'up' ? -1 : 0;
    const dc = direction === 'right' ? 1 : direction === 'left' ? -1 : 0;
    const nr = Math.min(Math.max(r + dr, 0), rowIds.length - 1);
    const nc = Math.min(Math.max(c + dc, 0), columnIds.length - 1);
    return { rowId: rowIds[nr], colId: columnIds[nc] };
  };

  // Focus follows the focused cell whenever no cell is being edited — one
  // effect covers arrow moves, commit-and-advance, and Escape alike.
  useEffect(() => {
    if (!canEdit || !focusedCell || editingCell) return;
    const el = cellRefs.current[cellKeyOf(focusedCell.rowId, focusedCell.colId)];
    if (el) el.focus();
  }, [canEdit, focusedCell, editingCell]);

  const startEditing = (rowId, colId, initialInput = '') => {
    if (!canEdit) return;
    setFocusedCell({ rowId, colId });
    setEditingCell({ rowId, colId, initialInput });
    // Refresh the people directory on open — a tab held open across a backend
    // restart otherwise keeps a stale page-load snapshot, silently hiding
    // new/late users.
    if (onRefreshPeople) onRefreshPeople();
  };

  const commitEditingCell = (cell, advance) => {
    if (!editingCell) return;
    const { rowId, colId } = editingCell;
    onCellSave(rowId, colId, cell);
    setEditingCell(null);
    setFocusedCell(advance ? neighbourOf({ rowId, colId }, advance) : { rowId, colId });
  };

  const handleCellKeyDown = (e, rowId, colId) => {
    if (!canEdit) return;
    const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (ARROWS[e.key]) {
      e.preventDefault();
      setFocusedCell(neighbourOf({ rowId, colId }, ARROWS[e.key]));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      startEditing(rowId, colId);
      return;
    }
    // Any printable character starts editing seeded with it, so a column of
    // times can be entered without a separate keystroke per cell.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      startEditing(rowId, colId, e.key);
    }
  };

  const moveColumnBy = (id, delta) => {
    const next = moveArrayItemBy(day.columns || [], id, delta);
    if (next !== day.columns) onStructure({ columns: next });
    setOpenMoveMenu(null);
  };
  const moveColumnTo = (id, toIndex) => {
    const next = moveArrayItem(day.columns || [], id, toIndex);
    if (next !== day.columns) onStructure({ columns: next });
    setOpenMoveMenu(null);
  };
  const dropColumn = (targetId) => {
    if (!dragState || dragState.kind !== 'column') return;
    const next = reorderArrayItem(day.columns || [], dragState.id, targetId);
    if (next !== day.columns) onStructure({ columns: next });
    setDragState(null);
    setDropTarget(null);
  };

  const moveRowBy = (id, delta) => {
    const next = moveCustomRowBy(day.rows || [], id, delta);
    if (next !== day.rows) onStructure({ rows: next });
    setOpenMoveMenu(null);
  };
  const moveRowTo = (id, toIndex) => {
    const next = moveCustomRowTo(day.rows || [], id, toIndex);
    if (next !== day.rows) onStructure({ rows: next });
    setOpenMoveMenu(null);
  };
  const dropRow = (targetId) => {
    if (!dragState || dragState.kind !== 'row') return;
    const next = reorderCustomRows(day.rows || [], dragState.id, targetId);
    if (next !== day.rows) onStructure({ rows: next });
    setDragState(null);
    setDropTarget(null);
  };

  const linkStatus = (col) => {
    if (!col.linkedEvent) return null;
    const live = liveEventsById && liveEventsById.get(String(col.linkedEvent.eventId));
    if (!live) return { state: 'missing' };
    const snap = col.linkedEvent.snapshot || {};
    const drifted =
      (snap.title && live.title && snap.title !== live.title) ||
      (snap.startDateTime && live.startDateTime && snap.startDateTime !== live.startDateTime) ||
      (snap.endDateTime && live.endDateTime && snap.endDateTime !== live.endDateTime);
    return { state: drifted ? 'drift' : 'linked', live };
  };

  const refreshLink = (col) => {
    const status = linkStatus(col);
    if (!status || !status.live) return;
    const live = status.live;
    onStructure({
      columns: (day.columns || []).map((c) =>
        c.id === col.id
          ? {
              ...c,
              name: live.title || c.name,
              linkedEvent: {
                eventId: c.linkedEvent.eventId,
                linkedAt: new Date().toISOString(),
                snapshot: {
                  title: live.title || null,
                  startDateTime: live.startDateTime || null,
                  endDateTime: live.endDateTime || null,
                  locationNames: live.locationNames || [],
                },
              },
            }
          : c
      ),
    });
  };

  // Shared by the Cancel button, the backdrop click, and Esc — a no-op while
  // a save is in flight (matches the disabled Cancel button below).
  const closeAddColumnForm = () => {
    if (addingColumnSubmitting) return;
    setAddingColumn(false);
    setNewColumnName('');
  };

  // Adding a column is a real network round-trip (no optimistic update), so
  // the form stays open and disabled — not blank — until it settles: closes
  // on success, re-enables (typed name intact) to retry on failure.
  const addFreeColumn = () => {
    const name = newColumnName.trim() || 'New post';
    const column = { id: newId(), name, linkedEvent: null };
    setAddingColumnSubmitting(true);
    onStructure({ columns: [...(day.columns || []), column] }, undefined, {
      onSuccess: () => { setAddingColumn(false); setNewColumnName(''); setAddingColumnSubmitting(false); },
      onError: () => setAddingColumnSubmitting(false),
    });
  };

  // '@event' in the add-column input: one gesture creates the linked column AND
  // prefills the starter rows (Location as chips, Call Time/Doors Open/Begins/
  // Ends as text) from the event — all empty by definition on a new column.
  const linkNewColumn = (event) => {
    const column = { id: newId(), name: event.title || 'Linked event', linkedEvent: snapshotOf(event) };
    const prefills = buildPrefillCells(event, column.id, day, locations);
    setAddingColumnSubmitting(true);
    onStructure({ columns: [...(day.columns || []), column] }, prefills, {
      onSuccess: () => { setAddingColumn(false); setNewColumnName(''); setAddingColumnSubmitting(false); },
      onError: () => setAddingColumnSubmitting(false),
    });
  };

  // '@event' while renaming an existing column: link (or relink) it in place.
  // Prefill fills only cells that are still empty — entered values are kept.
  const linkExistingColumn = (colId, event) => {
    const prefills = buildPrefillCells(event, colId, day, locations);
    onStructure(
      {
        columns: (day.columns || []).map((c) =>
          c.id === colId ? { ...c, name: event.title || c.name, linkedEvent: snapshotOf(event) } : c
        ),
      },
      prefills
    );
    setRenaming(null);
  };

  const addRow = () => {
    if (!newRowLabel.trim()) return;
    onStructure({ rows: [...(day.rows || []), { id: newId(), label: newRowLabel.trim(), kind: 'custom' }] });
    setNewRowLabel('');
  };

  const commitRename = () => {
    if (!renaming) return;
    const value = renaming.value.trim();
    // A column name starting with '@' is mention mode, not a name — picking
    // from the list commits; blur/Enter without a pick just cancels.
    if (renaming.kind === 'column' && value.startsWith('@')) {
      setRenaming(null);
      return;
    }
    if (value) {
      if (renaming.kind === 'row') {
        onStructure({ rows: (day.rows || []).map((r) => (r.id === renaming.id ? { ...r, label: value } : r)) });
      } else {
        onStructure({ columns: (day.columns || []).map((c) => (c.id === renaming.id ? { ...c, name: value } : c)) });
      }
    }
    setRenaming(null);
  };

  const deleteTarget = (kind, id) => {
    if (!confirmDelete || confirmDelete.kind !== kind || confirmDelete.id !== id) {
      setConfirmDelete({ kind, id });
      return;
    }
    if (kind === 'row') onStructure({ rows: (day.rows || []).filter((r) => r.id !== id) });
    else onStructure({ columns: (day.columns || []).filter((c) => c.id !== id) });
    setConfirmDelete(null);
  };

  return (
    <div className="ss-grid-scroll" data-testid="sheet-grid">
      <table className="ss-grid">
        <thead>
          <tr>
            <th className="ss-corner">rows &darr; &middot; columns &rarr;</th>
            {(day.columns || []).map((col, colIndex) => {
              const status = linkStatus(col);
              const columnCount = (day.columns || []).length;
              const isDragging = dragState && dragState.kind === 'column' && dragState.id === col.id;
              const isDropTarget = dropTarget && dropTarget.kind === 'column' && dropTarget.id === col.id;
              const menuOpen = openMoveMenu && openMoveMenu.kind === 'column' && openMoveMenu.id === col.id;
              return (
                <th
                  key={col.id}
                  className={`ss-col-header${isDragging ? ' ss-dragging' : ''}${isDropTarget ? ' ss-drop-target' : ''}`}
                  data-testid={`column-header-${col.id}`}
                  onDragOver={canEdit ? (e) => {
                    if (!dragState || dragState.kind !== 'column') return;
                    e.preventDefault();
                    setDropTarget({ kind: 'column', id: col.id });
                  } : undefined}
                  onDragLeave={canEdit ? () => setDropTarget((dt) => (dt && dt.kind === 'column' && dt.id === col.id ? null : dt)) : undefined}
                  onDrop={canEdit ? (e) => { e.preventDefault(); dropColumn(col.id); } : undefined}
                >
                  {canEdit && (
                    <span className="ss-reorder-wrap">
                      <button
                        type="button"
                        className="ss-drag-handle"
                        data-testid={`column-drag-handle-${col.id}`}
                        draggable
                        onDragStart={(e) => {
                          setDragState({ kind: 'column', id: col.id });
                          if (e.dataTransfer) {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', col.id);
                          }
                        }}
                        onDragEnd={() => { setDragState(null); setDropTarget(null); }}
                        onClick={() => setOpenMoveMenu((m) => (m && m.kind === 'column' && m.id === col.id ? null : { kind: 'column', id: col.id }))}
                        title="Drag to reorder, or click for move options"
                        aria-label={`Reorder ${col.name || 'column'}`}
                      >
                        <span aria-hidden="true">&#8942;&#8942;</span>
                      </button>
                      {menuOpen && (
                        <div className="ss-move-menu" data-testid={`column-move-menu-${col.id}`}>
                          <button type="button" onClick={() => moveColumnBy(col.id, -1)} disabled={colIndex === 0}>Move left</button>
                          <button type="button" onClick={() => moveColumnBy(col.id, 1)} disabled={colIndex === columnCount - 1}>Move right</button>
                          <button type="button" onClick={() => moveColumnTo(col.id, 0)} disabled={colIndex === 0}>Move to start</button>
                          <button type="button" onClick={() => moveColumnTo(col.id, columnCount - 1)} disabled={colIndex === columnCount - 1}>Move to end</button>
                        </div>
                      )}
                    </span>
                  )}
                  {renaming && renaming.kind === 'column' && renaming.id === col.id ? (
                    <span className="ss-mention-anchor">
                      <input
                        className="ss-rename-input"
                        value={renaming.value}
                        autoFocus
                        onChange={(e) => setRenaming((r) => ({ ...r, value: e.target.value }))}
                        onBlur={commitRename}
                        onKeyDown={(e) => e.key === 'Enter' && commitRename()}
                        placeholder="Name, or @ to link an event"
                      />
                      {renaming.value.startsWith('@') && (
                        <EventMentionList
                          term={renaming.value.slice(1)}
                          events={publishedEvents}
                          onPick={(event) => linkExistingColumn(col.id, event)}
                        />
                      )}
                    </span>
                  ) : (
                    <span
                      className="ss-col-name"
                      onDoubleClick={() => canEdit && setRenaming({ kind: 'column', id: col.id, value: col.name })}
                    >
                      {col.name}
                    </span>
                  )}
                  {status && status.state === 'linked' && (
                    <span className="ss-link-chip" title="Linked to a published calendar event (prefill only — nothing writes back)">
                      linked event
                    </span>
                  )}
                  {status && status.state === 'drift' && (
                    <span className="ss-link-chip ss-link-drift" data-testid={`link-drift-${col.id}`}
                      title="The linked event changed after this column was set up. Cells keep their entered values.">
                      changed since linked
                      {canEdit && (
                        <button type="button" className="ss-link-refresh" onClick={() => refreshLink(col)}>
                          Refresh from event
                        </button>
                      )}
                    </span>
                  )}
                  {status && status.state === 'missing' && (
                    <span className="ss-link-chip ss-link-missing" data-testid={`link-missing-${col.id}`}
                      title="The linked event no longer exists. The column keeps working.">
                      event no longer exists
                    </span>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      className={`ss-mini-delete ${confirmDelete && confirmDelete.kind === 'column' && confirmDelete.id === col.id ? 'confirm' : ''}`}
                      onClick={() => deleteTarget('column', col.id)}
                      title="Delete this column"
                    >
                      {confirmDelete && confirmDelete.kind === 'column' && confirmDelete.id === col.id ? 'Confirm?' : '×'}
                    </button>
                  )}
                </th>
              );
            })}
            {canEdit && (
              <th className="ss-add-col">
                <button
                  type="button"
                  className="ss-add-btn"
                  data-testid="add-column-button"
                  onClick={() => setAddingColumn(true)}
                >
                  + column
                </button>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {orderedRows.map((row) => {
            const isCustom = row.kind !== 'starter';
            const customIndex = isCustom ? customRows.findIndex((r) => r.id === row.id) : -1;
            const isDragging = dragState && dragState.kind === 'row' && dragState.id === row.id;
            const isDropTarget = dropTarget && dropTarget.kind === 'row' && dropTarget.id === row.id;
            const menuOpen = openMoveMenu && openMoveMenu.kind === 'row' && openMoveMenu.id === row.id;
            return (
            <tr
              key={row.id}
              className={`${row.kind === 'starter' ? 'ss-row-starter' : 'ss-row-custom'}${isDragging ? ' ss-dragging' : ''}${isDropTarget ? ' ss-drop-target' : ''}`}
            >
              <th
                className="ss-row-label"
                data-testid={`row-label-${row.id}`}
                onDragOver={canEdit && isCustom ? (e) => {
                  if (!dragState || dragState.kind !== 'row') return;
                  e.preventDefault();
                  setDropTarget({ kind: 'row', id: row.id });
                } : undefined}
                onDragLeave={canEdit && isCustom ? () => setDropTarget((dt) => (dt && dt.kind === 'row' && dt.id === row.id ? null : dt)) : undefined}
                onDrop={canEdit && isCustom ? (e) => { e.preventDefault(); dropRow(row.id); } : undefined}
              >
                {canEdit && isCustom && (
                  <span className="ss-reorder-wrap">
                    <button
                      type="button"
                      className="ss-drag-handle"
                      data-testid={`row-drag-handle-${row.id}`}
                      draggable
                      onDragStart={(e) => {
                        setDragState({ kind: 'row', id: row.id });
                        if (e.dataTransfer) {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', row.id);
                        }
                      }}
                      onDragEnd={() => { setDragState(null); setDropTarget(null); }}
                      onClick={() => setOpenMoveMenu((m) => (m && m.kind === 'row' && m.id === row.id ? null : { kind: 'row', id: row.id }))}
                      title="Drag to reorder, or click for move options"
                      aria-label={`Reorder ${row.label || 'row'}`}
                    >
                      <span aria-hidden="true">&#8942;&#8942;</span>
                    </button>
                    {menuOpen && (
                      <div className="ss-move-menu" data-testid={`row-move-menu-${row.id}`}>
                        <button type="button" onClick={() => moveRowBy(row.id, -1)} disabled={customIndex <= 0}>Move up</button>
                        <button type="button" onClick={() => moveRowBy(row.id, 1)} disabled={customIndex === customRows.length - 1}>Move down</button>
                        <button type="button" onClick={() => moveRowTo(row.id, 0)} disabled={customIndex <= 0}>Move to top</button>
                        <button type="button" onClick={() => moveRowTo(row.id, customRows.length - 1)} disabled={customIndex === customRows.length - 1}>Move to bottom</button>
                      </div>
                    )}
                  </span>
                )}
                {renaming && renaming.kind === 'row' && renaming.id === row.id ? (
                  <input
                    className="ss-rename-input"
                    value={renaming.value}
                    autoFocus
                    onChange={(e) => setRenaming((r) => ({ ...r, value: e.target.value }))}
                    onBlur={commitRename}
                    onKeyDown={(e) => e.key === 'Enter' && commitRename()}
                  />
                ) : (
                  <span
                    onDoubleClick={() => canEdit && setRenaming({ kind: 'row', id: row.id, value: row.label })}
                    title={row.kind === 'starter' ? 'A starter row — rename or delete it like any other row' : undefined}
                  >
                    {row.label}
                  </span>
                )}
                {canEdit && (
                  <button
                    type="button"
                    className={`ss-mini-delete ${confirmDelete && confirmDelete.kind === 'row' && confirmDelete.id === row.id ? 'confirm' : ''}`}
                    onClick={() => deleteTarget('row', row.id)}
                    title="Delete this row"
                  >
                    {confirmDelete && confirmDelete.kind === 'row' && confirmDelete.id === row.id ? 'Confirm?' : '×'}
                  </button>
                )}
              </th>
              {(day.columns || []).map((col) => {
                const key = cellKeyOf(row.id, col.id);
                const cell = (day.cells || {})[key];
                const isEditing = !!editingCell && editingCell.rowId === row.id && editingCell.colId === col.id;
                const isFocused = !!focusedCell && focusedCell.rowId === row.id && focusedCell.colId === col.id;
                return (
                  <td
                    key={col.id}
                    ref={(el) => {
                      cellRefs.current[key] = el;
                      if (isEditing) editingCellRef.current = el;
                    }}
                    className={`ss-cell ${canEdit ? 'editable' : ''}${isFocused && !isEditing ? ' ss-cell-focused' : ''}${isEditing ? ' ss-cell-editing' : ''}`}
                    data-testid={`cell-${key}`}
                    tabIndex={canEdit ? 0 : undefined}
                    onKeyDown={canEdit && !isEditing ? (e) => handleCellKeyDown(e, row.id, col.id) : undefined}
                    onClick={canEdit && !isEditing ? () => startEditing(row.id, col.id) : undefined}
                  >
                    {isEditing ? (
                      <InlineCellEditor
                        cell={cell || null}
                        people={people}
                        locations={locations}
                        anchorRef={editingCellRef}
                        initialInput={editingCell.initialInput}
                        onCommit={commitEditingCell}
                        onCancel={() => setEditingCell(null)}
                      />
                    ) : (
                      <CellContent cell={cell} doubleBooked={doubleBooked} />
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        className="ss-cell-expand"
                        data-testid={`cell-expand-${key}`}
                        title="Open the full editor — notes and per-person call times"
                        aria-label="Open the full cell editor"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedCell({ rowId: row.id, colId: col.id });
                        }}
                      >
                        <span aria-hidden="true">&#8599;</span>
                      </button>
                    )}
                    {cell && cell.note && (
                      <button
                        type="button"
                        className="ss-note-marker"
                        data-testid={`note-marker-${key}`}
                        title="This cell has a note"
                        onClick={(e) => { e.stopPropagation(); setOpenNoteKey(openNoteKey === key ? null : key); }}
                      />
                    )}
                    {openNoteKey === key && cell && cell.note && (
                      <div className="ss-note-popover" data-testid={`note-popover-${key}`} onClick={(e) => e.stopPropagation()}>
                        <p>{cell.note.text}</p>
                        {cell.note.authorName && <span className="ss-note-meta">{cell.note.authorName}</span>}
                      </div>
                    )}
                  </td>
                );
              })}
              {canEdit && <td className="ss-cell ss-cell-spacer" />}
            </tr>
            );
          })}
          {canEdit && (
            <tr className="ss-add-row">
              <th className="ss-row-label">
                <input
                  data-testid="add-row-input"
                  placeholder="+ Add row"
                  value={newRowLabel}
                  onChange={(e) => setNewRowLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addRow()}
                />
              </th>
              <td className="ss-add-row-hint" colSpan={(day.columns || []).length + 1}>
                Cells take free text; @ tags a person or location. In a column name, @ links an event.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* The EXPANDED editor: reached by the explicit affordance on a cell, and
          still the only place a cell note is edited. */}
      {canEdit && expandedCell && (
        <SheetCellEditor
          cell={(day.cells || {})[cellKeyOf(expandedCell.rowId, expandedCell.colId)] || null}
          people={people}
          locations={locations}
          onClose={() => setExpandedCell(null)}
          onSave={(cell) => {
            onCellSave(expandedCell.rowId, expandedCell.colId, cell);
            setExpandedCell(null);
          }}
        />
      )}

      {addingColumn && (
        <div className="ss-editor-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closeAddColumnForm(); }}>
          <div className="ss-panel" role="dialog" aria-label="Add column" data-testid="add-column-form">
            <h3>Add a column</h3>
            <p className="ss-panel-hint">
              Name a free-standing post, or type @ to link a published event — it prefills Location, Call Time,
              Doors Open, Begins, and Ends automatically. Nothing writes back to the calendar.
            </p>
            <span className="ss-mention-anchor" style={{ display: 'block' }}>
              <input
                className="ss-add-col-input"
                data-testid="add-column-input"
                placeholder="Post name — @ links an event"
                value={newColumnName}
                autoFocus
                disabled={addingColumnSubmitting}
                onChange={(e) => setNewColumnName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    closeAddColumnForm();
                    return;
                  }
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  if (newColumnName.startsWith('@')) {
                    const q = newColumnName.slice(1).trim().toLowerCase();
                    const first = (publishedEvents || []).find((ev) => !q || (ev.title || '').toLowerCase().includes(q));
                    if (first) linkNewColumn(first);
                  } else {
                    addFreeColumn();
                  }
                }}
              />
              {!addingColumnSubmitting && newColumnName.startsWith('@') && (
                <EventMentionList
                  term={newColumnName.slice(1)}
                  events={publishedEvents}
                  onPick={linkNewColumn}
                />
              )}
            </span>
            <div className="ss-editor-actions">
              <button type="button" className="ss-ghost-btn" disabled={addingColumnSubmitting} onClick={closeAddColumnForm}>
                Cancel
              </button>
              <button
                type="button"
                className="ss-primary-btn"
                onClick={addFreeColumn}
                disabled={newColumnName.startsWith('@') || addingColumnSubmitting}
              >
                {addingColumnSubmitting ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
