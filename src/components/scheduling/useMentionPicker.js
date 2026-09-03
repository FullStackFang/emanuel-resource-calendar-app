// src/components/scheduling/useMentionPicker.js
//
// ONE definition of what a scheduling sheet cell's input means, shared by the
// modal SheetCellEditor and the in-cell InlineCellEditor.
//
// Smart tagging is OPT-IN: plain text commits as a text segment; '@' is the
// universal tag (people first, then a Locations group, plus a Time entry when
// the term reads as a clock value); '#' narrows to locations only. The five-
// match cap and its honest overflow count follow the ReassignOwnerControl
// contract.
//
// The hook holds NO DOM knowledge — each surface owns its own presentation
// (the modal stacks a picker under a full-width input, the cell floats one
// over the grid). Behavior lives here so the two cannot drift.

import { useMemo } from 'react';

import { parseTimeToken } from './sheetEventUtils';

export const MATCH_CAP = 5;

// ── Segment builders ───────────────────────────────────────────────────────
// The stored cell shape is a server contract; building it in one place keeps
// both surfaces writing identical documents.

export function personSegment(person) {
  return {
    type: 'person',
    userId: person.userId,
    name: person.name,
    email: person.email,
    placeholder: false,
    callTimeOverride: null,
  };
}

export function locationSegment(location) {
  return { type: 'location', locationId: String(location._id), name: location.displayName };
}

/** A picked time commits as ordinary text — the sheet stores display strings. */
export function timeSegment(parsedTime) {
  return { type: 'text', text: parsedTime.display };
}

export function placeholderSegment(term) {
  return {
    type: 'person',
    userId: null,
    name: `@${String(term).trim()}`,
    email: null,
    placeholder: true,
    callTimeOverride: null,
  };
}

export function externalPersonSegment(name, email) {
  return {
    type: 'person',
    userId: null,
    name: String(name).trim(),
    email: String(email || '').trim() || null,
    placeholder: false,
    callTimeOverride: null,
  };
}

export function textSegment(text) {
  return { type: 'text', text: String(text) };
}


/**
 * Run a suggestion row's action. One definition shared by the list (a click)
 * and the editor (Enter on the highlighted row), so the two can never disagree
 * about what a row does.
 */
export function applyChoice(choice, handlers) {
  if (!choice) return;
  switch (choice.kind) {
    case 'time': return handlers.onPickTime(choice.payload);
    case 'person': return handlers.onPickPerson(choice.payload);
    case 'location': return handlers.onPickLocation(choice.payload);
    case 'placeholder': return handlers.onAddPlaceholder();
    case 'external': return handlers.onStartExternal();
    case 'text': return handlers.onUseAsText();
    default: return undefined;
  }
}

/** Kinds the picker would act on unprompted; the escape hatches are not. */
export const MATCH_KINDS = new Set(['time', 'person', 'location']);

// ── The hook ───────────────────────────────────────────────────────────────

export default function useMentionPicker({ input, people, locations }) {
  const value = typeof input === 'string' ? input : '';

  const mode = value.startsWith('@') ? 'mention' : value.startsWith('#') ? 'location' : 'text';
  const term = mode === 'text' ? value : value.slice(1);

  const allPersonMatches = useMemo(() => {
    if (mode !== 'mention') return [];
    const q = term.trim().toLowerCase();
    const all = people || [];
    return q
      ? all.filter((p) => (p.name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q))
      : all;
  }, [mode, term, people]);

  const allLocationMatches = useMemo(() => {
    if (mode !== 'location' && mode !== 'mention') return [];
    const q = term.trim().toLowerCase();
    const all = locations || [];
    return q ? all.filter((l) => (l.displayName || '').toLowerCase().includes(q)) : all;
  }, [mode, term, locations]);

  // A time typed anywhere in the cell normalizes to one sheet-wide format;
  // anything that is not a time ('after kiddush') commits exactly as typed.
  const timePreview = useMemo(() => (mode === 'text' ? parseTimeToken(value) : null), [mode, value]);

  // '@' is a lookup sigil, and a time has nothing to look up — so it is
  // optional here. Typing '@6pm' still works because people reach for it.
  const mentionTime = useMemo(() => (mode === 'mention' ? parseTimeToken(term) : null), [mode, term]);

  const personMatches = useMemo(() => allPersonMatches.slice(0, MATCH_CAP), [allPersonMatches]);
  const locationMatches = useMemo(() => allLocationMatches.slice(0, MATCH_CAP), [allLocationMatches]);

  /**
   * The segment the input box currently represents, or null when it is empty.
   * EVERY commit path goes through this: text left in the box used to be
   * discarded on save, which read as 'times cannot be entered' because chips
   * are committed by a picker click and only text needs the Enter step.
   */
  const pendingSegment = () => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return textSegment(timePreview ? timePreview.display : trimmed);
  };


  /**
   * The suggestion rows in the exact order they are shown, as ONE ordered list.
   * Both consumers read it — the list renders from it, the editor's keyboard
   * walks it — so a row can never be highlighted in one place and picked in
   * another. Overflow notices are not in here: they are counts, not choices.
   *
   * 'match' kinds are the ones the picker would act on by itself; the escape
   * hatches trail them and are reachable only by an explicit Tab/arrow, so
   * Enter on a term that matched nothing still commits the term.
   */
  const choices = useMemo(() => {
    const out = [];
    const trimmed = term.trim();
    if (mode === 'mention' && mentionTime) {
      out.push({
        key: 'time', kind: 'time', group: 'Time', icon: 'clock',
        testId: 'cell-suggestions-time-row', name: mentionTime.display, payload: mentionTime,
      });
    }
    if (mode === 'mention') {
      for (const person of personMatches) {
        out.push({ key: `person:${person.userId}`, kind: 'person', name: person.name, sub: person.email, payload: person });
      }
    }
    for (const location of locationMatches) {
      out.push({
        key: `location:${String(location._id)}`, kind: 'location', icon: 'pin',
        group: mode === 'mention' ? 'Locations' : null, name: location.displayName, payload: location,
      });
    }
    if (mode === 'mention' && personMatches.length === 0 && trimmed) {
      out.push({ key: 'placeholder', kind: 'placeholder', className: 'ss-picker-placeholder', payload: trimmed });
    }
    if (mode === 'mention') {
      out.push({ key: 'external', kind: 'external', className: 'ss-picker-escape', payload: trimmed });
    }
    if (mode === 'location' && locationMatches.length === 0 && trimmed) {
      out.push({ key: 'text', kind: 'text', className: 'ss-picker-escape', payload: trimmed });
    }
    return out;
  }, [mode, term, mentionTime, personMatches, locationMatches]);

  return {
    mode,
    term,
    choices,
    personMatches,
    personOverflow: Math.max(0, allPersonMatches.length - MATCH_CAP),
    locationMatches,
    locationOverflow: Math.max(0, allLocationMatches.length - MATCH_CAP),
    timePreview,
    mentionTime,
    pendingSegment,
  };
}
