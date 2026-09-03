// src/components/scheduling/CellSuggestionList.jsx
//
// The suggestion surface for in-cell editing. Two structural facts of the grid
// shape this component:
//
//   1. `.ss-grid-scroll` sets overflow on both axes, so anything rendered
//      inside a cell is CLIPPED at the scroll container's edge. The list
//      therefore renders through a portal into document.body.
//   2. The header row and label column are `position: sticky` at z-indexes 2-4,
//      so the list needs a z-index above them or it renders behind the chrome
//      it is supposed to float over.
//
// Positioning is `fixed`, derived from the anchor cell's rect, recomputed on
// any scroll (capture phase, so the grid container's own scrolling counts) and
// on window resize. Near the bottom of the viewport it flips above the cell.
//
// Behavior comes entirely from useMentionPicker — this file is presentation.

import React, { useCallback, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { applyChoice } from './useMentionPicker';

// Matches the max-height in SchedulingSheets.css. Used only to decide whether
// there is room below the cell; the CSS remains the source of truth for size.
const LIST_MAX_HEIGHT = 260;
const MIN_WIDTH = 240;

function measure(anchorRef) {
  const el = anchorRef && anchorRef.current;
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, bottom: r.bottom, width: r.width };
}

export default function CellSuggestionList({
  anchorRef,
  picker,
  activeIndex = -1,
  externalDraft,
  onPickPerson,
  onPickLocation,
  onPickTime,
  onAddPlaceholder,
  onUseAsText,
  onStartExternal,
  onChangeExternal,
  onAddExternal,
  onCancelExternal,
}) {
  const [rect, setRect] = useState(() => measure(anchorRef));

  const reposition = useCallback(() => setRect(measure(anchorRef)), [anchorRef]);

  useLayoutEffect(() => {
    reposition();
    // Capture phase: a scroll event does not bubble, but it DOES traverse the
    // capture path — which is how one window listener catches the grid's own
    // scroll container without this component knowing the container exists.
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [reposition]);

  if (!rect) return null;

  const roomBelow = window.innerHeight - rect.bottom;
  const flip = roomBelow < LIST_MAX_HEIGHT && rect.top > roomBelow;

  const style = {
    position: 'fixed',
    left: `${rect.left}px`,
    minWidth: `${Math.max(rect.width, MIN_WIDTH)}px`,
    zIndex: 60,
    ...(flip ? { bottom: `${window.innerHeight - rect.top}px` } : { top: `${rect.bottom}px` }),
  };

  const { choices, personOverflow, locationOverflow } = picker;
  const handlers = {
    onPickTime, onPickPerson, onPickLocation, onAddPlaceholder, onStartExternal, onUseAsText,
  };

  return createPortal(
    <div
      className="ss-picker ss-cell-suggestions"
      data-testid="cell-suggestions"
      id="ss-cell-suggestions"
      // The rows are a listbox the cell input drives, not a toolbar: that is
      // what makes aria-selected legal on them and lets a screen reader
      // announce the highlight Tab moves.
      role={externalDraft ? undefined : 'listbox'}
      style={style}
      // A pointer press here must not move focus: the cell input's blur commits
      // and tears this list down, so without suppression a click on a
      // suggestion commits the raw typed term instead. Form fields are exempt —
      // they genuinely need focus, and the editor suspends blur-commit while
      // the external-person draft is open.
      onMouseDown={(e) => { if (e.target.tagName !== 'INPUT') e.preventDefault(); }}
    >
      {externalDraft ? (
        <div className="ss-cell-external" data-testid="cell-external-person-form">
          <input
            placeholder="Full name"
            autoFocus
            value={externalDraft.name}
            onChange={(e) => onChangeExternal({ ...externalDraft, name: e.target.value })}
          />
          <input
            placeholder="Email (optional)"
            value={externalDraft.email}
            onChange={(e) => onChangeExternal({ ...externalDraft, email: e.target.value })}
          />
          <button type="button" disabled={!externalDraft.name.trim()} onClick={onAddExternal}>
            Add person
          </button>
          <button type="button" className="ss-ghost-btn" onClick={onCancelExternal}>Cancel</button>
        </div>
      ) : (
        <>
          {choices.map((choice, index) => (
            <React.Fragment key={choice.key}>
              {choice.group && (index === 0 || choices[index - 1].group !== choice.group) && (
                <div
                  className="ss-picker-group"
                  data-testid={choice.kind === 'location' ? 'cell-suggestions-locations-group' : undefined}
                >
                  {choice.group}
                </div>
              )}
              <button
                type="button"
                role="option"
                id={`ss-choice-${index}`}
                className={`ss-picker-row${choice.className ? ` ${choice.className}` : ''}${index === activeIndex ? ' ss-picker-active' : ''}`}
                data-testid={choice.testId}
                aria-selected={index === activeIndex}
                onClick={() => applyChoice(choice, handlers)}
              >
                {choice.kind === 'placeholder' && (
                  <>Keep <strong>@{choice.payload}</strong> as an unassigned placeholder</>
                )}
                {choice.kind === 'external' && <>Not a user? Add name &amp; email</>}
                {choice.kind === 'text' && <>Use &ldquo;{choice.payload}&rdquo; as free text</>}
                {(choice.kind === 'time' || choice.kind === 'person' || choice.kind === 'location') && (
                  <>
                    <span className="ss-picker-name">
                      {choice.icon === 'clock' && <span aria-hidden="true">&#128337;</span>}
                      {choice.icon === 'pin' && <span aria-hidden="true">&#128205;</span>}
                      {choice.icon ? ' ' : ''}{choice.name}
                    </span>
                    {choice.sub && <span className="ss-picker-sub">{choice.sub}</span>}
                  </>
                )}
              </button>
              {/* Overflow counts trail the last row of their own kind, so the
                  honest 'N more' line stays attached to what it counts. */}
              {choice.kind === 'person' && personOverflow > 0 && choices[index + 1]?.kind !== 'person' && (
                <div className="ss-picker-overflow">
                  {personOverflow} more {personOverflow === 1 ? 'match' : 'matches'}. Keep typing&hellip;
                </div>
              )}
              {choice.kind === 'location' && locationOverflow > 0 && choices[index + 1]?.kind !== 'location' && (
                <div className="ss-picker-overflow">{locationOverflow} more locations. Keep typing&hellip;</div>
              )}
            </React.Fragment>
          ))}
        </>
      )}
    </div>,
    document.body
  );
}
