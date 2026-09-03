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
  applyChoice,
  MATCH_KINDS,
  personSegment,
  locationSegment,
  timeSegment,
  placeholderSegment,
  externalPersonSegment,
  textSegment,
} from './useMentionPicker';
import CellSuggestionList from './CellSuggestionList';

/**
 * Removing a chip has to survive the input's blur-commit. mousedown moves
 * focus off the input, which commits and unmounts this editor BEFORE the
 * click can land, so an unguarded × is inert — it looks like a delete button
 * and does nothing. Suppressing the default mousedown keeps focus in the
 * input; it is the same guard CellSuggestionList uses for its own rows.
 */
function RemoveButton({ label, onRemove }) {
  return (
    <button
      type="button"
      className="ss-chip-remove"
      aria-label={`Remove ${label}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRemove}
    >
      &times;
    </button>
  );
}

function InlineChip({ segment, index, onRemove }) {
  if (segment.type === 'text') {
    return (
      <span className="ss-chip ss-chip-text" data-testid="inline-chip-text">
        {segment.text}
        <RemoveButton label={segment.text} onRemove={() => onRemove(index)} />
      </span>
    );
  }
  if (segment.type === 'location') {
    return (
      <span className="ss-chip ss-chip-location" data-testid="inline-chip-location">
        <span aria-hidden="true">&#128205;</span> {segment.name}
        <RemoveButton label={segment.name} onRemove={() => onRemove(index)} />
      </span>
    );
  }
  const kind = segment.placeholder ? 'placeholder' : segment.userId ? 'user' : 'external';
  return (
    <span className={`ss-chip ss-chip-${kind}`} data-testid={`inline-chip-${kind}`}>
      {kind === 'user' && <span className="ss-chip-glyph" aria-hidden="true">&#9673;</span>}
      {segment.name}
      {segment.callTimeOverride && <span className="ss-chip-calltime">{segment.callTimeOverride}</span>}
      <RemoveButton label={segment.name} onRemove={() => onRemove(index)} />
    </span>
  );
}

export default function InlineCellEditor({
  cell,
  people,
  locations,
  anchorRef,
  initialInput = '',
  clipboard = null,
  onCopyCell,
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
  const { mode, term, choices, pendingSegment } = picker;

  // What each suggestion row does. Defined once and handed to BOTH the list
  // (a click) and applyChoice (Enter on the highlighted row).
  const choiceHandlers = {
    onPickPerson: (person) => addSegment(personSegment(person)),
    onPickLocation: (location) => addSegment(locationSegment(location)),
    onPickTime: (time) => addSegment(timeSegment(time)),
    onAddPlaceholder: () => addSegment(placeholderSegment(term)),
    onUseAsText: () => addSegment(textSegment(term.trim())),
    onStartExternal: () => setExternalDraft({ name: term.trim(), email: '' }),
  };

  // Keyboard highlight over the suggestion rows. -1 means 'nothing chosen
  // yet', which is deliberately what an escape-hatch-only list starts at:
  // Enter on a term that matched nobody must still COMMIT the term rather
  // than silently open the add-an-outsider form.
  const defaultActiveIndex = choices.length && MATCH_KINDS.has(choices[0].kind) ? 0 : -1;
  const [activeIndex, setActiveIndex] = useState(defaultActiveIndex);
  const [renderedChoiceKey, setRenderedChoiceKey] = useState('');
  const choiceKey = choices.map((c) => c.key).join('|');
  if (renderedChoiceKey !== choiceKey) {
    // Re-derive during render, not in an effect: an effect would leave the
    // highlight pointing at a row that no longer exists for one frame, and
    // Enter in that frame would pick the wrong person.
    setRenderedChoiceKey(choiceKey);
    setActiveIndex(defaultActiveIndex);
  }

  /** Walk the rows, wrapping — a short closed list, so wrapping never strands. */
  const moveActive = (delta) => {
    const n = choices.length;
    setActiveIndex((i) => {
      const base = i < 0 ? (delta > 0 ? -1 : 0) : i;
      return (((base + delta) % n) + n) % n;
    });
  };

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

    // Ctrl/Cmd+C and +V have to work HERE, not only on a focused cell: a
    // click opens the editor, so 'the cell is focused but not editing' is a
    // state a mouse user is almost never in. A real text selection still
    // wins — copying a couple of words out of a cell is a legitimate thing
    // to want, and only the caret can tell the two intents apart.
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      const el = inputRef.current;
      const hasSelection = el && el.selectionStart !== el.selectionEnd;
      if (!hasSelection && onCopyCell) {
        e.preventDefault();
        // Copy what a commit would write, so text still sitting in the box
        // travels with the chips instead of being silently dropped.
        const pending = pendingSegment();
        onCopyCell(pending ? [...segments, pending] : segments);
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
      if (clipboard) {
        // Beat the browser to it: a native paste would drop the copied cell
        // in as one run of plain text, turning tagged people into strings.
        e.preventDefault();
        setSegments(clipboard.map((seg) => ({ ...seg })));
        setInput('');
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }
    // Arrows walk the suggestion rows while a list is up; with no list they
    // belong to the text caret.
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && choices.length) {
      e.preventDefault();
      moveActive(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // A live suggestion list means Enter picks the highlighted row; only
      // plain text (or a list of escape hatches nobody stepped onto) commits.
      const choice = activeIndex >= 0 ? choices[activeIndex] : null;
      if (choice) { applyChoice(choice, choiceHandlers); return; }
      commit('down');
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      // With suggestions up, Tab steps through them (Shift+Tab back) instead
      // of leaving the cell — the list is the thing the user is aiming at.
      if (choices.length) { moveActive(e.shiftKey ? -1 : 1); return; }
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
        role="combobox"
        aria-expanded={choices.length > 0}
        aria-controls="ss-cell-suggestions"
        aria-activedescendant={activeIndex >= 0 ? `ss-choice-${activeIndex}` : undefined}
      />
      {(mode !== 'text' || externalDraft) && (
        <CellSuggestionList
          anchorRef={anchorRef}
          picker={picker}
          activeIndex={activeIndex}
          externalDraft={externalDraft}
          {...choiceHandlers}
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
