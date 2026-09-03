// src/components/scheduling/InlineCellEditor.jsx
//
// Editing a scheduling sheet cell IN the cell. The grid is spreadsheet-shaped —
// many short values entered in sequence while reading across neighbouring
// columns — so the surrounding sheet has to stay visible while one cell is
// being filled.
//
// Commit rule: Enter, Tab and blur ALL commit. Escape is the single deliberate
// discard, restoring the snapshot taken when editing began. This is safe
// because a cell write is a targeted $set on one cell path with no version
// gate — an incidental commit costs one retypeable cell, whereas discarding on
// blur reintroduces exactly the silent data loss that motivated this change.
//
// Notes are NOT edited here. They are long-form and comparatively rare; the
// expanded editor (SheetCellEditor) keeps them, and an existing note rides
// through an in-cell commit untouched.

import React, { useRef, useState } from 'react';

import useMentionPicker, {
  personSegment,
  locationSegment,
  timeSegment,
  placeholderSegment,
  externalPersonSegment,
  textSegment,
} from './useMentionPicker';
import CellSuggestionList from './CellSuggestionList';

function InlineChip({ segment, index, onRemove }) {
  if (segment.type === 'text') {
    return (
      <span className="ss-chip ss-chip-text" data-testid="inline-chip-text">
        {segment.text}
        <button type="button" className="ss-chip-remove" aria-label={`Remove ${segment.text}`} onClick={() => onRemove(index)}>
          &times;
        </button>
      </span>
    );
  }
  if (segment.type === 'location') {
    return (
      <span className="ss-chip ss-chip-location" data-testid="inline-chip-location">
        <span aria-hidden="true">&#128205;</span> {segment.name}
        <button type="button" className="ss-chip-remove" aria-label={`Remove ${segment.name}`} onClick={() => onRemove(index)}>
          &times;
        </button>
      </span>
    );
  }
  const kind = segment.placeholder ? 'placeholder' : segment.userId ? 'user' : 'external';
  return (
    <span className={`ss-chip ss-chip-${kind}`} data-testid={`inline-chip-${kind}`}>
      {kind === 'user' && <span className="ss-chip-glyph" aria-hidden="true">&#9673;</span>}
      {segment.name}
      {segment.callTimeOverride && <span className="ss-chip-calltime">{segment.callTimeOverride}</span>}
      <button type="button" className="ss-chip-remove" aria-label={`Remove ${segment.name}`} onClick={() => onRemove(index)}>
        &times;
      </button>
    </span>
  );
}

export default function InlineCellEditor({
  cell,
  people,
  locations,
  anchorRef,
  initialInput = '',
  onCommit,
  onCancel,
}) {
  // The pre-edit snapshot. Nothing is written until a commit, so Escape's
  // "restore" is real rather than a rollback of a partial write.
  const snapshotRef = useRef((cell && cell.segments ? [...cell.segments] : []));
  const [segments, setSegments] = useState(snapshotRef.current);
  const [input, setInput] = useState(initialInput);
  const [externalDraft, setExternalDraft] = useState(null); // { name, email }
  const inputRef = useRef(null);

  // One exit per edit. Escape sets this too, so a blur arriving after the
  // discard (unmount, focus moving on) cannot resurrect the edit as a commit.
  const doneRef = useRef(false);

  const picker = useMentionPicker({ input, people, locations });
  const { mode, term, personMatches, locationMatches, mentionTime, pendingSegment } = picker;

  const buildCell = (extraSegments) => ({
    segments: extraSegments,
    // The note belongs to the expanded editor; carry the stored one through.
    note: (cell && cell.note) || null,
  });

  const commit = (advance) => {
    if (doneRef.current) return;
    doneRef.current = true;
    const pending = pendingSegment();
    onCommit(buildCell(pending ? [...segments, pending] : segments), advance);
  };

  const cancel = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setSegments(snapshotRef.current);
    setInput('');
    setExternalDraft(null);
    onCancel();
  };

  const addSegment = (segment) => {
    setSegments((prev) => [...prev, segment]);
    setInput('');
    setExternalDraft(null);
    if (inputRef.current) inputRef.current.focus();
  };

  const removeSegment = (index) => {
    setSegments((prev) => prev.filter((_, i) => i !== index));
    if (inputRef.current) inputRef.current.focus();
  };

  const handleKeyDown = (e) => {
    // The grid owns arrow-key navigation between cells, but an editing cell
    // needs its arrows for the caret — so nothing typed in here reaches it.
    e.stopPropagation();

    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // A live suggestion list means Enter picks; only plain text commits.
      if (mode === 'mention' && mentionTime) { addSegment(timeSegment(mentionTime)); return; }
      if (mode === 'mention' && personMatches.length) { addSegment(personSegment(personMatches[0])); return; }
      if ((mode === 'mention' || mode === 'location') && locationMatches.length) {
        addSegment(locationSegment(locationMatches[0]));
        return;
      }
      commit('down');
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      commit('right');
      return;
    }
    if (e.key === 'Backspace' && !input && segments.length) {
      setSegments((prev) => prev.slice(0, -1));
    }
  };

  const handleBlur = () => {
    // The external-person form lives in the suggestion portal and genuinely
    // takes focus; that is a sub-flow, not an exit from the cell.
    if (externalDraft) return;
    commit(null);
  };

  return (
    <div className="ss-inline-cell-editor" data-testid="inline-cell-editor">
      {segments.map((seg, i) => (
        <InlineChip key={i} segment={seg} index={i} onRemove={removeSegment} />
      ))}
      <input
        ref={inputRef}
        className="ss-inline-cell-input"
        data-testid="inline-cell-input"
        value={input}
        autoFocus
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder="6pm, text, or @"
        aria-label="Cell content"
      />
      {(mode !== 'text' || externalDraft) && (
        <CellSuggestionList
          anchorRef={anchorRef}
          picker={picker}
          externalDraft={externalDraft}
          onPickPerson={(p) => addSegment(personSegment(p))}
          onPickLocation={(l) => addSegment(locationSegment(l))}
          onPickTime={(t) => addSegment(timeSegment(t))}
          onAddPlaceholder={() => addSegment(placeholderSegment(term))}
          onUseAsText={() => addSegment(textSegment(term.trim()))}
          onStartExternal={() => setExternalDraft({ name: term.trim(), email: '' })}
          onChangeExternal={setExternalDraft}
          onAddExternal={() => addSegment(externalPersonSegment(externalDraft.name, externalDraft.email))}
          onCancelExternal={() => {
            setExternalDraft(null);
            if (inputRef.current) inputRef.current.focus();
          }}
        />
      )}
    </div>
  );
}
