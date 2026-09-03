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

  return {
    mode,
    term,
    personMatches,
    personOverflow: Math.max(0, allPersonMatches.length - MATCH_CAP),
    locationMatches,
    locationOverflow: Math.max(0, allLocationMatches.length - MATCH_CAP),
    timePreview,
    mentionTime,
    pendingSegment,
  };
}
