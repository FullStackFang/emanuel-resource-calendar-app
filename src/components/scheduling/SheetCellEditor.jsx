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

import React, { useRef, useState } from 'react';

import { parseTimeToken } from './sheetEventUtils';
import useMentionPicker, {
  personSegment,
  locationSegment,
  timeSegment,
  placeholderSegment,
  externalPersonSegment,
} from './useMentionPicker';
import { addToGroup, removeLastGroupPart, consumeMentionTokens, pendingGroupedInput } from './mentionGroups';

function PersonChip({ segment, isActive, onEditDetails, onRemove, onRemoveDetail, onSetCallTime, canEdit }) {
  const kind = segment.placeholder ? 'placeholder' : segment.userId ? 'user' : 'external';
  return (
    <span className={`ss-person-roster ss-roster-${kind}${isActive ? ' ss-roster-active' : ''}`} data-testid={`cell-chip-${kind}`}>
      <span className="ss-roster-name-row" data-testid="editor-roster-name">
        {kind === 'user' && <span className="ss-chip-glyph" aria-hidden="true">&#9679;</span>}
        <span className="ss-roster-name">{segment.name}</span>
        {segment.email && kind === 'external' && <span className="ss-chip-sub">{segment.email}</span>}
        {segment.callTimeOverride && (
          <span className="ss-chip-calltime" title="Personal call time (overrides the column call time)">
            {segment.callTimeOverride}
          </span>
        )}
        {canEdit && <button type="button" className="ss-chip-edit-details" aria-label={`Edit details for ${segment.name}`}
          aria-pressed={isActive} onClick={onEditDetails}>Edit</button>}
        {canEdit && !segment.placeholder && (
          <button type="button" className="ss-chip-action" title="Set a personal call time for this person" onClick={onSetCallTime}>
            &#128337;
          </button>
        )}
        {canEdit && (
          <button type="button" className="ss-chip-remove" aria-label={`Remove ${segment.name}${segment.details?.length ? ' and all details' : ''}`} onClick={onRemove}>
            &times;
          </button>
        )}
      </span>
      {segment.details?.length > 0 && <span className="ss-roster-details" data-testid="editor-group-details">
        {(segment.details || []).map((detail, index) => (
          <span className="ss-roster-detail" key={index}>
            {detail.type === 'text' ? detail.text : detail.name}
            {canEdit && <button type="button" className="ss-chip-remove" aria-label={`Remove ${detail.type === 'text' ? detail.text : detail.name}`} onClick={() => onRemoveDetail(index)}>&times;</button>}
          </span>
        ))}
      </span>}
    </span>
  );
}

export default function SheetCellEditor({ cell, people, locations, detailVocabulary = [], onSave, onClose }) {
  const [segments, setSegments] = useState(() => (cell && cell.segments ? [...cell.segments] : []));
  const [openGroupIndex, setOpenGroupIndex] = useState(null);
  const [note, setNote] = useState(cell && cell.note ? cell.note.text : '');
  const [showNote, setShowNote] = useState(!!(cell && cell.note));
  const [input, setInput] = useState('');
  const [externalDraft, setExternalDraft] = useState(null); // { name, email }
  const [callTimeIndex, setCallTimeIndex] = useState(null);
  const [callTimeDraft, setCallTimeDraft] = useState('');
  const inputRef = useRef(null);
  const activeGroup = openGroupIndex == null ? null : segments[openGroupIndex];

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
    choices,
    detailOverflow,
  } = useMentionPicker({ input, people, locations, detailMode: openGroupIndex != null, detailVocabulary });

  const addSegment = (segment) => {
    const next = addToGroup(segments, segment.type === 'person' ? null : (mode === 'mention' ? openGroupIndex : null), segment);
    setSegments(next.segments);
    if (segment.type === 'person') setOpenGroupIndex(next.openIndex);
    setInput('');
    setExternalDraft(null);
  };

  const removeSegment = (index) => {
    setSegments((prev) => prev.filter((_, i) => i !== index));
    setOpenGroupIndex((current) => current === index ? null : current > index ? current - 1 : current);
  };

  const finishCurrentInput = () => {
    if (!input.trim()) return;
    setSegments(pendingGroupedInput(input, segments, openGroupIndex, people, locations, pendingSegment()));
    setInput('');
  };

  const commitText = () => {
    const segment = pendingSegment();
    if (segment) addSegment(segment);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (openGroupIndex != null && !input.trim()) setOpenGroupIndex(null);
      else if (mode === 'text') commitText();
      else if (mode === 'mention' && openGroupIndex != null && term.trim()) addSegment({ type: 'text', text: mentionTime?.display || term.trim() });
      else if (mode === 'mention' && mentionTime) pickTime(mentionTime);
      else if (mode === 'mention' && personMatches.length) pickPerson(personMatches[0]);
      else if ((mode === 'mention' || mode === 'location') && locationMatches.length) pickLocation(locationMatches[0]);
    }
    if (e.key === 'Backspace' && !input && segments.length) {
      const next = removeLastGroupPart(segments, openGroupIndex);
      setSegments(next.segments);
      setOpenGroupIndex(next.openIndex);
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
      segments: pendingGroupedInput(input, segments, openGroupIndex, people, locations, pending),
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
                    onClick={() => removeSegment(i)}>
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
                    onClick={() => removeSegment(i)}>
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
                isActive={openGroupIndex === i}
                onEditDetails={() => { finishCurrentInput(); setOpenGroupIndex(i); inputRef.current?.focus(); }}
                onRemove={() => removeSegment(i)}
                onRemoveDetail={(detailIndex) => setSegments((prev) => prev.map((s, j) => j === i ? { ...s, details: s.details.filter((_, k) => k !== detailIndex) } : s))}
                onSetCallTime={() => { setCallTimeIndex(i); setCallTimeDraft(seg.callTimeOverride || ''); }}
              />
            );
          })}
        </div>

        {activeGroup && <div className="ss-group-target" data-testid="editor-group-target">
          Adding details to <strong>{activeGroup.name}</strong>
          <button type="button" title="Or press Enter on an empty input" onClick={() => { finishCurrentInput(); setOpenGroupIndex(null); }}>Done</button>
        </div>}

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
          ref={inputRef}
          className="ss-editor-input"
          data-testid="cell-editor-input"
          value={input}
          autoFocus
          onChange={(e) => {
            const next = consumeMentionTokens(e.target.value, segments, openGroupIndex, people, locations);
            setSegments(next.segments);
            setOpenGroupIndex(next.openIndex);
            setInput(next.input);
          }}
          onKeyDown={handleKeyDown}
          placeholder={activeGroup ? `@detail for ${activeGroup.name}` : 'Type a time (6pm), free text, or @ to tag a person or location'}
        />

        {timePreview && (
          <div className="ss-time-hint" data-testid="cell-time-hint">
            <span aria-hidden="true">&#128337;</span> {timePreview.display}
            <span className="ss-time-hint-key">Enter to add</span>
          </div>
        )}

        {mode === 'mention' && !externalDraft && (
          <div className="ss-picker" data-testid="person-picker">
            {openGroupIndex != null && choices.filter((choice) => choice.kind === 'detailSuggestion').map((choice) => (
              <button type="button" key={choice.key} className="ss-picker-row" onClick={() => addSegment({ type: 'text', text: choice.payload })}>Add {choice.name} to {activeGroup.name}</button>
            ))}
            {openGroupIndex != null && detailOverflow > 0 && <div className="ss-picker-overflow">{detailOverflow} more details. Keep typing&hellip;</div>}
            {openGroupIndex != null && term.trim() && (
              <button type="button" className="ss-picker-row" onClick={() => addSegment({ type: 'text', text: mentionTime?.display || term.trim() })}>Add {mentionTime?.display || term.trim()} to {activeGroup.name}</button>
            )}
            {mentionTime && openGroupIndex == null && (
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
            {openGroupIndex == null && personMatches.length === 0 && term.trim() && (
              <button type="button" className="ss-picker-row ss-picker-placeholder" onClick={addPlaceholder}>
                Keep <strong>@{term.trim()}</strong> as an unassigned placeholder
              </button>
            )}
            {openGroupIndex == null && <button type="button" className="ss-picker-row ss-picker-escape" onClick={() => setExternalDraft({ name: term.trim(), email: '' })}>
              Not a user? Add name &amp; email
            </button>}
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
