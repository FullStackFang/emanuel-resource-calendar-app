// src/components/scheduling/SheetCellEditor.jsx
//
// The one place cell content gets edited. A cell is an ordered list of
// segments (free text, person chips, location chips) plus an optional note.
// Smart tagging is OPT-IN: plain text commits as a text segment; typing '@'
// opens a unified mention picker — people first (ReassignOwnerControl
// contract: 5-cap, honest overflow count, 'not a user' escape hatch,
// placeholder confirm) with a Locations group beneath; '#' still narrows to
// locations only, with a free-text fallback.

import React, { useMemo, useState } from 'react';

import { parseTimeToken } from './sheetEventUtils';

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

  // '@' is the universal tag: people AND locations, grouped. '#' narrows to
  // locations only (kept as a shortcut and for muscle memory).
  const mode = input.startsWith('@') ? 'mention' : input.startsWith('#') ? 'location' : 'text';
  const term = mode === 'text' ? input : input.slice(1);

  const personMatches = useMemo(() => {
    if (mode !== 'mention') return [];
    const q = term.trim().toLowerCase();
    const all = people || [];
    return q
      ? all.filter((p) => (p.name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q))
      : all;
  }, [mode, term, people]);

  const locationMatches = useMemo(() => {
    if (mode !== 'location' && mode !== 'mention') return [];
    const q = term.trim().toLowerCase();
    const all = locations || [];
    return q ? all.filter((l) => (l.displayName || '').toLowerCase().includes(q)) : all;
  }, [mode, term, locations]);

  // A time typed anywhere in the cell normalizes to one sheet-wide format;
  // anything that is not a time ('after kiddush') commits exactly as typed.
  const timePreview = useMemo(() => (mode === 'text' ? parseTimeToken(input) : null), [mode, input]);

  // '@' is a lookup sigil, and a time has nothing to look up — so it is
  // optional here. Typing '@6pm' still works because people reach for it.
  const mentionTime = useMemo(() => (mode === 'mention' ? parseTimeToken(term) : null), [mode, term]);

  /**
   * The segment the input box currently represents, or null when it is empty.
   * save() and Enter BOTH go through this: text left in the box used to be
   * discarded on save, which read as 'times cannot be entered' because chips
   * are committed by a picker click and only text needs the Enter step.
   */
  const pendingTextSegment = () => {
    const value = input.trim();
    if (!value) return null;
    return { type: 'text', text: timePreview ? timePreview.display : value };
  };

  const addSegment = (segment) => {
    setSegments((prev) => [...prev, segment]);
    setInput('');
    setExternalDraft(null);
  };

  const commitText = () => {
    const segment = pendingTextSegment();
    if (segment) addSegment(segment);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (mode === 'text') commitText();
      else if (mode === 'mention' && mentionTime) pickTime(mentionTime);
      else if (mode === 'mention' && personMatches.length) pickPerson(personMatches[0]);
      else if ((mode === 'mention' || mode === 'location') && locationMatches.length) pickLocation(locationMatches[0]);
    }
    if (e.key === 'Backspace' && !input && segments.length) {
      setSegments((prev) => prev.slice(0, -1));
    }
  };

  const pickPerson = (p) =>
    addSegment({ type: 'person', userId: p.userId, name: p.name, email: p.email, placeholder: false, callTimeOverride: null });

  const pickTime = (t) => addSegment({ type: 'text', text: t.display });

  const pickLocation = (l) =>
    addSegment({ type: 'location', locationId: String(l._id), name: l.displayName });

  const addPlaceholder = () =>
    addSegment({ type: 'person', userId: null, name: `@${term.trim()}`, email: null, placeholder: true, callTimeOverride: null });

  const save = () => {
    const trimmedNote = note.trim();
    const pending = pendingTextSegment();
    onSave({
      segments: pending ? [...segments, pending] : segments,
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
              Personal call time
              <input
                value={callTimeDraft}
                onChange={(e) => setCallTimeDraft(e.target.value)}
                placeholder="6pm or 18:00"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                // The server validates this field as strict HH:MM, so accept a
                // loosely-typed time here and normalize rather than 400 on '6pm'.
                const typed = callTimeDraft.trim();
                const parsed = parseTimeToken(typed);
                const value = parsed ? parsed.value : typed;
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
          placeholder="Type a time (6pm), free text, or @ to tag a person or location"
        />

        {timePreview && (
          <div className="ss-time-hint" data-testid="cell-time-hint">
            <span aria-hidden="true">&#128337;</span> {timePreview.display}
            <span className="ss-time-hint-key">Enter to add</span>
          </div>
        )}

        {mode === 'mention' && !externalDraft && (
          <div className="ss-picker" data-testid="person-picker">
            {mentionTime && (
              <>
                <div className="ss-picker-group">Time</div>
                <button type="button" className="ss-picker-row" data-testid="mention-time-row" onClick={() => pickTime(mentionTime)}>
                  <span className="ss-picker-name"><span aria-hidden="true">&#128337;</span> {mentionTime.display}</span>
                </button>
              </>
            )}
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
            {locationMatches.length > 0 && (
              <>
                <div className="ss-picker-group" data-testid="mention-locations-group">Locations</div>
                {locationMatches.slice(0, MATCH_CAP).map((l) => (
                  <button key={String(l._id)} type="button" className="ss-picker-row" onClick={() => pickLocation(l)}>
                    <span className="ss-picker-name"><span aria-hidden="true">&#128205;</span> {l.displayName}</span>
                  </button>
                ))}
                {locationMatches.length > MATCH_CAP && (
                  <div className="ss-picker-overflow">{locationMatches.length - MATCH_CAP} more locations. Keep typing&hellip;</div>
                )}
              </>
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
