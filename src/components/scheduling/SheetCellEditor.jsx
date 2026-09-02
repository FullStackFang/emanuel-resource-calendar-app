// src/components/scheduling/SheetCellEditor.jsx
//
// The one place cell content gets edited. A cell is an ordered list of
// segments (free text, @person chips, #location chips) plus an optional note.
// Smart tagging is OPT-IN: plain text commits as a text segment; typing '@'
// opens the people picker (ReassignOwnerControl contract: 5-cap, honest
// overflow count, 'not a user' escape hatch, placeholder confirm); '#' opens
// the locations picker with free-text fallback.

import React, { useMemo, useState } from 'react';

const MATCH_CAP = 5;

function PersonChip({ segment, onRemove, onSetCallTime, canEdit }) {
  const kind = segment.placeholder ? 'placeholder' : segment.userId ? 'user' : 'external';
  return (
    <span className={`ss-chip ss-chip-${kind}`} data-testid={`cell-chip-${kind}`}>
      {kind === 'user' && <span className="ss-chip-glyph" aria-hidden="true">&#9673;</span>}
      <span className="ss-chip-name">{segment.name}</span>
      {segment.email && kind === 'external' && <span className="ss-chip-sub">{segment.email}</span>}
      {segment.callTimeOverride && (
        <span className="ss-chip-calltime" title="Personal call time (overrides the column call time)">
          {segment.callTimeOverride}
        </span>
      )}
      {canEdit && !segment.placeholder && (
        <button
          type="button"
          className="ss-chip-action"
          title="Set a personal call time for this person"
          onClick={onSetCallTime}
        >
          &#128337;
        </button>
      )}
      {canEdit && (
        <button type="button" className="ss-chip-remove" aria-label={`Remove ${segment.name}`} onClick={onRemove}>
          &times;
        </button>
      )}
    </span>
  );
}

export default function SheetCellEditor({ cell, people, locations, onSave, onClose }) {
  const [segments, setSegments] = useState(() => (cell && cell.segments ? [...cell.segments] : []));
  const [note, setNote] = useState(cell && cell.note ? cell.note.text : '');
  const [showNote, setShowNote] = useState(!!(cell && cell.note));
  const [input, setInput] = useState('');
  const [externalDraft, setExternalDraft] = useState(null); // { name, email }
  const [callTimeIndex, setCallTimeIndex] = useState(null);
  const [callTimeDraft, setCallTimeDraft] = useState('');

  const mode = input.startsWith('@') ? 'person' : input.startsWith('#') ? 'location' : 'text';
  const term = mode === 'text' ? input : input.slice(1);

  const personMatches = useMemo(() => {
    if (mode !== 'person') return [];
    const q = term.trim().toLowerCase();
    const all = people || [];
    return q
      ? all.filter((p) => (p.name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q))
      : all;
  }, [mode, term, people]);

  const locationMatches = useMemo(() => {
    if (mode !== 'location') return [];
    const q = term.trim().toLowerCase();
    const all = locations || [];
    return q ? all.filter((l) => (l.displayName || '').toLowerCase().includes(q)) : all;
  }, [mode, term, locations]);

  const addSegment = (segment) => {
    setSegments((prev) => [...prev, segment]);
    setInput('');
    setExternalDraft(null);
  };

  const commitText = () => {
    if (!input.trim()) return;
    addSegment({ type: 'text', text: input.trim() });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (mode === 'text') commitText();
      else if (mode === 'person' && personMatches.length) pickPerson(personMatches[0]);
      else if (mode === 'location' && locationMatches.length) pickLocation(locationMatches[0]);
    }
    if (e.key === 'Backspace' && !input && segments.length) {
      setSegments((prev) => prev.slice(0, -1));
    }
  };

  const pickPerson = (p) =>
    addSegment({ type: 'person', userId: p.userId, name: p.name, email: p.email, placeholder: false, callTimeOverride: null });

  const pickLocation = (l) =>
    addSegment({ type: 'location', locationId: String(l._id), name: l.displayName });

  const addPlaceholder = () =>
    addSegment({ type: 'person', userId: null, name: `@${term.trim()}`, email: null, placeholder: true, callTimeOverride: null });

  const save = () => {
    const trimmedNote = note.trim();
    onSave({
      segments,
      note: trimmedNote ? { text: trimmedNote, authorName: null, at: new Date().toISOString() } : null,
    });
  };

  return (
    <div className="ss-editor-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ss-editor" role="dialog" aria-label="Edit cell" data-testid="sheet-cell-editor">
        <div className="ss-editor-chips">
          {segments.map((seg, i) => {
            if (seg.type === 'text') {
              return (
                <span key={i} className="ss-chip ss-chip-text">
                  {seg.text}
                  <button type="button" className="ss-chip-remove" aria-label={`Remove ${seg.text}`}
                    onClick={() => setSegments((prev) => prev.filter((_, j) => j !== i))}>
                    &times;
                  </button>
                </span>
              );
            }
            if (seg.type === 'location') {
              return (
                <span key={i} className="ss-chip ss-chip-location">
                  <span aria-hidden="true">&#128205;</span> {seg.name}
                  <button type="button" className="ss-chip-remove" aria-label={`Remove ${seg.name}`}
                    onClick={() => setSegments((prev) => prev.filter((_, j) => j !== i))}>
                    &times;
                  </button>
                </span>
              );
            }
            return (
              <PersonChip
                key={i}
                segment={seg}
                canEdit
                onRemove={() => setSegments((prev) => prev.filter((_, j) => j !== i))}
                onSetCallTime={() => { setCallTimeIndex(i); setCallTimeDraft(seg.callTimeOverride || ''); }}
              />
            );
          })}
        </div>

        {callTimeIndex !== null && (
          <div className="ss-editor-calltime" data-testid="call-time-editor">
            <label>
              Personal call time (HH:MM)
              <input
                value={callTimeDraft}
                onChange={(e) => setCallTimeDraft(e.target.value)}
                placeholder="16:00"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                const value = callTimeDraft.trim();
                setSegments((prev) =>
                  prev.map((s, j) => (j === callTimeIndex ? { ...s, callTimeOverride: value || null } : s))
                );
                setCallTimeIndex(null);
              }}
            >
              Set
            </button>
            <button type="button" className="ss-ghost-btn" onClick={() => setCallTimeIndex(null)}>Cancel</button>
          </div>
        )}

        <input
          className="ss-editor-input"
          data-testid="cell-editor-input"
          value={input}
          autoFocus
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type text, @ to tag a person, # to tag a location"
        />

        {mode === 'person' && !externalDraft && (
          <div className="ss-picker" data-testid="person-picker">
            {personMatches.slice(0, MATCH_CAP).map((p) => (
              <button key={p.userId} type="button" className="ss-picker-row" onClick={() => pickPerson(p)}>
                <span className="ss-picker-name">{p.name}</span>
                <span className="ss-picker-sub">{p.email}</span>
              </button>
            ))}
            {personMatches.length > MATCH_CAP && (
              <div className="ss-picker-overflow">
                {personMatches.length - MATCH_CAP} more {personMatches.length - MATCH_CAP === 1 ? 'match' : 'matches'}. Keep typing&hellip;
              </div>
            )}
            {personMatches.length === 0 && term.trim() && (
              <button type="button" className="ss-picker-row ss-picker-placeholder" onClick={addPlaceholder}>
                Keep <strong>@{term.trim()}</strong> as an unassigned placeholder
              </button>
            )}
            <button type="button" className="ss-picker-row ss-picker-escape" onClick={() => setExternalDraft({ name: term.trim(), email: '' })}>
              Not a user? Add name &amp; email
            </button>
          </div>
        )}

        {externalDraft && (
          <div className="ss-editor-external" data-testid="external-person-form">
            <input
              placeholder="Full name"
              value={externalDraft.name}
              onChange={(e) => setExternalDraft((d) => ({ ...d, name: e.target.value }))}
            />
            <input
              placeholder="Email (optional)"
              value={externalDraft.email}
              onChange={(e) => setExternalDraft((d) => ({ ...d, email: e.target.value }))}
            />
            <button
              type="button"
              disabled={!externalDraft.name.trim()}
              onClick={() =>
                addSegment({
                  type: 'person',
                  userId: null,
                  name: externalDraft.name.trim(),
                  email: externalDraft.email.trim() || null,
                  placeholder: false,
                  callTimeOverride: null,
                })
              }
            >
              Add person
            </button>
            <button type="button" className="ss-ghost-btn" onClick={() => setExternalDraft(null)}>Cancel</button>
          </div>
        )}

        {mode === 'location' && (
          <div className="ss-picker" data-testid="location-picker">
            {locationMatches.slice(0, MATCH_CAP).map((l) => (
              <button key={String(l._id)} type="button" className="ss-picker-row" onClick={() => pickLocation(l)}>
                <span className="ss-picker-name">{l.displayName}</span>
              </button>
            ))}
            {locationMatches.length > MATCH_CAP && (
              <div className="ss-picker-overflow">
                {locationMatches.length - MATCH_CAP} more. Keep typing&hellip;
              </div>
            )}
            {locationMatches.length === 0 && term.trim() && (
              <button
                type="button"
                className="ss-picker-row ss-picker-escape"
                onClick={() => addSegment({ type: 'text', text: term.trim() })}
              >
                Use &ldquo;{term.trim()}&rdquo; as free text
              </button>
            )}
          </div>
        )}

        {showNote ? (
          <textarea
            className="ss-editor-note"
            data-testid="cell-note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note for everyone in this cell (included in their emails)"
          />
        ) : (
          <button type="button" className="ss-ghost-btn ss-editor-addnote" onClick={() => setShowNote(true)}>
            + Add note
          </button>
        )}

        <div className="ss-editor-actions">
          <button type="button" className="ss-ghost-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="ss-primary-btn" data-testid="cell-editor-save" onClick={save}>
            Save cell
          </button>
        </div>
      </div>
    </div>
  );
}
