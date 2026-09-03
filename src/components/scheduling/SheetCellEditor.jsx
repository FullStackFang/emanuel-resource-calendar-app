// src/components/scheduling/SheetCellEditor.jsx
//
// The EXPANDED cell editor. Ordinary editing now happens in the cell itself
// (InlineCellEditor); this modal is reached by an explicit expand affordance
// and remains the only place a cell note is edited, plus the roomy surface for
// cells that have grown too many chips to work with in place.
//
// A cell is an ordered list of segments (free text, person chips, location
// chips) plus an optional note. Smart tagging is OPT-IN: plain text commits as
// a text segment; typing '@' opens a unified mention picker — people first
// (ReassignOwnerControl contract: 5-cap, honest overflow count, 'not a user'
// escape hatch, placeholder confirm) with a Locations group beneath; '#' still
// narrows to locations only, with a free-text fallback.
//
// The mention behavior itself lives in useMentionPicker, shared with the
// in-cell editor so the two surfaces cannot drift.

import React, { useState } from 'react';

import { parseTimeToken } from './sheetEventUtils';
import useMentionPicker, {
  personSegment,
  locationSegment,
  timeSegment,
  placeholderSegment,
  externalPersonSegment,
} from './useMentionPicker';

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

  const {
    mode,
    term,
    personMatches,
    personOverflow,
    locationMatches,
    locationOverflow,
    timePreview,
    mentionTime,
    pendingSegment,
  } = useMentionPicker({ input, people, locations });

  const addSegment = (segment) => {
    setSegments((prev) => [...prev, segment]);
    setInput('');
    setExternalDraft(null);
  };

  const commitText = () => {
    const segment = pendingSegment();
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

  const pickPerson = (p) => addSegment(personSegment(p));

  const pickTime = (t) => addSegment(timeSegment(t));

  const pickLocation = (l) => addSegment(locationSegment(l));

  const addPlaceholder = () => addSegment(placeholderSegment(term));

  const save = () => {
    const trimmedNote = note.trim();
    const pending = pendingSegment();
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
            {personMatches.map((p) => (
              <button key={p.userId} type="button" className="ss-picker-row" onClick={() => pickPerson(p)}>
                <span className="ss-picker-name">{p.name}</span>
                <span className="ss-picker-sub">{p.email}</span>
              </button>
            ))}
            {personOverflow > 0 && (
              <div className="ss-picker-overflow">
                {personOverflow} more {personOverflow === 1 ? 'match' : 'matches'}. Keep typing&hellip;
              </div>
            )}
            {locationMatches.length > 0 && (
              <>
                <div className="ss-picker-group" data-testid="mention-locations-group">Locations</div>
                {locationMatches.map((l) => (
                  <button key={String(l._id)} type="button" className="ss-picker-row" onClick={() => pickLocation(l)}>
                    <span className="ss-picker-name"><span aria-hidden="true">&#128205;</span> {l.displayName}</span>
                  </button>
                ))}
                {locationOverflow > 0 && (
                  <div className="ss-picker-overflow">{locationOverflow} more locations. Keep typing&hellip;</div>
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
              onClick={() => addSegment(externalPersonSegment(externalDraft.name, externalDraft.email))}
            >
              Add person
            </button>
            <button type="button" className="ss-ghost-btn" onClick={() => setExternalDraft(null)}>Cancel</button>
          </div>
        )}

        {mode === 'location' && (
          <div className="ss-picker" data-testid="location-picker">
            {locationMatches.map((l) => (
              <button key={String(l._id)} type="button" className="ss-picker-row" onClick={() => pickLocation(l)}>
                <span className="ss-picker-name">{l.displayName}</span>
              </button>
            ))}
            {locationOverflow > 0 && (
              <div className="ss-picker-overflow">
                {locationOverflow} more. Keep typing&hellip;
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
