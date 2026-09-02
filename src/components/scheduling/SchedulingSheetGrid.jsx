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

import React, { useMemo, useState } from 'react';
import SheetCellEditor from './SheetCellEditor';

const newId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`;

const cellKeyOf = (rowId, colId) => `${rowId}:${colId}`;

function textOfCell(cell) {
  return ((cell && cell.segments) || [])
    .filter((s) => s.type === 'text')
    .map((s) => s.text)
    .join(' ')
    .trim() || null;
}

/**
 * Same person tagged in two columns whose Begins–Ends windows overlap →
 * a soft warning on those chips (never a block; a floater covering two posts
 * is legitimate).
 */
function computeDoubleBookedEmails(day) {
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

function CellContent({ cell, doubleBooked }) {
  if (!cell || !cell.segments || cell.segments.length === 0) {
    return <span className="ss-cell-empty" aria-hidden="true" />;
  }
  return (
    <>
      {cell.segments.map((seg, i) => {
        if (seg.type === 'text') return <span key={i} className="ss-cell-text">{seg.text}</span>;
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
}) {
  const [editingCell, setEditingCell] = useState(null); // { rowId, colId }
  const [openNoteKey, setOpenNoteKey] = useState(null);
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [newColumnLink, setNewColumnLink] = useState('');
  const [newRowLabel, setNewRowLabel] = useState('');
  const [renaming, setRenaming] = useState(null); // { kind: 'row'|'column', id, value }
  const [confirmDelete, setConfirmDelete] = useState(null); // { kind, id }

  const doubleBooked = useMemo(() => computeDoubleBookedEmails(day), [day]);

  const starterRows = (day.rows || []).filter((r) => r.kind === 'starter');
  const customRows = (day.rows || []).filter((r) => r.kind !== 'starter');
  const orderedRows = [...starterRows, ...customRows];

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

  const addColumn = () => {
    const linked = publishedEvents && publishedEvents.find((e) => String(e.id) === newColumnLink);
    const name = newColumnName.trim() || (linked && linked.title) || 'New post';
    const column = {
      id: newId(),
      name,
      linkedEvent: linked
        ? {
            eventId: String(linked.id),
            linkedAt: new Date().toISOString(),
            snapshot: {
              title: linked.title || null,
              startDateTime: linked.startDateTime || null,
              endDateTime: linked.endDateTime || null,
              locationNames: linked.locationNames || [],
            },
          }
        : null,
    };
    onStructure({ columns: [...(day.columns || []), column] });
    setAddingColumn(false);
    setNewColumnName('');
    setNewColumnLink('');
  };

  const addRow = () => {
    if (!newRowLabel.trim()) return;
    onStructure({ rows: [...(day.rows || []), { id: newId(), label: newRowLabel.trim(), kind: 'custom' }] });
    setNewRowLabel('');
  };

  const commitRename = () => {
    if (!renaming) return;
    const value = renaming.value.trim();
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
            {(day.columns || []).map((col) => {
              const status = linkStatus(col);
              return (
                <th key={col.id} className="ss-col-header" data-testid={`column-header-${col.id}`}>
                  {renaming && renaming.kind === 'column' && renaming.id === col.id ? (
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
                {addingColumn ? (
                  <div className="ss-add-col-form" data-testid="add-column-form">
                    <input
                      placeholder="Column name"
                      value={newColumnName}
                      autoFocus
                      onChange={(e) => setNewColumnName(e.target.value)}
                    />
                    <select
                      data-testid="add-column-link"
                      value={newColumnLink}
                      onChange={(e) => setNewColumnLink(e.target.value)}
                      title="Optionally link a published event — prefills name and times; nothing writes back to the calendar"
                    >
                      <option value="">Free-standing (no linked event)</option>
                      {(publishedEvents || []).map((e) => (
                        <option key={String(e.id)} value={String(e.id)}>{e.title}</option>
                      ))}
                    </select>
                    <div className="ss-add-col-actions">
                      <button type="button" className="ss-primary-btn" onClick={addColumn}>Add</button>
                      <button type="button" className="ss-ghost-btn" onClick={() => setAddingColumn(false)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="ss-add-btn" data-testid="add-column-button" onClick={() => setAddingColumn(true)}>
                    + column
                  </button>
                )}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {orderedRows.map((row) => (
            <tr key={row.id} className={row.kind === 'starter' ? 'ss-row-starter' : 'ss-row-custom'}>
              <th className="ss-row-label" data-testid={`row-label-${row.id}`}>
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
                return (
                  <td
                    key={col.id}
                    className={`ss-cell ${canEdit ? 'editable' : ''}`}
                    data-testid={`cell-${key}`}
                    onClick={() => canEdit && setEditingCell({ rowId: row.id, colId: col.id })}
                  >
                    <CellContent cell={cell} doubleBooked={doubleBooked} />
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
          ))}
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
                Cells take free text; @ tags a person, # tags a location.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editingCell && (
        <SheetCellEditor
          cell={(day.cells || {})[cellKeyOf(editingCell.rowId, editingCell.colId)] || null}
          people={people}
          locations={locations}
          onClose={() => setEditingCell(null)}
          onSave={(cell) => {
            onCellSave(editingCell.rowId, editingCell.colId, cell);
            setEditingCell(null);
          }}
        />
      )}
    </div>
  );
}
